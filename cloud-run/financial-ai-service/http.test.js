import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './index.js';

test('HTTP service exposes health, requires session and serves calculated data without mutations', async () => {
  const profile = { active: true, role: 'operacional' };
  const transaction = { movement: 'Entrada', status: 'Pendente', dueDate: '2026-09-30', totalCobranca: 250, client: 'Cliente fictício' };
  const db = { collection: name => ({ doc: () => ({ get: async () => ({ exists: true, data: () => profile }) }), limit: () => ({ get: async () => { assert.equal(name, 'transactions'); return { size: 1, docs: [{ id: 't1', data: () => transaction }] }; } }) }) };
  const server = createServer({ getServices: () => ({ db, auth: { verifyIdToken: async token => { if (token !== 'synthetic-token') throw new Error('invalid'); return { uid: 'test' }; } } }), provider: { configured: () => false }, env: { FINANCIAL_AI_ENABLED: 'true' }, now: () => new Date('2026-09-30T15:00:00Z') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/financial-ai/status`)).status, 401);
    const headers = { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' };
    const response = await fetch(`${base}/api/financial-ai/query`, { method: 'POST', headers, body: JSON.stringify({ query: 'Resumo', mode: 'analysis', scope: { kind: 'all' } }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.analysis.totals.outstandingReceiptsCents, 25000);
    assert.equal(body.readOnly, true);
    const malformed = await fetch(`${base}/api/financial-ai/query`, { method: 'POST', headers, body: '{' });
    assert.equal(malformed.status, 400);
    const action = await fetch(`${base}/api/financial-ai/query`, { method: 'POST', headers, body: JSON.stringify({ query: 'Pagar', mode: 'payment', scope: { kind: 'all' } }) });
    assert.equal(action.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
