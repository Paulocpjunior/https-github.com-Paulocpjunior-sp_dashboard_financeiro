import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' });
try {
  const { accumulateBalances, balancesInReais } = await server.ssrLoadModule('/utils/accumulatedBalances.ts');
  const { readAccumulatedBalances } = await server.ssrLoadModule('/services/accumulatedBalancesReader.ts');
  const transaction = (id, changes = {}) => ({ id, date: '2026-09-10', movement: 'Entrada', status: 'Pendente', valorOriginal: 500, ...changes });
  const cents = { totalPaid: 0, totalReceived: 0, balance: 0 };
  for (const record of [transaction('older'), transaction('payable', { date: '2025-12-10', movement: 'Saída', valuePaid: 300 }), transaction('settled', { date: '2026-08-10', status: 'Recebido', valueReceived: 200 }), transaction('removed', { isExcluded: true, valorOriginal: 99999 })]) accumulateBalances(cents, record);
  assert.deepEqual(balancesInReais(cents), { totalPaid: 300, totalReceived: 500, balance: 200 }, 'histórico pago e pendências anteriores permanecem mesmo com outubro vazio');
  const wix = { totalPaid: 0, totalReceived: 0, balance: 0 };
  accumulateBalances(wix, transaction('wix-inv-1', { movement: 'Saída', valorOriginal: 123.45, status: 'S', source: 'wix' }));
  assert.deepEqual(balancesInReais(wix), { totalPaid: 0, totalReceived: 0, balance: 123.45 });
  const projectId = 'synthetic-project';
  const prefix = `projects/${projectId}/databases/(default)/documents/transactions/`;
  const readTime = '2026-10-01T10:00:00.000000Z';
  const field = value => typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'number' ? { doubleValue: value } : { stringValue: value };
  const row = (index, data = {}) => ({ readTime, document: { name: prefix + String(index).padStart(6, '0'), fields: Object.fromEntries(Object.entries(transaction('record', { valorOriginal: 1, ...data })).map(([key, value]) => [key, field(value)])) } });
  const pages = [Array.from({ length: 1000 }, (_, i) => row(i, { isExcluded: i === 0 })), [row(1000, { status: 'Pago', valueReceived: 2 })]];
  const requests = [];
  const fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => pages.shift() };
  };
  const result = await readAccumulatedBalances({ projectId, token: 'synthetic-token', fetcher, checkSession: () => {} });
  assert.equal(result.documentCount, 1001);
  assert.deepEqual(result.kpi, { totalPaid: 0, totalReceived: 999, balance: 2 });
  assert.equal(requests[0].structuredQuery.where, undefined, 'consulta global não recebe filtro do mês');
  assert.equal(requests[1].readTime, readTime, 'todas as páginas precisam da mesma versão');
  assert.deepEqual(requests[1].structuredQuery.startAt, { values: [{ referenceValue: prefix + '000999' }], before: false });
  let calls = 0;
  await assert.rejects(() => readAccumulatedBalances({ projectId, token: 'synthetic-token', checkSession: () => {}, fetcher: async () => ++calls === 1 ? { ok: true, json: async () => Array.from({ length: 1000 }, (_, i) => row(i)) } : { ok: false, status: 403 } }), /sem permissão/, 'falha na última página não libera saldo parcial');
  await assert.rejects(() => readAccumulatedBalances({ projectId, token: 'synthetic-token', checkSession: () => {}, fetcher: async () => ({ ok: true, json: async () => [] }) }), /incompleta/, 'resposta ausente não representa saldo zero');
  await assert.rejects(() => readAccumulatedBalances({ projectId, token: 'synthetic-token', checkSession: () => { throw new Error('Sessão mudou'); } }), /Sessão mudou/);
  const empty = await readAccumulatedBalances({ projectId, token: 'synthetic-token', checkSession: () => {}, fetcher: async () => ({ ok: true, json: async () => [{ readTime }] }) });
  assert.deepEqual(empty.kpi, { totalPaid: 0, totalReceived: 0, balance: 0 }, 'zero só pode ser concluído após leitura completa válida');
  console.log('OK: acumulados preservam meses anteriores, ignoram exclusões e exigem histórico completo, mesma versão e sessão válida.');
} finally { await server.close(); }
