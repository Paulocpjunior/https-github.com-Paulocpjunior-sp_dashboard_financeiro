const assert = require('node:assert/strict');
const {
  buildInvoiceTransaction,
  canonicalInvoiceStatus,
  parseTotal,
  resolveInvoiceAmount,
  resolveInvoiceDates,
} = require('./index');

assert.equal(parseTotal('R$ 1.450,00'), 1450);
assert.equal(parseTotal('$3,300.00'), 3300);
assert.equal(parseTotal({ amount: '7870.00', formattedAmount: 'R$ 7.870,00' }), 7870);
assert.equal(resolveInvoiceAmount({}, { totalAmount: { amount: '3300.00' } }), 3300);
assert.equal(resolveInvoiceAmount({ valorOriginal: 7870 }, { total: '' }), 7870);
assert.equal(canonicalInvoiceStatus('PAID'), 'Paga');
assert.equal(canonicalInvoiceStatus('OVERDUE'), 'Vencida');

const paidUpdate = resolveInvoiceDates(
  { date: '2026-07-23', dueDate: '2026-07-30', paymentDate: '' },
  { paymentDate: '2026-07-30' },
  'Paga',
  '2026-08-03'
);

assert.deepEqual(paidUpdate, {
  issueDate: '2026-07-23',
  dueDate: '2026-07-30',
  paymentDate: '2026-07-30',
});

const pendingUpdate = resolveInvoiceDates(
  { date: '2026-07-23', dueDate: '2026-07-30' },
  { paymentDate: '2026-08-15' },
  'Pendente',
  '2026-08-03'
);

assert.deepEqual(pendingUpdate, {
  issueDate: '2026-07-23',
  dueDate: '2026-08-15',
  paymentDate: '',
});

const explicitIssueDate = resolveInvoiceDates(
  {},
  { issueDate: '2026-07-23T10:00:00.000Z', dueDate: '2026-07-30' },
  'Pendente',
  '2026-08-03'
);

assert.equal(explicitIssueDate.issueDate, '2026-07-23');

const paidInvoice = buildInvoiceTransaction(
  { date: '2026-06-24', dueDate: '2026-07-05', status: 'Vencida', valorOriginal: 6600 },
  { total: '$3,300.00', paymentDate: '2026-07-05', client: 'KROYA' },
  'PAID',
  { docId: 'wix-inv-0004175', numStr: '0004175', entityId: 'entity-4175' },
  '2026-08-13'
);

assert.equal(paidInvoice.status, 'Paga');
assert.equal(paidInvoice.valorOriginal, 3300);
assert.equal(paidInvoice.valueReceived, 3300);
assert.equal(paidInvoice.valuePaid, 0);
assert.equal(paidInvoice.paymentDate, '2026-07-05');

const delayedOverdueEvent = buildInvoiceTransaction(
  paidInvoice,
  { total: 3300, dueDate: '2026-07-05' },
  'Vencida',
  { docId: 'wix-inv-0004175', numStr: '0004175', entityId: 'entity-4175' },
  '2026-08-13'
);

assert.equal(delayedOverdueEvent.status, 'Paga');
assert.equal(delayedOverdueEvent.valueReceived, 3300);
assert.equal(delayedOverdueEvent.valuePaid, 0);

console.log('wix-sync invoice regression tests: ok');
