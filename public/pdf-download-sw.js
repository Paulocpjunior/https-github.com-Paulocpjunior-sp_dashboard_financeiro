const PDF_CACHE = 'sp-pdf-downloads-v1';
const PDF_PATH = '/__pdf-download__/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PDF_PATH)) return;

  event.respondWith((async () => {
    const cache = await caches.open(PDF_CACHE);
    const response = await cache.match(event.request.url);
    if (!response) {
      return new Response('PDF não encontrado.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return response;
  })());
});
