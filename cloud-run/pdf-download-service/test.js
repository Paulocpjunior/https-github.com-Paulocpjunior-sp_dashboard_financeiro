const assert = require('node:assert/strict');
const test = require('node:test');
const { BOLETO_HEADERS, buildBoletoCsv, createServer, normalizeBoletoRows, sanitizeFileName } = require('./index');

test('sanitizes and preserves the PDF extension', () => {
  assert.equal(sanitizeFileName('base faturamento.pdf'), 'base-faturamento.pdf');
});

test('responds to the same-origin warmup endpoint', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/pdf-download/health`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  } finally {
    server.close();
  }
});

test('allows the production site to upload directly', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/pdf-download`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://gen-lang-client-0888019226.web.app' },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://gen-lang-client-0888019226.web.app');
    assert.match(response.headers.get('access-control-allow-headers'), /X-PDF-Filename/i);
  } finally {
    server.close();
  }
});

test('prepares a binary PDF upload and downloads a real attachment', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/pdf-download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-PDF-Filename': 'base-faturamento-2026-09.pdf',
        Origin: 'https://gen-lang-client-0888019226.web.app',
      },
      body: Buffer.from('%PDF-test'),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://gen-lang-client-0888019226.web.app');
    const { downloadUrl } = await response.json();
    const download = await fetch(`http://127.0.0.1:${port}${downloadUrl}`);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="base-faturamento-2026-09.pdf"');
    assert.equal(Buffer.from(await download.arrayBuffer()).toString('ascii'), '%PDF-test');
  } finally {
    server.close();
  }
});

test('builds the 19-column Boleto Cloud CSV with the vault token only on the server', () => {
  const row = Array.from({ length: BOLETO_HEADERS.length - 1 }, (_, index) => `campo-${index + 1}`);
  const csv = buildBoletoCsv([row], 'token-seguro');
  const lines = csv.replace(/^\uFEFF/, '').split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split(';').length, 19);
  assert.equal(lines[1].split(';').length, 19);
  assert.equal(lines[1].split(';')[0], 'token-seguro');
});

test('rejects malformed Boleto Cloud rows and unsafe token delimiters', () => {
  assert.throws(() => normalizeBoletoRows([]), /invalid boleto rows/);
  assert.throws(() => normalizeBoletoRows([['curta']]), /invalid boleto row/);
  const row = Array.from({ length: BOLETO_HEADERS.length - 1 }, () => '');
  assert.throws(() => buildBoletoCsv([row], 'token;quebrado'), /invalid boleto token/);
});

test('rejects Boleto Cloud CSV generation without Firebase authentication', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/boleto-cloud-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [Array.from({ length: BOLETO_HEADERS.length - 1 }, () => '')] }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden' });
  } finally {
    server.close();
  }
});
