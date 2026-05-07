// Service worker — network-first pra HTML e app.js (sempre serve a versão
// nova quando online; cai pro cache só offline). Stale-while-revalidate
// pra ícones / manifest / assets pesados que mudam pouco.
const CACHE = 'agenda-tenis-v152';
const SHELL_OFFLINE = ['/', '/app.js', '/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', (e) => {
  // Pré-cacheia o shell pra ter fallback offline desde o primeiro carregamento
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_OFFLINE).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

const NETWORK_FIRST_PATHS = new Set(['/', '/app.js', '/index.html']);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  if (NETWORK_FIRST_PATHS.has(url.pathname)) {
    // Network-first: tenta rede; se falhar (offline), serve cache
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(e.request, res.clone());
        }
        return res;
      } catch {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(e.request);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Stale-while-revalidate pra outros assets (ícones, etc)
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
