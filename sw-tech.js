// Service worker for Ant Field PWA.
//
// 2026-06-16 — bad-signal fix. Techs (John in rural LA) couldn't OPEN the tool
// on weak signal while Housecall Pro loaded fine on the SAME signal. Cause: the
// old strategy was network-first, so on weak-but-alive signal the page fetch
// crawled instead of failing, and we never fell back to cache. HCP is a cached
// app that opens instantly. So: STALE-WHILE-REVALIDATE for the app shell
// (HTML + JS/CSS) — serve from cache immediately so the page opens with zero
// network wait, then refresh the cache in the background. Job DATA (API /
// Netlify-function GETs) stays network-first so it's never stale.
const CACHE_VERSION = 'ant-field-v64-2026-09-01-offlineheal';

// Self-healing offline page. NEVER a dead plain-text dead-end — it auto-retries every
// couple seconds + on 'online', so a transient blip on live signal recovers itself
// instead of stranding a tech on "Offline". Proper charset so the em-dash renders.
function offlineResponse() {
  const html = '<!doctype html><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Reconnecting…</title>'
    + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e120c;color:#eef2e8;'
    + 'font:16px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:24px}'
    + 'button{margin-top:18px;padding:13px 22px;border:0;border-radius:11px;background:#3f8f24;color:#fff;'
    + 'font-weight:800;font-size:16px}</style>'
    + '<div><div style="font-size:44px">🐜</div>'
    + '<p><b>Couldn’t reach the network just now.</b><br>Reconnecting automatically…</p>'
    + '<button onclick="location.reload()">Reload now</button></div>'
    + '<script>var t=setInterval(function(){fetch(location.href,{method:"HEAD",cache:"no-store"})'
    + '.then(function(r){if(r){clearInterval(t);location.reload();}}).catch(function(){});},2500);'
    + 'addEventListener("online",function(){location.reload();});</script>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Pre-cache the pages techs actually work from + shared assets. Pre-caching
// happens on install (good signal — first visit / add-to-home-screen); after
// that the page opens from cache even with no signal.
const STATIC_FILES = [
  '/tech.html',
  '/tech-job.html',
  '/tech-ant-chat.html',
  '/tech-daily-dashboard.html',
  '/tech-ant-live.html',
  '/tech-performance.html',
  '/tech-payouts.html',
  '/tech-day-off.html',
  '/ant-spine.js',
  '/tech-autoupdate.js',
  '/manifest-tech.json',
];

self.addEventListener('install', (event) => {
  // Cache files individually so one 404 can't fail the whole install.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(STATIC_FILES.map((f) => cache.add(f).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  // Only manage same-origin requests. Cross-origin (Xano API, CDNs) passes through.
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const isShellAsset = /\.(?:js|css|webmanifest|json|svg|png|woff2?)$/i.test(url.pathname);

  if (isHTML || isShellAsset) {
    // NETWORK-FIRST with a short timeout: always show the FRESH page/asset when
    // there's signal (so a deployed fix shows immediately — no more stale cached
    // versions), but if the network is slow/dead, fall back to cache fast so the
    // app still opens on weak signal (John's rural LA case). Best of both.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const net = fetch(req)
        .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      // On a navigation (opening a job) serve the cached page INSTANTLY if we
      // have it, and refresh the cache in the background — techs in the field
      // need the job to open on the first tap, not wait on a slow network.
      if (isHTML) {
        // Navigation: serve the cached page INSTANTLY if we have it (revalidate in bg).
        // If it's NOT cached, WAIT for the network — do NOT apply the short asset timeout
        // to a full-page open, since there's no cached alternative and a slow-but-alive
        // 5G fetch would otherwise be abandoned and dead-end on the offline page. Only
        // show the (self-healing) offline page if the network genuinely fails.
        const cachedNow = await cache.match(req);
        if (cachedNow) { net.catch(() => {}); return cachedNow; }  // instant, revalidates in bg
        const res = await net;                                     // wait for the real network
        return res || (await cache.match(req)) || offlineResponse();
      }
      // Shell assets (JS/CSS): short network race, fast fallback to cache.
      const timeout = new Promise((r) => setTimeout(() => r('__TIMEOUT__'), 1200));
      const first = await Promise.race([net, timeout]);
      if (first && first !== '__TIMEOUT__') return first;     // network won → fresh
      return (await cache.match(req)) || (await net) || offlineResponse();  // slow/offline → cache
    })());
    return;
  }

  // Everything else (data / API GETs): network-first, cache only as a fallback.
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

// ── Web Push ───────────────────────────────────────────────────────
// Show the notification Ant sent, and open the right page when tapped.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'Ant 🐜';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icons/ant-512.svg',
    badge: '/icons/ant-512.svg',
    tag: d.tag || undefined,
    data: { url: d.url || '/tech.html' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/tech.html';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.includes(url) && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  })());
});
