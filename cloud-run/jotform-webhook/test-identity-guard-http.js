const assert = require('node:assert/strict');
const { google } = require('googleapis');
const originalAuth = google.auth.GoogleAuth;
const originalFetch = globalThis.fetch;
const calls = [];
const fields = values => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { stringValue: v }]));
google.auth.GoogleAuth = class { async getClient() { return { getAccessToken: async () => ({ token: 'synthetic-test-token' }) }; } };
globalThis.fetch = async (url, options) => {
  const target = new URL(url);
  assert.equal(target.hostname, 'firestore.googleapis.com');
  calls.push({ url: target.href, method: options.method, body: JSON.parse(options.body) });
  if (target.pathname.endsWith(':runQuery')) return { ok: true, json: async () => [
    { document: { name: 'projects/test/databases/(default)/documents/transactions/safe', fields: fields({ movement: 'Saída', submissionId: 'test-conflict' }) } },
    { document: { name: 'projects/test/databases/(default)/documents/transactions/conflict', fields: fields({ type: 'Recebimento Wix / Cartao', submissionId: 'test-conflict' }) } },
  ] };
  assert.ok(target.pathname.includes('/jotformEvents/'), 'No financial writes, cleanup or new document may follow a conflict');
  return { ok: true };
};

(async () => {
  const { app } = require('./index');
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionID: 'test-conflict', rawRequest: JSON.stringify({ q4_tipoDe: 'Saída de Caixa / Contas a Pagar', q291_docpago: 'NÃO', q44_movimentacao44: 'Synthetic expense', q56_valorRefvalor56: 'R$ 100,00' }) }) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'IDENTITY_CONFLICT:DIRECTION');
    const writes = calls.filter(call => call.method === 'PATCH');
    assert.equal(writes.length, 1);
    assert.ok(writes[0].url.includes('/jotformEvents/'));
    assert.equal(writes[0].body.fields.error.stringValue, 'IDENTITY_CONFLICT:DIRECTION');
    assert.equal(writes[0].body.fields.action.stringValue, 'error');
    console.log('HTTP identity guard: conflict logged; zero transaction writes or duplicate exclusions.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    google.auth.GoogleAuth = originalAuth;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
