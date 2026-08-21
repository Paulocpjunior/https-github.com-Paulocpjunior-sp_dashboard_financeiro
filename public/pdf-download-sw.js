const pendingPDFs = new Map();
const DOWNLOAD_PREFIX = '/__pdf_download__/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'STORE_PDF' || !data.token || !(data.bytes instanceof ArrayBuffer)) return;

  pendingPDFs.set(data.token, {
    bytes: data.bytes,
    fileName: String(data.fileName || 'relatorio.pdf'),
  });
  event.source?.postMessage({ type: 'PDF_STORED', token: data.token });
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(DOWNLOAD_PREFIX)) return;

  const token = decodeURIComponent(url.pathname.slice(DOWNLOAD_PREFIX.length));
  const pdf = pendingPDFs.get(token);
  if (!pdf) {
    event.respondWith(new Response('PDF indisponivel ou ja baixado.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    }));
    return;
  }

  pendingPDFs.delete(token);
  const asciiName = pdf.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  event.respondWith(new Response(pdf.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
      'Content-Length': String(pdf.bytes.byteLength),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  }));
});
