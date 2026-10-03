const assert = require('node:assert/strict');
const { google } = require('googleapis');
const originalAuth = google.auth.GoogleAuth;
const originalFetch = globalThis.fetch;
const calls = [];
let queryRows = [];
const previousProject = process.env.GCP_PROJECT_ID;
process.env.GCP_PROJECT_ID = 'demo-identity-guard';
const fields = values => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { stringValue: v }]));
google.auth.GoogleAuth = class { async getClient() { return { getAccessToken: async () => ({ token: 'synthetic-test-token' }) }; } };
globalThis.fetch = async (url, options) => {
  const target = new URL(url);
  assert.equal(target.hostname, 'firestore.googleapis.com');
  calls.push({ url: target.href, method: options.method, body: JSON.parse(options.body) });
  assert.ok(target.pathname.startsWith('/v1/projects/demo-identity-guard/'));
  if (target.pathname.endsWith(':runQuery')) return { ok: true, json: async () => queryRows };
  assert.ok(target.pathname.includes('/jotformEvents/'), 'No financial writes, cleanup or new document may follow a conflict');
  return { ok: true };
};

(async () => {
  const { app } = require('./index');
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const scenarios = [
      { name: 'Wix receipt versus payable', values: { type: 'Recebimento Wix / Cartao' }, reason: 'DIRECTION' },
      { name: 'expense versus receivable', receber: true, values: { movement: 'Saída' }, reason: 'DIRECTION' },
      { name: 'different submissionId', values: { submissionId: 'other' }, reason: 'SUBMISSION' },
      { name: 'different submissionID alias', values: { submissionID: 'other' }, reason: 'SUBMISSION' },
      { name: 'different unique identity', values: { identificacaoUnica: 'TEST-OTHER' }, reason: 'UNIQUE_IDENTITY' },
      { name: 'combined conflicts', values: { movement: 'Entrada', submissionId: 'other', identificacaoUnica: 'TEST-OTHER' }, reason: 'DIRECTION,SUBMISSION,UNIQUE_IDENTITY' },
    ];
    // Repeat each request and reverse query order: neither retries nor canonical
    // selection may turn a conflict into an update or duplicate exclusion.
    for (const scenario of scenarios) {
      for (const conflictFirst of [false, true]) {
        for (let retry = 0; retry < 2; retry++) {
          calls.length = 0;
          const safe = { document: { name: 'projects/demo-identity-guard/databases/(default)/documents/transactions/safe', fields: fields({ movement: scenario.receber ? 'Entrada' : 'Saída', submissionId: 'test-conflict' }) } };
          const conflict = { document: { name: 'projects/demo-identity-guard/databases/(default)/documents/transactions/conflict', fields: fields(scenario.values) } };
          queryRows = conflictFirst ? [conflict, safe] : [safe, conflict];
          const response = await originalFetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionID: 'test-conflict', rawRequest: JSON.stringify({ q4_tipoDe: scenario.receber ? 'Entrada de Caixa / Contas a Receber' : 'Saída de Caixa / Contas a Pagar', q284_identificacaoUnica: 'TEST-001', q291_docpago: 'NÃO', q44_movimentacao44: 'Synthetic expense', q56_valorRefvalor56: 'R$ 100,00' }) }) });
          const expectedError = `IDENTITY_CONFLICT:${scenario.reason}`;
          assert.equal(response.status, 500, scenario.name);
          assert.equal((await response.json()).error, expectedError, scenario.name);
          const writes = calls.filter(call => !call.url.endsWith(':runQuery'));
          assert.equal(writes.length, 1, scenario.name);
          assert.equal(writes[0].method, 'PATCH');
          assert.ok(writes[0].url.includes('/jotformEvents/'));
          assert.equal(writes[0].body.fields.error.stringValue, expectedError);
          assert.equal(writes[0].body.fields.action.stringValue, 'error');
          assert.equal(writes[0].body.fields.submissionId.stringValue, 'test-conflict');
          assert.equal(writes[0].body.fields.form.stringValue, scenario.receber ? 'contas_receber' : 'contas_pagar');
        }
      }
    }
    console.log('HTTP identity guard: 24 synthetic requests; conflicts logged; zero transaction writes or duplicate exclusions.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    google.auth.GoogleAuth = originalAuth;
    if (previousProject === undefined) delete process.env.GCP_PROJECT_ID;
    else process.env.GCP_PROJECT_ID = previousProject;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
