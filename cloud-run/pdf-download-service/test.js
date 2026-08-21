const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer, sanitizeFileName } = require('./index');

test('sanitizes and preserves the PDF extension', () => {
  assert.equal(sanitizeFileName('base faturamento.pdf'), 'base-faturamento.pdf');
  assert.equal(sanitizeFileName('relatorio'), 'relatorio.pdf');
});

test('prepares a resumable real PDF attachment', async () => {
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
    assert.equal(response.status, 201);
    const { downloadUrl } = await response.json();
    const download = await fetch(`http://127.0.0.1:${port}${downloadUrl}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(download.headers.get('accept-ranges'), 'bytes');
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="base-faturamento-2026-09.pdf"');
    assert.equal(Buffer.from(await download.arrayBuffer()).toString('ascii'), '%PDF-test');

    const resumed = await fetch(`http://127.0.0.1:${port}${downloadUrl}`, {
      headers: { Range: 'bytes=5-8' },
    });
    assert.equal(resumed.status, 206);
    assert.equal(resumed.headers.get('content-range'), 'bytes 5-8/9');
    assert.equal(Buffer.from(await resumed.arrayBuffer()).toString('ascii'), 'test');
  } finally {
    server.close();
  }
});
