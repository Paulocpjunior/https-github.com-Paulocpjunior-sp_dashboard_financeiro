const http = require('node:http');

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  'https://gen-lang-client-0888019226.web.app',
  'https://gen-lang-client-0888019226.firebaseapp.com',
]);

function sendText(response, status, text) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(text);
}

function sanitizeFileName(value) {
  const name = String(value || 'base-faturamento.pdf').replace(/[^a-zA-Z0-9._-]/g, '-');
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendText(response, 200, 'ok');
      return;
    }

    if (request.method !== 'POST' || !request.url.endsWith('/api/pdf-download')) {
      sendText(response, 404, 'not found');
      return;
    }

    const origin = request.headers.origin || '';
    if (!ALLOWED_ORIGINS.has(origin)) {
      sendText(response, 403, 'origin not allowed');
      return;
    }

    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const pdf = Buffer.from(body.get('pdfBase64') || '', 'base64');
        if (pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
          sendText(response, 400, 'invalid PDF');
          return;
        }

        const fileName = sanitizeFileName(body.get('fileName'));
        response.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': pdf.length,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(pdf);
      } catch {
        sendText(response, 400, 'invalid request');
      }
    });
  });
}

if (require.main === module) {
  createServer().listen(Number(process.env.PORT) || 8080, '0.0.0.0');
}

module.exports = { createServer, sanitizeFileName };
