const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer, sanitizeFileName } = require('./index');

test('sanitizes and preserves the PDF extension', () => {
  assert.equal(sanitizeFileName('base faturamento.pdf'), 'base-faturamento.pdf');
  assert.equal(sanitizeFileName('relatorio'), 'relatorio.pdf');
});

test('returns a real PDF attachment', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const pdf = Buffer.from('%PDF-test');
    const body = new URLSearchParams({
      fileName: 'base-faturamento-2026-09.pdf',
      pdfBase64: pdf.toString('base64'),
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/pdf-download`, {
      method: 'POST',
      headers: {
        Origin: 'https://gen-lang-client-0888019226.web.app',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="base-faturamento-2026-09.pdf"');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii'), '%PDF-test');
  } finally {
    server.close();
  }
});
