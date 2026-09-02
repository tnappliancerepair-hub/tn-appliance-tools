// boot-watchdog — the "never an infinite spinner" safety net for every platform page.
//
// WHY: the seats boot by firing a Supabase query (auth + first data load). NOTHING on
// these pages puts a timeout on that query, so on flaky/blocked Wi-Fi a page can sit on
// "Loading…" forever with no failure path — the single biggest silent-hang risk in a
// live demo. supa-guard covers the *library didn't load* case; this covers the *library
// loaded but the network hung* case.
//
// HOW (zero per-page wiring): it passively observes window.fetch. If ANY fetch RESOLVES
// (a real Response came back — even a 4xx/5xx means the network is alive) within the
// window, the page is fine and the watchdog stays silent. If nothing resolves in time
// (a true hang, or offline), it drops a friendly "Slow connection — Reload" panel that
// self-heals the moment data starts flowing again. Load it right after supa-guard.
//
// Optional override: a page MAY call window.bootOK() when its first render lands to cancel
// the watchdog explicitly — but it is NOT required (the fetch observer does it automatically).
(function () {
  'use strict';
  try {
    var TIMEOUT_MS = Number(window.ANT_BOOT_TIMEOUT_MS) || 12000;
    var alive = false;        // a fetch has RESOLVED (network reached)
    var okd = false;          // a page called bootOK() explicitly

    // Passive fetch observer — returns the SAME promise, just watches it settle. Marks
    // alive only on RESOLVE (a hung network never resolves; an offline error rejects fast
    // and is intentionally NOT counted as alive so the panel still shows).
    if (typeof window.fetch === 'function' && !window.__antFetchWatched) {
      window.__antFetchWatched = true;
      var orig = window.fetch;
      window.fetch = function () {
        var p;
        try { p = orig.apply(this, arguments); } catch (e) { throw e; }
        try { p.then(function () { alive = true; }, function () {}); } catch (_) {}
        return p;
      };
    }

    window.bootOK = function () { okd = true; hide(); };

    function hide() {
      var el = document.getElementById('ant-boot-watchdog');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function show() {
      if (okd || alive) return;                                   // page is fine
      if (document.getElementById('ant-supa-guard')) return;      // library-missing panel owns the screen
      if (document.getElementById('ant-boot-watchdog')) return;
      var d = document.createElement('div');
      d.id = 'ant-boot-watchdog';
      d.setAttribute('style',
        'position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;'
        + 'background:#0e120c;color:#eef2e8;text-align:center;padding:24px;'
        + 'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif');
      d.innerHTML =
        '<div style="max-width:460px">'
        + '<div style="font-size:46px">🐜</div>'
        + '<h1 style="font-size:20px;margin:.5em 0 .3em;font-weight:800">Taking longer than usual</h1>'
        + '<p style="opacity:.85;margin:0 0 4px">This page is waiting on a slow or blocked connection. '
        + 'Check your Wi‑Fi (or an ad‑blocker / corporate proxy), then reload.</p>'
        + '<button id="ant-boot-reload" style="margin-top:18px;padding:13px 24px;border:0;border-radius:11px;'
        + 'background:#3f8f24;color:#fff;font-weight:800;font-size:16px;cursor:pointer">Reload</button>'
        + '<p style="opacity:.5;font-size:13px;margin-top:14px">Retrying automatically…</p>'
        + '</div>';
      (document.body || document.documentElement).appendChild(d);
      var b = document.getElementById('ant-boot-reload');
      if (b) b.onclick = function () { location.reload(); };
    }

    // Fire once at the deadline; if the data was just slow (not truly dead), a fetch may
    // resolve AFTER the panel shows — poll a few times and quietly remove it when it does.
    setTimeout(function () {
      show();
      var tries = 0;
      var t = setInterval(function () {
        if (okd || alive) { hide(); clearInterval(t); return; }
        if (++tries > 30) clearInterval(t); // ~1 min then rest (the Reload button remains)
      }, 2000);
    }, TIMEOUT_MS);

    window.addEventListener('online', function () { location.reload(); });
  } catch (_) { /* never let the safety net itself break a page */ }
})();
