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
const CACHE_VERSION = 'ant-field-v19-2026-07-16-secondop';

// Pre-cache the pages techs actually work from + shared assets. Pre-caching
// happens on install (good signal — first visit / add-to-home-screen); after
// that the page opens from cache even with no signal.
const STATIC_FILES = [
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
        const cachedNow = await cache.match(req);
        if (cachedNow) { net.catch(() => {}); return cachedNow; }  // instant, revalidates in bg
      }
      // Shell assets (JS/CSS): short network race, fast fallback to cache.
      const timeout = new Promise((r) => setTimeout(() => r('__TIMEOUT__'), 1200));
      const first = await Promise.race([net, timeout]);
      if (first && first !== '__TIMEOUT__') return first;     // network won → fresh
      const cached = await cache.match(req);                  // slow/offline → cache
      return (
        cached ||
        (await net) ||
        new Response('Offline — reconnect to load.', {
          status: 503, headers: { 'Content-Type': 'text/plain' },
        })
      );
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
