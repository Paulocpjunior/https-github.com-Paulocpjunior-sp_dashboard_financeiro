import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinancialHandler } from './handler.js';

const transaction = { movement: 'Entrada', client: 'Empresa sintética', type: 'Serviços', bankAccount: 'Itau', status: 'Pendente', dueDate: '2026-09-30', totalCobranca: 100 };
function harness({ profile = { role: 'operacional', active: true }, enabled = true, provider } = {}) {
  const records = new Map([['users/u1', profile], ['transactions/t1', transaction]]);
  let reads = 0, profileReads = 0, onProfileRead = () => {}, tokenRevoked = false;
  const snapshot = path => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => records.get(path) });
  const db = {
    collection: name => ({
      doc: id => ({ path: `${name}/${id}`, get: async () => { if (name === 'users') { profileReads++; onProfileRead(profileReads); } return snapshot(`${name}/${id}`); } }),
      limit: limit => ({ get: async () => { reads++; const docs = [...records.keys()].filter(p => p.startsWith(`${name}/`)).slice(0, limit).map(snapshot); return { size: docs.length, docs }; } }),
    }),
    getAll: async (...refs) => { reads++; return refs.map(ref => snapshot(ref.path)); },
  };
  const handler = createFinancialHandler({ getServices: () => ({ db, auth: { verifyIdToken: async (token, revoked) => { assert.equal(revoked, true); if (token !== 'valid' || tokenRevoked) throw new Error('bad'); return { uid: 'u1' }; } } }), readBody: async request => Buffer.from(JSON.stringify(request.body)), sendJson: (res, status, body) => Object.assign(res, { status, body }), env: { FINANCIAL_AI_ENABLED: String(enabled) }, now: () => new Date('2026-09-30T15:00:00Z'), provider: provider || { configured: () => false } });
  const call = async (body = { mode: 'analysis', query: 'Resumo', scope: { kind: 'all' } }, token = 'valid', method = 'POST', path = 'query') => { const response = {}; await handler({ method, url: `/api/financial-ai/${path}`, headers: { authorization: token ? `Bearer ${token}` : '' }, body }, response); return response; };
  return { records, call, get reads() { return reads; }, revokeToken: () => { tokenRevoked = true; }, onProfileRead: fn => { onProfileRead = fn; } };
}
test('anonymous, revoked, inactive and blocked users cannot read transactions', async () => {
  const h = harness();
  assert.equal((await h.call(undefined, '')).status, 401);
  assert.equal((await h.call(undefined, 'revoked')).status, 401);
  assert.equal(h.reads, 0);
  for (const profile of [{ active: false, role: 'admin' }, { active: true, role: 'operacional', status: 'blocked' }, { active: true, role: 'unknown' }]) {
    const denied = harness({ profile });
    assert.equal((await denied.call()).status, 403);
    assert.equal(denied.reads, 0);
  }
});
test('kill switch disables consultations and status never exposes credentials', async () => {
  const h = harness({ enabled: false });
  assert.deepEqual((await h.call(null, 'valid', 'GET', 'status')).body, { available: false, languageModelAvailable: false, readOnly: true });
  assert.equal((await h.call()).status, 503);
  assert.equal(h.reads, 0);
});
test('values come from Firestore, explicit selections are complete and missing records are refused', async () => {
  const h = harness();
  const result = await h.call({ mode: 'analysis', query: 'Resumo', scope: { kind: 'selection', transactionIds: ['t1'] } });
  assert.equal(result.body.analysis.totals.outstandingReceiptsCents, 10000);
  assert.equal(result.body.analysis.scope, 'selection');
  assert.equal(result.body.interpretation, 'not_configured');
  assert.equal((await h.call({ mode: 'analysis', query: 'Resumo', transactions: [{ totalCobranca: 999 }], scope: { kind: 'all' } })).status, 400);
  assert.equal((await h.call({ mode: 'analysis', query: 'Resumo', scope: { kind: 'selection', transactionIds: ['missing'] } })).status, 409);
  assert.equal((await h.call({ mode: 'analysis', query: 'Resumo', scope: { kind: 'selection', transactionIds: ['users/admin'] } })).status, 400);
  assert.equal((await h.call({ mode: 'analysis', query: 'Resumo', scope: { kind: 'selection', transactionIds: ['t1', 't1'] } })).status, 400);
});
test('over-limit bases are refused instead of returning partial totals', async () => {
  const h = harness();
  for (let i = 0; i < 20001; i++) h.records.set(`transactions/large-${i}`, transaction);
  assert.equal((await h.call()).status, 413);
});
test('revocation after reading or during interpretation prevents releasing financial data', async () => {
  const h = harness();
  h.onProfileRead(n => { if (n === 2) h.records.set('users/u1', { active: false, role: 'operacional' }); });
  const result = await h.call();
  assert.equal(result.status, 403);
  assert.equal(result.body.analysis, undefined);
  const later = harness({ provider: { configured: () => true, explain: async () => { later.records.set('users/u1', { active: false, role: 'operacional' }); return { explanation: 'Conferir pendências.' }; } } });
  assert.equal((await later.call()).status, 403);
});
test('provider failures preserve calculated totals without pretending AI succeeded', async () => {
  const h = harness({ provider: { configured: () => true, explain: async (_query, context) => { assert.equal(JSON.stringify(context).includes('Empresa sintética'), false); throw new Error('sensitive upstream error'); } } });
  const result = await h.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.analysis.totals.outstandingReceiptsCents, 10000);
  assert.equal(result.body.interpretation, 'unavailable');
  assert.equal(result.body.answer.includes('sensitive upstream'), false);
  assert.match(result.body.answer, /Interpretação por IA indisponível/);
});
test('Firebase token revoked during interpretation blocks the response even with an active profile', async () => {
  const h = harness({ provider: { configured: () => true, explain: async () => { h.revokeToken(); return { explanation: 'Conferir pendências.' }; } } });
  const result = await h.call();
  assert.equal(result.status, 401);
  assert.equal(result.body.analysis, undefined);
});
test('invalid or unavailable AI filters do not become financial actions', async () => {
  const request = { mode: 'filter', query: 'Mostrar Itau', scope: { kind: 'all' } };
  assert.equal((await harness().call(request)).status, 503);
  const invalid = harness({ provider: { configured: () => true, interpret: async () => ({ explanation: 'Filtrado', filters: { status: 'Recebido' } }) } });
  assert.equal((await invalid.call(request)).status, 502);
  const foreign = harness({ provider: { configured: () => true, interpret: async () => ({ explanation: 'Filtrado', filters: { bankAccount: 'Banco não cadastrado' } }) } });
  assert.equal((await foreign.call(request)).status, 502);
  const valid = harness({ provider: { configured: () => true, interpret: async () => ({ explanation: 'Filtrar vencimentos', filters: { dueDateStart: '2026-09-01', dueDateEnd: '2026-09-30', movement: 'Entrada' } }) } });
  const result = await valid.call(request);
  assert.equal(result.status, 200);
  assert.equal(result.body.filters.dueDateStart, '2026-09-01');
  assert.equal(result.body.readOnly, true);
});
test('per-user rate limit caps repeated expensive consultations', async () => {
  const h = harness();
  for (let i = 0; i < 10; i++) assert.equal((await h.call()).status, 200);
  assert.equal((await h.call()).status, 429);
});
