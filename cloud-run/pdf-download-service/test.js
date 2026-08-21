const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer, sanitizeFileName } = require('./index');

test('sanitizes and preserves the PDF extension', () => {
  assert.equal(sanitizeFileName('base faturamento.pdf'), 'base-faturamento.pdf');
});

test('prepares and downloads a real PDF attachment', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const body = new URLSearchParams({ fileName: 'base-faturamento-2026-09.pdf', pdfBase64: Buffer.from('%PDF-test').toString('base64') });
    const response = await fetch(`http://127.0.0.1:${port}/api/pdf-download`, { method: 'POST', body });
    assert.equal(response.status, 201);
    const { downloadUrl } = await response.json();
    const download = await fetch(`http://127.0.0.1:${port}${downloadUrl}`);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="base-faturamento-2026-09.pdf"');
    assert.equal(Buffer.from(await download.arrayBuffer()).toString('ascii'), '%PDF-test');
  } finally {
    server.close();
  }
});
