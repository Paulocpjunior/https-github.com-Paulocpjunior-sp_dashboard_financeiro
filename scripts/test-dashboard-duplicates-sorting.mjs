import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
});

const transaction = (id, overrides = {}) => ({
  id,
  date: '2026-08-01',
  dueDate: '2026-08-01',
  paymentDate: '',
  bankAccount: '',
  type: 'Entrada de Caixa / Contas a Receber',
  description: 'Cliente teste',
  status: 'Pendente',
  client: 'Cliente teste',
  paidBy: '',
  movement: 'Entrada',
  valuePaid: 0,
  valueReceived: 0,
  valorOriginal: 100,
  ...overrides,
});

try {
  const { buildDuplicateScanFilters, findPossibleDuplicateTransactions, sortTransactions } = await server.ssrLoadModule('/utils/transactionTable.ts');

  const duplicateFilters = buildDuplicateScanFilters({
    movement: 'Saída',
    status: 'Pendente',
    dueDateStart: '2026-08-01',
    dueDateEnd: '2026-08-31',
    client: 'Doméstica',
  });
  assert.equal(duplicateFilters.status, '', 'status must not hide the other half of a paid/open duplicate');
  assert.equal(duplicateFilters.movement, 'Saída', 'payables and receivables must remain separated');
  assert.equal(duplicateFilters.dueDateStart, '2026-08-01');
  assert.equal(duplicateFilters.dueDateEnd, '2026-08-31');
  assert.equal(duplicateFilters.client, 'Doméstica');

  const manyPages = Array.from({ length: 45 }, (_, index) => transaction(`row-${index}`, {
    dueDate: `2026-09-${String(45 - index).padStart(2, '0')}`,
    client: `Cliente ${index}`,
    valorOriginal: index + 1,
  }));
  const globallySorted = sortTransactions(manyPages, 'dueDate', 'asc');
  assert.equal(globallySorted[0].dueDate, '2026-09-01');
  assert.equal(globallySorted[19].dueDate, '2026-09-20');
  assert.equal(globallySorted.slice(20, 40)[0].dueDate, '2026-09-21', 'page 2 must continue the global order');
  assert.equal(sortTransactions(manyPages, 'dueDate', 'desc')[0].dueDate, '2026-09-45');
  assert.equal(sortTransactions([...manyPages, transaction('without-date', { dueDate: '' })], 'dueDate', 'desc').at(-1).id, 'without-date');

  const exactReceivables = [
    transaction('receive-a', { cpfCnpj: '12.345.678/0001-90', dueDate: '2026-08-10', valorOriginal: 500 }),
    transaction('receive-b', { cpfCnpj: '12.345.678/0001-90', dueDate: '2026-08-10', valorOriginal: 500 }),
  ];
  const differentPayableDetails = [
    transaction('pay-a', { movement: 'Saída', type: 'Saída de Caixa / Contas a Pagar', client: 'Vale Transporte', valuePaid: 80, valorOriginal: 80, observacaoAPagar: 'Maria' }),
    transaction('pay-b', { movement: 'Saída', type: 'Saída de Caixa / Contas a Pagar', client: 'Vale Transporte', valuePaid: 80, valorOriginal: 80, observacaoAPagar: 'Maria' }),
  ];
  const paidOpen = [
    transaction('shadow-open', { client: 'Cliente sombra', dueDate: '2026-08-15', valorOriginal: 700 }),
    transaction('shadow-paid', { client: 'Cliente sombra', dueDate: '2026-08-15', valorOriginal: 700, status: 'Pago', valueReceived: 700, observacao: 'Competência 08/2026' }),
  ];
  const sameSubmission = [
    transaction('submission-a', { client: 'A', dueDate: '2026-08-20', valorOriginal: 100, submissionId: '123' }),
    transaction('submission-b', { client: 'B', dueDate: '2026-08-21', valorOriginal: 200, submissionId: '123' }),
  ];

  const scan = findPossibleDuplicateTransactions([...exactReceivables, ...differentPayableDetails, ...paidOpen, ...sameSubmission]);
  assert.equal(scan.transactionCount, 6);
  assert.equal(scan.groupCount, 3);
  assert.ok(scan.byTransactionId.has('receive-a'));
  assert.ok(!scan.byTransactionId.has('pay-a'), 'employee VR/VT benefit lines must not be flagged');
  assert.ok(scan.byTransactionId.get('shadow-open').reasons.includes('paid-open'));
  assert.ok(scan.byTransactionId.get('submission-a').reasons.includes('submission'));

  console.log('OK: ordenação global e sinalização conservadora de duplicidades validadas.');
} finally {
  await server.close();
}
