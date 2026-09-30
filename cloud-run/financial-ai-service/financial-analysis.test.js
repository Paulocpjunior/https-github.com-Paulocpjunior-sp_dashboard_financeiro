import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTransactions, businessDate, financialDate, renderFinancialAnswer } from '../../shared/financialAnalysis.mjs';
import { getOriginalAmount, getPaidAmount } from '../../shared/transactionAmounts.mjs';

const today = '2026-09-30';
const row = (changes = {}) => ({ id: 't1', movement: 'Entrada', type: 'Contas a receber', client: 'Cliente sintético', status: 'Pendente', dueDate: today, totalCobranca: 100, valueReceived: 0, valuePaid: 0, ...changes });
test('paid aliases and Wix invoices use the same canonical amount rules as the Dashboard', () => {
  const rows = ['Pago', 'Paga', 'Recebido', 'Quitado', 'Liquidado', 'Sim', 'OK'].map((status, i) => row({ id: String(i), status, valueReceived: 100, paymentDate: today }));
  rows.push(row({ id: 'wix-inv-4', source: 'wix', movement: 'Saída', status: 'Paga', valorOriginal: '1.234,56', totalCobranca: 0, valuePaid: 1234.56, paymentDate: today }));
  const result = analyzeTransactions(rows, { today });
  assert.equal(result.totals.receivedCents, 193456);
  assert.equal(result.totals.paidCents, 0);
  assert.equal(result.totals.outstandingReceiptsCents, 0);
  assert.equal(result.forecast.expectedReceiptsCents, 0);
  assert.equal(getOriginalAmount(rows.at(-1)), 1234.56);
  assert.equal(getPaidAmount(rows.at(-1)), 1234.56);
});
test('forecast includes more than fifty records, thirty exact days and no paid or excluded titles', () => {
  const rows = Array.from({ length: 80 }, (_, i) => row({ id: String(i), totalCobranca: 0.1 }));
  rows.push(row({ dueDate: '2026-10-29', totalCobranca: 0.2 }), row({ dueDate: '2026-10-30', totalCobranca: 300 }), row({ dueDate: '2026-09-29', totalCobranca: 400 }), row({ status: 'Recebido', totalCobranca: 500 }), row({ isExcluded: true, totalCobranca: 600 }), row({ movement: 'Saída', type: 'Contas a pagar', totalCobranca: 0, valuePaid: 3 }));
  const result = analyzeTransactions(rows, { today });
  assert.equal(result.forecast.days.length, 30);
  assert.equal(result.forecast.end, '2026-10-29');
  assert.equal(result.forecast.expectedReceiptsCents, 820);
  assert.equal(result.forecast.expectedPaymentsCents, 300);
  assert.equal(result.forecast.variationCents, 520);
  assert.equal(result.totals.overdueReceiptsCents, 40000);
  assert.equal(result.forecast.openingBalance, null);
  assert.equal(result.excludedCount, 1);
  assert.match(renderFinancialAnswer(result, 'forecast'), /não representa saldo bancário/);
});
test('invalid dates and missing amounts are visible rather than silently becoming a complete forecast', () => {
  const result = analyzeTransactions([row({ dueDate: '2026-02-30' }), row({ dueDate: '' }), row({ dueDate: '01/10/2026', totalCobranca: 20 }), row({ totalCobranca: undefined })], { today, scope: 'selection' });
  assert.equal(result.issues.invalidDueDate, 2);
  assert.equal(result.issues.missingAmount, 1);
  assert.equal(result.forecast.expectedReceiptsCents, 2000);
  assert.match(renderFinancialAnswer(result), /seleção dos filtros atuais/);
  assert.match(renderFinancialAnswer(result), /sem vencimento válido/);
  assert.match(renderFinancialAnswer(result), /ausência de valor não comprova valor zero/);
});
test('reference date follows São Paulo at midnight boundaries regardless of worker timezone', () => {
  assert.equal(businessDate(new Date('2026-10-01T01:30:00Z')), '2026-09-30');
  assert.equal(businessDate(new Date('2026-10-01T04:30:00Z')), '2026-10-01');
  assert.equal(financialDate('31/09/2026'), null);
  assert.throws(() => analyzeTransactions([], { today: '2026-02-30' }));
});
test('client ranking discloses its limit but totals include the entire selection', () => {
  const result = analyzeTransactions(Array.from({ length: 12 }, (_, i) => row({ client: `Cliente ${i}`, totalCobranca: 10 })), { today });
  assert.equal(result.totals.outstandingReceiptsCents, 12000);
  assert.equal(result.debtorCount, 12);
  assert.equal(result.topDebtors.length, 10);
  assert.match(renderFinancialAnswer(result), /mostrando 10 de 12/);
});
