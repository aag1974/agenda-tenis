// Service worker — cache simples do shell estático para funcionar offline
const CACHE = 'agenda-tenis-v23';
const SHELL = ['/', '/app.js', '/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Always go to network for API calls
  if (url.pathname.startsWith('/api/')) return;
  // Stale-while-revalidate for static assets
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const networkPromise = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await networkPromise) || new Response('Offline', { status: 503 });
  })());
});
