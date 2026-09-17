// supa-guard — the "never a silent white screen" safety net for every platform page.
//
// WHY: the office/tech pages have a JS-only <body> and boot by calling
// window.supabase.createClient(...). If the supabase library didn't load (a corporate
// content-filter / ad-blocker / proxy blocking the CDN — exactly what a CSR hit on her
// locked-down desktop), createClient throws and the page is a blank white screen with no
// explanation. Self-hosting the library at /platform/vendor/supabase-js.js is the real
// fix; this is belt-and-suspenders: if the library STILL isn't there, show a friendly,
// self-healing panel instead of nothing.
//
// Load this RIGHT AFTER the supabase <script> on every page. If supabase loaded fine it's
// a no-op. If not, it drops a fixed full-screen overlay (covers whatever a crashing boot
// script leaves behind) that explains the likely cause + auto-reloads the moment the file
// becomes reachable or the network comes back.
(function () {
  if (window.supabase && typeof window.supabase.createClient === 'function') return;

  function show() {
    if (document.getElementById('ant-supa-guard')) return;
    var d = document.createElement('div');
    d.id = 'ant-supa-guard';
    d.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;'
      + 'background:#0e120c;color:#eef2e8;text-align:center;padding:24px;'
      + 'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif');
    d.innerHTML =
      '<div style="max-width:460px">'
      + '<div style="font-size:46px">🐜</div>'
      + '<h1 style="font-size:20px;margin:.5em 0 .3em;font-weight:800">Couldn’t load a component</h1>'
      + '<p style="opacity:.85;margin:0 0 4px">A file this page needs was blocked from loading — '
      + 'almost always an <b>ad-blocker</b>, <b>content filter</b>, or a <b>corporate proxy</b> on this network.</p>'
      + '<p style="opacity:.85;margin:0">Turn it off for this site (or try a different network / browser), then reload.</p>'
      + '<button id="ant-supa-reload" style="margin-top:18px;padding:13px 24px;border:0;border-radius:11px;'
      + 'background:#3f8f24;color:#fff;font-weight:800;font-size:16px;cursor:pointer">Reload</button>'
      + '<p style="opacity:.5;font-size:13px;margin-top:14px">Retrying automatically…</p>'
      + '</div>';
    (document.body || document.documentElement).appendChild(d);
    var b = document.getElementById('ant-supa-reload');
    if (b) b.onclick = function () { location.reload(); };
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);

  // Self-heal: if the library file becomes reachable (deploy blip cleared, filter toggled
  // off) or the network comes back, reload so the whole page re-runs cleanly.
  var tries = 0;
  var timer = setInterval(function () {
    if (window.supabase && typeof window.supabase.createClient === 'function') { clearInterval(timer); location.reload(); return; }
    fetch('/platform/vendor/supabase-js.js', { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { if (r && r.ok) { clearInterval(timer); location.reload(); } })
      .catch(function () {});
    if (++tries > 40) clearInterval(timer); // ~2 min then give it a rest
  }, 3000);
  window.addEventListener('online', function () { location.reload(); });
})();

