// Service worker for Ant Field PWA. Network-first for everything (we're
// always-online assumption for repair techs), but caches the last-loaded
// dashboard HTML so a brief drop doesn't crash the app.
const CACHE_VERSION = 'ant-field-v1';
const STATIC_FILES = [
  '/tech-daily-dashboard.html',
  '/tech-ant-live.html',
  '/tech-performance.html',
  '/tech-payouts.html',
  '/tech-day-off.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(res => {
      const clone = res.clone();
      if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
        caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
