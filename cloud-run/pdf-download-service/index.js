const http = require('node:http');
const { randomUUID } = require('node:crypto');

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const pendingPDFs = new Map();
const PDF_TTL_MS = 5 * 60 * 1000;

function sendText(response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
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

    const downloadMatch = request.url.match(/^\/api\/pdf-download\/([a-f0-9-]+)$/i);
    if (request.method === 'GET' && downloadMatch) {
      const entry = pendingPDFs.get(downloadMatch[1]);
      if (!entry || entry.expiresAt < Date.now()) {
        pendingPDFs.delete(downloadMatch[1]);
        sendText(response, 404, 'PDF expired');
        return;
      }

      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      let start = 0;
      let end = entry.pdf.length - 1;
      let status = 200;
      if (range) {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), end) : end;
        if (start > end || start >= entry.pdf.length) {
          response.writeHead(416, { 'Content-Range': `bytes */${entry.pdf.length}` });
          response.end();
          return;
        }
        status = 206;
      }

      const bytes = entry.pdf.subarray(start, end + 1);
      const headers = {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${entry.fileName}"`,
        'Content-Length': bytes.length,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${entry.pdf.length}`;
      response.writeHead(status, headers);
      response.end(bytes);
      return;
    }

    if (request.method !== 'POST' || request.url !== '/api/pdf-download') {
      sendText(response, 404, 'not found');
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

        const token = randomUUID();
        pendingPDFs.set(token, { pdf, fileName: sanitizeFileName(body.get('fileName')), expiresAt: Date.now() + PDF_TTL_MS });
        const cleanup = setTimeout(() => pendingPDFs.delete(token), PDF_TTL_MS);
        cleanup.unref();
        const payload = JSON.stringify({ downloadUrl: `/api/pdf-download/${token}` });
        response.writeHead(201, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          'Cache-Control': 'no-store',
        });
        response.end(payload);
      } catch {
        sendText(response, 400, 'invalid request');
      }
    });
  });
}

if (require.main === module) createServer().listen(Number(process.env.PORT) || 8080, '0.0.0.0');

module.exports = { createServer, sanitizeFileName, pendingPDFs };
