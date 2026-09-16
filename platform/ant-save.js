/* ant-save.js — the durable outbox.
 *
 * WHY THIS EXISTS (Teddy, 2026-09-16):
 *   "A lot of these guys are traveling. They've got poor signal. They're trying to
 *    upload information on the app. Sometimes it doesn't save... we want them to be
 *    able to write things in and they can feel confident that it's going to save."
 *
 * The platform tech app had NO service worker and NO retry: every write was a bare
 * live round trip to Supabase. In a driveway with one bar that means the write dies,
 * the tech re-types it, and it dies again. Andre did it four times.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE:
 *   A write that fails because of SIGNAL is held and re-sent by itself.
 *   A write that fails because the SERVER SAID NO is never retried — it is reported.
 * Those two are opposite facts and must never share a code path. Queueing a refusal
 * would retry forever and tell the tech it is saved when it never will be; reporting
 * a dropped connection as a refusal is what made him re-type it four times.
 *
 * A queued write is NEVER called "Saved". It is "Saved on your phone" until the
 * server confirms it, and the tech can see the count on screen the whole time.
 */
(function () {
  if (window.AntSave) return;

  var KEY = 'ant_outbox_v1';
  var MAX_ITEMS = 60;
  var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // a week-old queued write is stale, not pending
  var hooks = {};                              // name -> fn, re-registered on every boot
  var flushing = false, timer = null, sbRef = null;

  // ── the queue itself ──────────────────────────────────────────────────────────
  function load() {
    try {
      var q = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(q)) return [];
      var cutoff = Date.now() - MAX_AGE_MS;
      return q.filter(function (it) { return it && it.at && it.at > cutoff; });
    } catch (_) { return []; }
  }
  function save(q) {
    try { localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_ITEMS))); } catch (_) {}
    paint(q.length);
  }
  function count() { return load().length; }

  // ── telling a dropped connection apart from a refusal ─────────────────────────
  // Anything carrying a Postgres / PostgREST code means the server answered and
  // declined. Only a transport failure is worth holding onto.
  function networkish(err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (!err) return false;
    if (err.code) return false;                       // server spoke -> not a signal problem
    var m = ((err.message || '') + ' ' + (err.details || '') + ' ' + (err.name || '')).toLowerCase();
    return /failed to fetch|fetch failed|networkerror|network error|load failed|timeout|timed out|abort|connection|socket|502|503|504|gateway|offline/.test(m);
  }

  // ── running one write against the server ──────────────────────────────────────
  function settle(p) {
    return p.then(function (r) {
      if (r && r.error) {
        return networkish(r.error)
          ? { state: 'signal', error: r.error }
          : { state: 'refused', error: r.error, message: r.error.message || 'the server refused that write' };
      }
      if (!r || !Array.isArray(r.data) || !r.data.length) {
        return { state: 'refused', message: 'that write was blocked' };
      }
      return { state: 'ok', data: r.data };
    }, function (e) {
      return networkish(e) ? { state: 'signal', error: e }
                           : { state: 'refused', error: e, message: (e && e.message) || 'that write failed' };
    });
  }

  function run(sb, it) {
    // APPEND is a read-modify-write, and it re-reads at the moment it actually goes
    // out — not when it was queued. That is the whole point: a note held for twenty
    // minutes must land UNDER whatever the office typed in the meantime, never over
    // it. Queueing a flat copy of the column would blank Danielle's note.
    if (it.op === 'append') {
      var col = it.column, mc = it.matchCol || 'id';
      return sb.from(it.table).select(col).eq(mc, it.matchVal).limit(1).then(function (cur) {
        if (cur && cur.error) {
          return networkish(cur.error) ? { state: 'signal', error: cur.error }
                                       : { state: 'refused', error: cur.error, message: cur.error.message };
        }
        if (!cur || !Array.isArray(cur.data)) return { state: 'signal' };
        var live = (cur.data[0] && cur.data[0][col]) || '';
        var next = (String(live).trim() ? String(live).replace(/\s+$/, '') + '\n\n' : '') + it.text;
        var u = {}; u[col] = next;
        return settle(sb.from(it.table).update(u).eq(mc, it.matchVal).select('id'))
          .then(function (res) { if (res.state === 'ok') res.value = next; return res; });
      }, function (e) {
        return networkish(e) ? { state: 'signal', error: e }
                             : { state: 'refused', error: e, message: (e && e.message) || 'that write failed' };
      });
    }
    var q = sb.from(it.table);
    if (it.op === 'insert')       q = q.insert(it.row);
    else if (it.op === 'upsert')  q = q.upsert(it.row, it.onConflict ? { onConflict: it.onConflict } : undefined);
    else {
      q = q.update(it.row);
      var m = it.match || {};
      Object.keys(m).forEach(function (k) { q = q.eq(k, m[k]); });
    }
    // Zero rows and NO error is the documented silent RLS block — never a save, and
    // never worth retrying, because the answer will be the same next time.
    return settle(q.select(it.returning || 'id'));
  }

  // ── queueing ──────────────────────────────────────────────────────────────────
  // Same key + same shape => MERGE, never replace. Two partial upserts of one report
  // row ({failed_component} then {root_cause}) must both land; replacing would throw
  // the first one away, which is the exact data loss this module exists to stop.
  function enqueue(it) {
    var q = load();
    if (it.key && it.op !== 'insert') {
      for (var i = 0; i < q.length; i++) {
        var p = q[i];
        if (p.key === it.key && p.table === it.table && p.op === it.op) {
          if (it.op === 'append') { p.text = String(p.text || '') + '\n\n' + String(it.text || ''); p.at = Date.now(); save(q); return p; }
          p.row = Object.assign({}, p.row, it.row);
          p.at = Date.now();
          if (it.then) { p.then = it.then; p.thenArg = it.thenArg; }
          save(q); return p;
        }
      }
    }
    it.at = Date.now();
    it.id = 'w' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    q.push(it); save(q); schedule();
    return it;
  }

  // ── flushing ──────────────────────────────────────────────────────────────────
  function flush() {
    if (flushing || !sbRef) return Promise.resolve();
    var q = load();
    if (!q.length) { paint(0); return Promise.resolve(); }
    flushing = true;
    var it = q[0];                       // FIFO: a report lands before the status that follows it
    return run(sbRef, it).then(function (res) {
      flushing = false;
      if (res.state === 'signal') { schedule(); return; }   // still no signal — keep it, try again
      // Landed, or the server refused it. Either way it leaves the queue: a refusal
      // retried forever is a lie told on a loop.
      var cur = load().filter(function (x) { return x.id !== it.id; });
      save(cur);
      if (res.state === 'ok' && it.then && hooks[it.then]) {
        try { hooks[it.then](it.thenArg, res); } catch (_) {}
      }
      if (res.state === 'refused') {
        try { window.dispatchEvent(new CustomEvent('antsave:refused', { detail: { item: it, result: res } })); } catch (_) {}
      }
      if (cur.length) return flush();                        // keep draining
      paint(0);
    }, function () { flushing = false; schedule(); });
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(); }, 15000);
  }

  // ── what the tech sees ────────────────────────────────────────────────────────
  // Never silent: if something is held on his phone he can see it, and he sees it go.
  function bar() {
    var el = document.getElementById('antsave-bar');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'antsave-bar';
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;display:none;' +
      'padding:9px 14px;font:600 13.5px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'text-align:center;color:#231a02;background:#f5a623;box-shadow:0 2px 10px rgba(0,0,0,.22)';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }
  function paint(n) {
    if (!document.body) return;
    var el = bar();
    if (!n) {
      if (el.getAttribute('data-had') === '1') {
        el.setAttribute('data-had', '0');
        el.style.background = '#10b981'; el.style.color = '#04140d';
        el.textContent = '✅ Sent — everything on your phone is in the office now.';
        setTimeout(function () { el.style.display = 'none'; }, 3200);
      } else { el.style.display = 'none'; }
      return;
    }
    el.setAttribute('data-had', '1');
    el.style.background = '#f5a623'; el.style.color = '#231a02'; el.style.display = 'block';
    el.textContent = '📡 ' + n + (n === 1 ? ' thing is' : ' things are') +
      ' saved on your phone — sending the moment you have signal. Safe to keep working.';
  }

  // ── public ────────────────────────────────────────────────────────────────────
  var AntSave = {
    // Register the sb client + drain anything left over from last time.
    attach: function (sb) {
      sbRef = sb;
      window.addEventListener('online', function () { flush(); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });
      paint(count());
      flush();
      return AntSave;
    },
    // Named follow-on work, re-registered on every boot so it still runs after the
    // app was closed and reopened with items still in the queue.
    on: function (name, fn) { hooks[name] = fn; return AntSave; },
    pending: count,

    /* write(opts) -> { ok, queued, refused, message }
     *   table, op ('upsert'|'update'|'insert'), row, onConflict, match, returning,
     *   key   — merge key so repeat writes to the same row collapse into one
     *   then  — name registered with AntSave.on(), run once the write truly lands
     *   noQueue — true for writes that are meaningless later (a live status ping)
     */
    write: function (opts) {
      var sb = opts.sb || sbRef;
      if (!sb) return Promise.resolve({ ok: false, refused: true, message: 'not signed in yet' });
      var it = {
        table: opts.table, op: opts.op || 'update', row: opts.row,
        onConflict: opts.onConflict, match: opts.match, returning: opts.returning,
        column: opts.column, matchCol: opts.matchCol, matchVal: opts.matchVal, text: opts.text,
        key: opts.key, then: opts.then, thenArg: opts.thenArg
      };
      return run(sb, it).then(function (res) {
        if (res.state === 'ok') {
          if (it.then && hooks[it.then]) { try { hooks[it.then](it.thenArg, res); } catch (_) {} }
          return { ok: true, queued: false, refused: false, data: res.data, value: res.value };
        }
        if (res.state === 'refused') {
          return { ok: false, queued: false, refused: true, message: res.message || 'that write was blocked' };
        }
        if (opts.noQueue) return { ok: false, queued: false, refused: false, message: 'no signal just now' };
        enqueue(it);
        return { ok: false, queued: true, refused: false,
                 message: 'Saved on your phone — it sends itself the moment you have signal.' };
      });
    }
  };

  window.AntSave = AntSave;
})();
