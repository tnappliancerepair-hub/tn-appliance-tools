// tech-autoupdate — kills the "close and reopen to get the fix" tax.
//
// The Ant Field service worker (sw-tech.js) is stale-while-revalidate: it serves
// the CACHED page instantly (great for weak signal) and refreshes the cache in the
// background — so a freshly deployed fix only shows up the NEXT time the tech opens
// the app. This watcher notices when a new version has deployed and offers a one-tap
// "Update now" so the fix lands immediately in the field, with no instructions.
//
// How it detects a deploy: it HEADs its own page (cache-busted, straight to origin)
// and watches the ETag / Last-Modified. Netlify changes those when the file content
// changes — automatic, no build step, no version file to bump. If the network is
// down the check simply no-ops (never nags on bad signal).
//
// It NEVER reloads on its own — the tech taps Update when they're ready, so a
// half-typed report is never lost. Include on tech pages: <script src="/tech-autoupdate.js" defer></script>
(function () {
  'use strict';
  if (!window.fetch) return;
  var CHECK_MS = 120000;            // check every 2 min
  var baseline = null;             // version marker captured on load
  var dismissedFor = null;         // a version the tech chose to skip this session
  var path = location.pathname;    // watch THIS page (the shell file that changed)

  async function marker() {
    try {
      var r = await fetch(path + '?_uv=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
      if (!r || !r.ok) return null;
      return r.headers.get('etag') || r.headers.get('last-modified') || null;
    } catch (_) { return null; }    // offline / weak signal -> ignore
  }

  async function check() {
    var v = await marker();
    if (v == null) return;                 // couldn't read — leave baseline alone
    if (baseline === null) { baseline = v; return; }
    if (v !== baseline && v !== dismissedFor) showBar(v);
  }

  function showBar(v) {
    if (document.getElementById('ant-update-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'ant-update-bar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#1f8f3a;color:#fff;font-weight:800;font-size:15px;padding:13px 14px calc(13px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:10px;box-shadow:0 -3px 14px rgba(0,0,0,.32);font-family:inherit';
    var label = document.createElement('span');
    label.textContent = '🔄 New version ready';
    label.style.cssText = 'flex:1';
    var upd = document.createElement('button');
    upd.textContent = 'Update now';
    upd.style.cssText = 'background:#fff;color:#137a30;border:0;border-radius:9px;padding:10px 15px;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit';
    upd.onclick = function () { doUpdate(); };
    var x = document.createElement('button');
    x.textContent = 'Later';
    x.setAttribute('aria-label', 'Dismiss update');
    x.style.cssText = 'background:transparent;color:#eafff0;border:1px solid rgba(255,255,255,.5);border-radius:9px;padding:10px 12px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit';
    x.onclick = function () { dismissedFor = v; bar.remove(); };
    bar.appendChild(label); bar.appendChild(upd); bar.appendChild(x);
    document.body.appendChild(bar);
  }

  async function doUpdate() {
    var btn = document.querySelector('#ant-update-bar button'); if (btn) { btn.textContent = 'Updating…'; btn.disabled = true; }
    // Drop the SW caches + refresh the registration so the reload pulls the fresh
    // shell (the tech already has signal — that's how the banner appeared).
    try { if (window.caches) { var keys = await caches.keys(); await Promise.all(keys.map(function (k) { return caches.delete(k); })); } } catch (_) {}
    try { if (navigator.serviceWorker) { var regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(function (r) { return r.update(); })); } } catch (_) {}
    // cache-bust the reload so no layer serves the old page
    try { location.replace(path + (location.search ? location.search + '&' : '?') + '_r=' + Date.now() + location.hash); }
    catch (_) { location.reload(); }
  }

  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  // baseline on load (slight delay so it doesn't compete with first paint / data fetch)
  setTimeout(check, 4000);
})();
