// Service worker for Ant customer PWA. Network-first with cache fallback.
const CACHE_VERSION = 'ant-customer-v1';
const STATIC_FILES = [
  '/customer-portal.html',
  '/upload.html',
  '/service-area.html',
  '/quote.html',
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
