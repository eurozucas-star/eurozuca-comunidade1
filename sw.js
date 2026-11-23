// Service worker da Eurozuca: permite instalar a app e mostra uma página offline.
// Nunca guarda respostas da API (contas e anúncios vêm sempre do servidor).
const VERSION = 'ez-v1';
const SHELL = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // Páginas: sempre da rede (versão mais recente); se não houver internet, usa a última cópia ou a página offline.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(async () => (await caches.match(req)) || caches.match('/offline.html'))
    );
    return;
  }
  if (url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
