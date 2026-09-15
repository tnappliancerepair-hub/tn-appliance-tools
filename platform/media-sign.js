// media-sign.js — turns tenant-scoped media refs into short-lived SIGNED URLs on the staff
// apps. Media lives in Cloudflare R2 (private, zero-egress); platform-media-urls signs a
// batch of refs but ONLY the caller's own tenant's objects (it verifies the staff Supabase
// session and folder-prefix-matches each ref to that company). Any element with
// data-ph="<ref>" (img/video src) or data-phhref="<ref>" (link href) is filled with a signed
// URL after render. A MutationObserver keeps up with re-renders.
//
// ⚠️ A PHOTO THAT CANNOT BE SIGNED MUST NOT LOOK LIKE A PHOTO THAT DOES NOT EXIST.
// Jimmy, 2026-09-15: "no pics on office end" -- while the photos were provably in the
// database, correctly company- and job-scoped. Every tile ships as an <img> with NO src and
// waits on this file, so all three of these read to a human as "there are no pictures":
//   1. the session was not ready on first paint -> the old code did a silent `return` with no
//      retry, and only a DOM mutation could ever trigger another attempt;
//   2. the board sat open past the signature's ONE HOUR life -> every loaded tile went broken
//      and could never recover, because data-phdone was permanent and the cache never expired;
//   3. the signing call failed once -> no retry, no message.
// So: the cache expires under the signature, a missing session is retried rather than
// swallowed, an image that fails to load re-signs itself once, and anything still unresolved
// is marked data-phfail so the host page can show a placeholder instead of a broken glyph.
(function () {
  var cfg = window.ANT_SUPABASE || {};
  var sb = null;
  try { if (cfg.url && window.supabase) sb = window.supabase.createClient(cfg.url, cfg.anonKey); } catch (_) {}

  var TTL_MS = 50 * 60 * 1000;   // signatures live 1h server-side; re-sign before that
  var cache = {};                // ref -> { url, at }
  var timer = null;
  var noSessionTries = 0;

  function fresh(ref) {
    var c = cache[ref];
    return (c && (Date.now() - c.at) < TTL_MS) ? c.url : null;
  }

  // Re-sign one element: forget the cached URL and let the next pass fetch a new one.
  function resign(el, ref) {
    if (!ref) return;
    delete cache[ref];
    el.removeAttribute('data-phdone');
    el.removeAttribute('data-phhrefdone');
    schedule();
  }

  function apply() {
    document.querySelectorAll('[data-ph]:not([data-phdone])').forEach(function (el) {
      var r = el.getAttribute('data-ph'), u = fresh(r);
      if (!u) return;
      el.setAttribute('data-phdone', '1');
      el.removeAttribute('data-phfail');
      if (el.tagName === 'IMG' && !el.getAttribute('data-phwired')) {
        el.setAttribute('data-phwired', '1');
        // Only show it once the bytes really arrive — a src'd <img> that 404s draws the
        // browser's broken-image glyph, which is worse than an honest placeholder.
        el.addEventListener('load', function () { el.removeAttribute('data-phfail'); });
        el.addEventListener('error', function () {
          // One silent retry covers an expired signature or a transient blip; after that,
          // say so rather than leaving a blank square.
          if (el.getAttribute('data-phretried')) { el.setAttribute('data-phfail', '1'); return; }
          el.setAttribute('data-phretried', '1');
          resign(el, r);
        });
      }
      el.src = u;
    });
    document.querySelectorAll('[data-phhref]:not([data-phhrefdone])').forEach(function (el) {
      var r = el.getAttribute('data-phhref'), u = fresh(r);
      if (u) { el.href = u; el.setAttribute('data-phhrefdone', '1'); }
    });
  }

  function run() {
    if (!sb) return;
    var refs = {};
    document.querySelectorAll('[data-ph]:not([data-phdone]),[data-phhref]:not([data-phhrefdone])').forEach(function (el) {
      var r = el.getAttribute('data-ph') || el.getAttribute('data-phhref');
      if (r && !fresh(r)) refs[r] = 1;
    });
    var need = Object.keys(refs);
    if (!need.length) { apply(); return; }
    sb.auth.getSession().then(function (res) {
      var tok = res && res.data && res.data.session && res.data.session.access_token;
      if (!tok) {
        // The session usually hydrates a beat after first paint. Keep asking for a short
        // while instead of giving up forever on a race.
        if (noSessionTries < 6) { noSessionTries++; setTimeout(run, 400 * noSessionTries); }
        else markFail();
        return;
      }
      noSessionTries = 0;
      return fetch('/.netlify/functions/platform-media-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ refs: need })
      }).then(function (r) { return r.json(); }).then(function (d) {
        var got = 0;
        if (d && d.urls) Object.keys(d.urls).forEach(function (k) { if (d.urls[k]) { cache[k] = { url: d.urls[k], at: Date.now() }; got++; } });
        apply();
        if (!got) markFail();
      }).catch(function () { setTimeout(run, 1500); });
    }).catch(function () { setTimeout(run, 1500); });
  }

  // Mark whatever is still unresolved so the page can show a placeholder. Never throws.
  function markFail() {
    try {
      document.querySelectorAll('[data-ph]:not([data-phdone])').forEach(function (el) { el.setAttribute('data-phfail', '1'); });
    } catch (_) {}
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(run, 100); }
  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    run();
    // A board left open all day outlives its signatures. Sweep the stale ones back off so
    // they re-sign on the next pass rather than quietly going broken.
    setInterval(function () {
      var stale = 0;
      Object.keys(cache).forEach(function (k) { if ((Date.now() - cache[k].at) >= TTL_MS) { delete cache[k]; stale++; } });
      if (!stale) return;
      document.querySelectorAll('[data-phdone],[data-phhrefdone]').forEach(function (el) {
        var r = el.getAttribute('data-ph') || el.getAttribute('data-phhref');
        if (r && !fresh(r)) { el.removeAttribute('data-phdone'); el.removeAttribute('data-phhrefdone'); el.removeAttribute('data-phretried'); }
      });
      schedule();
    }, 5 * 60 * 1000);
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
  window.antMediaResign = run;
})();
