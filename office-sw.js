// Service worker for Ant Office (office PWA).
// Network-first so the cockpit is always fresh when online; falls back
// to cache shell when offline. Bumped 2026-06-04 — initial install.
const CACHE = 'ant-office-v1-2026-06-04';
const SHELL = [
  '/office-dashboard.html',
  '/office-today.html',
  '/office.html',
  '/office-nav.js',
  '/office-ask.js',
  '/ant-spine.js',
  '/manifest-office.json',
  '/icons/ant-512.svg',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for everything online. Cache shell fallback offline.
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  evt.respondWith(
    fetch(req).then((res) => {
      if (SHELL.some((p) => url.pathname === p || url.pathname.endsWith(p))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('/office-dashboard.html')))
  );
});