// ── WRITE GUARD — "Saved ✓" must mean a row actually came back ────────────────────────
//
// THE GAP THIS CLOSES, and it is the one thing that made this platform structurally LESS
// trustworthy than the Xano system it replaces: Xano fails LOUDLY. Supabase fails SILENTLY.
//
// Proven live against production on 2026-09-17, anon PATCH on a real job row:
//     without .select()  ->  HTTP 204, EMPTY BODY, no error
//     with    .select()  ->  HTTP 200, []
// supabase-js hands the first one back as { data: null, error: null }. So the universal
// call-site shape -- `if (r.error) { complain } else { "Saved ✓" }` -- prints SUCCESS over a
// write that was refused and changed nothing. That is not a bug in one page; it is the
// default behaviour of every write on the platform. Swept 2026-09-17: 79 of 123 writes.
//
// It has already been paid for five separate times (Sofia's phone edits, the office notes,
// the TDR outcome picker, the office TDR save, the part disposition) -- each one found by a
// human noticing their work vanish, each fixed one call site at a time. This fixes the CLASS.
//
// HOW: wrap createClient so every write builder (a) is forced to return a representation and
// (b) reports zero-rows-back as a refusal. Nothing needs to change at the call sites: the
// ones that already check r.error start telling the truth, and the ones that ignore the
// result are unchanged.
//
// ⚠️ THE VERDICT IS DELIBERATELY NARROW, because a false "that did NOT save" is its own bug --
// it teaches the office to ignore the warning, which is exactly how the real one gets missed.
// Zero rows back only means REFUSED when a successful write could not possibly have returned
// zero rows:
//
//   insert / upsert  -> ALWAYS verdicted. No filter, so success always returns the row.
//                       (No call site uses ignoreDuplicates, which is the one shape that
//                       can legitimately upsert zero rows. Checked 2026-09-17: 0 uses.)
//   update           -> verdicted ONLY when the request targets ONE row by identity
//                       (id=eq.<x> in the query). That is the "Saved ✓" shape, and it is
//                       69 of the 71 update call sites on the platform.
//                       A conditional/bulk update is EXEMPT -- dispatch's withdrawOtherOffers
//                       (job_id + status=pending + id=neq.keep) legitimately matches zero
//                       rows whenever there is no other pending offer. That is the normal
//                       case, not a failure.
//   delete           -> NEVER verdicted. A delete that matches nothing is legitimate
//                       ("clear this job's tags" when it has none) and is indistinguishable
//                       from a refusal. It still gets the representation so a caller CAN look.
//
// ⚠️ SAFE TO APPLY UNIVERSALLY because every table these pages write to grants SELECT
// alongside its writes (checked against pg_policies, 17/17). If that ever stops being true
// for a new table, adding .select() there would turn a working write into a false refusal --
// so check the policy before adding a table the pages write to.
(function () {
  try {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return;
    if (window.__ANT_WRITE_GUARD) return;

    var stats = { refused: 0, last: null };

    // Does a successful write here HAVE to return at least one row?
    function mustReturnRow(verb, b) {
      if (verb === 'insert' || verb === 'upsert') return true;
      if (verb !== 'update') return false;                 // delete is never verdicted
      try {
        // Single-row identity write: PostgREST renders .eq('id', x) as `id=eq.<x>`.
        var qs = String((b && b.url && b.url.search) || '');
        return /(^|[?&])id=eq\./.test(qs);
      } catch (e) { return false; }                        // can't tell -> stay quiet
    }

    function verdict(r, table, verb) {
      if (!r || r.error) return r;                         // a real server error: pass it straight through
      var d = r.data;
      var empty = (d == null) || (Array.isArray(d) && d.length === 0);
      if (!empty) return r;
      stats.refused++;
      stats.last = { table: table, verb: verb, at: new Date().toISOString() };
      return {
        data: Array.isArray(d) ? d : [], count: r.count, status: r.status, statusText: r.statusText,
        error: {
          code: 'ANT_WRITE_REFUSED', ant_refused: true, details: 'zero rows returned', hint: null,
          message: 'That did NOT save. The database refused the change (' + verb + ' on ' + table
                 + ') — you may not have permission, or the record moved. Nothing was changed.'
        }
      };
    }

    function attach(b, table, verb, selected) {
      if (!b || typeof b.then !== 'function') return b;
      var origThen = b.then.bind(b);
      var origSel = (typeof b.select === 'function') ? b.select.bind(b) : null;
      var didSel = !!selected;

      if (origSel) {
        b.select = function () {
          didSel = true;
          var s = origSel.apply(null, arguments);
          return (s && s !== b) ? attach(s, table, verb, true) : b;
        };
      }
      b.then = function (res, rej) {
        var exec = origThen;
        if (!didSel && origSel) {
          didSel = true;
          try {
            var s = origSel();                             // force a representation
            if (s && s !== b && typeof s.then === 'function') exec = s.then.bind(s);
          } catch (e) { /* a forced select must never be the reason a write fails */ }
        }
        var judge = mustReturnRow(verb, b);                // read the filters AFTER the chain is built
        return new Promise(function (ok, no) { exec(ok, no); })
          .then(function (r) { return judge ? verdict(r, table, verb) : r; })
          .then(res, rej);
      };
      b['catch'] = function (rej) { return b.then(undefined, rej); };
      b['finally'] = function (fn) {
        return b.then(function (v) { if (fn) fn(); return v; },
                      function (e) { if (fn) fn(); throw e; });
      };
      return b;
    }

    var origCreate = window.supabase.createClient;
    window.supabase.createClient = function () {
      var client = origCreate.apply(this, arguments);
      try {
        var origFrom = client.from.bind(client);
        client.from = function (table) {
          var q = origFrom(table);
          try {
            ['update', 'insert', 'upsert', 'delete'].forEach(function (verb) {
              if (typeof q[verb] !== 'function') return;
              var orig = q[verb].bind(q);
              q[verb] = function () { return attach(orig.apply(null, arguments), table, verb, false); };
            });
          } catch (e) { /* a wrapper fault must never break a write */ }
          return q;
        };
      } catch (e) { /* fall back to the raw client */ }
      return client;
    };
    window.__ANT_WRITE_GUARD = stats;                     // diagnostics; also how tests detect it
  } catch (e) { /* the guard can never be the reason a page fails */ }
})();
