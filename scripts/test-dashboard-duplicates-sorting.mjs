import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  const { filtersForDashboardView } = await server.ssrLoadModule('/utils/dashboardViewFilters.ts');
  const september = {
    startDate: '2026-09-01', endDate: '2026-09-30',
    dueDateStart: '', dueDateEnd: '', paymentDateStart: '', paymentDateEnd: '', receiptDateStart: '', receiptDateEnd: '',
    client: 'Cliente teste', bankAccount: 'Itaú', search: 'honorários', movement: '', type: '', status: '',
  };
  const payables = filtersForDashboardView(september, 'payables');
  const receivables = filtersForDashboardView(payables, 'receivables');
  const general = filtersForDashboardView(receivables, 'general');
  assert.equal(payables.dueDateStart, '2026-09-01');
  assert.equal(receivables.dueDateEnd, '2026-09-30');
  assert.equal(general.startDate, '2026-09-01', 'voltar à Visão Geral não pode trocar setembro pelo mês atual');
  assert.equal(general.endDate, '2026-09-30');
  assert.equal(general.dueDateStart, '');
  assert.equal(general.movement, '');
  assert.equal(general.status, '');
  assert.equal(general.client, september.client);
  assert.equal(general.bankAccount, september.bankAccount);
  assert.equal(general.search, september.search);
  const custom = filtersForDashboardView({ ...payables, dueDateStart: '', dueDateEnd: '2026-08-17' }, 'general');
  assert.equal(custom.startDate, '', 'intervalo sem início deve permanecer aberto');
  assert.equal(custom.endDate, '2026-08-17');
  assert.equal(payables.status, 'Pendente');
  assert.equal(receivables.movement, 'Entrada');
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

  const { default: DataTable } = await server.ssrLoadModule('/components/DataTable.tsx');
  const renderTable = (readOnly, selectedType) => renderToStaticMarkup(React.createElement(DataTable, {
    data: [transaction('visible', {client:'Conta de demonstração',description:'Conta de demonstração',source:'native-finance',movement:'Saída',type:'Saída de Caixa / Contas a Pagar'})],
    page:1,totalPages:2,onPageChange(){},sortField:'none',sortDirection:'asc',onSortChange(){},
    canDelete:true,canExportBoletoCloud:true,onDelete(){},onPayable(){},readOnly,selectedType,
  }));
  for (const type of ['', 'Saída de Caixa / Contas a Pagar', 'Entrada de Caixa / Contas a Receber']) {
    const html=renderTable(true,type);
    assert.ok(html.includes('Conta de demonstração'), 'consulta mantém as linhas em todas as visões');
    assert.ok(html.includes('Próxima página'), 'consulta mantém paginação');
    assert.ok(html.includes('Detalhes'), 'detalhes de leitura continuam disponíveis');
    assert.ok(!html.includes('Gerenciar conta') && !html.includes('title="Excluir"') && !html.includes('Emitir / consultar boletos'), 'consulta não oferece mutações mesmo com permissões administrativas');
  }
  const editable=renderTable(false,'Saída de Caixa / Contas a Pagar');
  assert.ok(editable.includes('Gerenciar conta') && editable.includes('title="Excluir"'), 'Lançamentos mantém gerenciamento e exclusão');

  console.log('OK: ordenação global e sinalização conservadora de duplicidades validadas.');
} finally {
  await server.close();
}
