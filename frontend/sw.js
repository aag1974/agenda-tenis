// Service worker — network-first pra HTML e app.js (sempre serve a versão
// nova quando online; cai pro cache só offline). Stale-while-revalidate
// pra ícones / manifest / assets pesados que mudam pouco.
const CACHE = 'tennis-flow-0.9.9';
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
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(staleWhileRevalidate(e.request));
});

// Helpers blindados — qualquer falha de cache.put (Vary, redirect, quota)
// não pode quebrar respondWith. Só retornamos a Response da rede ou fallback.
async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      caches.open(CACHE)
        .then(cache => cache.put(request, res.clone()))
        .catch(() => {});
    }
    return res;
  } catch {
    try {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch {}
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch {}
  const cached = cache ? await cache.match(request).catch(() => null) : null;
  const networkPromise = fetch(request).then((res) => {
    if (cache && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response('Offline', { status: 503 });
}

// ===== Web Push =====
// O servidor manda payload JSON: { title, body, badge, tag, url }
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || '🎾 Tennis Flow';
  const body = data.body || 'Há um novo alerta no seu quadro.';
  const tag = data.tag || 'alerts';
  const url = data.url || '/';
  const options = {
    body,
    tag,
    renotify: true,
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    data: { url },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // App badge no ícone (iOS PWA / Android / desktop)
    if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
      try {
        if (data.badge > 0) await self.navigator.setAppBadge(data.badge);
        else await self.navigator.clearAppBadge?.();
      } catch {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Se já tem janela do app aberta, foca ela
    for (const client of all) {
      if (client.url.includes(self.location.origin)) {
        await client.focus();
        client.postMessage({ type: 'open-url', url: targetUrl });
        return;
      }
    }
    // Senão, abre nova
    await self.clients.openWindow(targetUrl);
  })());
});
