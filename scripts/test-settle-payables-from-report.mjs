import assert from 'node:assert/strict';
import { buildPlan, settlementPatch } from './settle-payables-from-report.mjs';

const doc = (id, data, updateTime = '2026-10-01T00:00:00Z') => ({ id, updateTime, data: { movement: 'Saída', status: 'Pendente', ...data } });
const row = (line, extra) => ({ line, date: '2021-01-29', dueDate: '2021-01-29', amountCents: 75000, client: 'ESTACIONAMENTO', ...extra });

const docs = [
  doc('a', { date: '29/01/2021', dueDate: '2021-01-29', valuePaid: 750, client: 'ESTACIONAMENTO' }),
  doc('b', { date: '2021-01-29', dueDate: '2021-01-29', valuePaid: '104,40', client: 'TELEFONES' }),
  doc('c', { date: '2021-01-29', dueDate: '2021-01-29', valuePaid: '104,40', client: 'TELEFONES' }),
  doc('d', { date: '2021-02-01', dueDate: '2021-02-01', valuePaid: 500, client: 'X', status: 'Pago' }),
  doc('e', { date: '2021-02-02', dueDate: '2021-02-02', valueReceived: 300, valuePaid: 0, movement: 'Entrada', client: 'CLIENTE' }),
  doc('f', { date: '2021-02-03', dueDate: '2021-02-03', valuePaid: 200, client: 'PARCIAL', payableBalance: { version: 1 } }),
];
const plan = buildPlan([
  row(1),
  row(2, { amountCents: 10440, client: 'TELEFONES' }),
  row(3, { date: '2021-02-01', dueDate: '2021-02-01', amountCents: 50000, client: 'X' }),
  row(4, { date: '2021-02-02', dueDate: '2021-02-02', amountCents: 30000, client: 'CLIENTE' }),
  row(5, { date: '2021-02-03', dueDate: '2021-02-03', amountCents: 20000, client: 'PARCIAL' }),
], docs);
assert.deepEqual(plan.matched.map((m) => m.id), ['a']);
assert.equal(plan.ambiguous.length, 1);
assert.deepEqual(plan.ambiguous[0].candidates.map((c) => c.id), ['b', 'c']);
assert.equal(plan.missing.length, 3, 'pago, entrada e parcial não entram');
assert.match(plan.missing.find((m) => m.row.line === 5).reason, /não elegível/);
assert.equal(plan.totals.matchedCents, 75000);

const patch = settlementPatch(row(1), { at: 'now', batchId: 'b', actor: 'Paulo', account: 'x', source: 's' });
assert.equal(patch.status, 'Pago');
assert.equal(patch.paymentDate, '2021-01-29');
assert.equal(patch.dataPagamento, '29/01/2021');
assert.equal(patch.valorPago, '750.00');
console.log('settle-payables-from-report OK');
