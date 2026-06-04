// Service worker for Ant Field (tech-ant-chat PWA).
// Minimal install + activate. Keeps the page installable on Android
// home screen and gives techs a basic offline shell.
//
// Bumped 2026-06-04 — adds install support so Jimmy can finally save
// it to home screen as a real app.
const CACHE = 'ant-field-v1';
const SHELL = [
  '/tech-ant-chat.html',
  '/ant-spine.js',
  '/api-spec/client/ant-client.js',
  '/manifest-tech.json',
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

// Network-first for everything (we want fresh data when online),
// fall back to cache for the basic shell when offline.
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;
  // Only handle same-origin navigation + static GETs
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  evt.respondWith(
    fetch(req).then((res) => {
      // Cache the shell files as we see them
      if (SHELL.some((p) => url.pathname === p || url.pathname.endsWith(p))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('/tech-ant-chat.html')))
  );
});
