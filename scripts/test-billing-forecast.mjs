import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const {
    addMonths,
    buildBillingForecastRows,
    dateForMonthDay,
    getBillingIdentityKey,
    sortBillingForecastRows,
  } = await server.ssrLoadModule('/utils/billingForecast.ts');

  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(dateForMonthDay('2027-02', 31), '2027-02-28');
  assert.equal(getBillingIdentityKey({ client: 'Empresa A', cpfCnpj: '11.111.111/0001-11' }), 'doc-11111111000111');

  const rows = buildBillingForecastRows([
    {
      id: 'jotform-1', date: '2026-08-20', dueDate: '2026-08-31', bankAccount: 'Itaú',
      type: 'Entrada de Caixa / Contas a Receber', description: 'Empresa A', status: 'Pendente',
      client: 'Empresa A', paidBy: '', movement: 'Entrada', valuePaid: 0, valueReceived: 0,
      cpfCnpj: '11.111.111/0001-11', honorarios: 1000, valorExtra: 100, totalCobranca: 1100,
      metodoPagamento: '11-Boleto ITAU',
    },
  ], [{
    id: 'doc-11111111000111', identityKey: 'doc-11111111000111', client: 'Empresa A',
    cpfCnpj: '11.111.111/0001-11', groupName: 'Grupo Alfa', billingMethod: 'Boleto Itaú',
    issueDay: 25, dueDay: 31, deliveryChannels: ['email', 'whatsapp'], billingEmail: 'financeiro@empresa.com',
    whatsapp: '11999999999', active: true,
  }], '2026-08', '2026-09');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].groupName, 'Grupo Alfa');
  assert.equal(rows[0].referenceAmount, 1100);
  assert.equal(rows[0].issueDate, '2026-09-25');
  assert.equal(rows[0].dueDate, '2026-09-30');
  assert.deepEqual(rows[0].missingFields, []);

  const missing = buildBillingForecastRows([], [{
    id: 'manual', identityKey: 'name-sem-canal', client: 'Sem Canal', deliveryChannels: [], active: true,
  }], '2026-08', '2026-09')[0];
  assert.equal(missing.hasReference, false);
  assert.ok(missing.missingFields.includes('meio de envio'));
  assert.ok(missing.missingFields.includes('método de cobrança'));

  const { BillingReportService, buildBillingForecastPDF, createBillingForecastPDFFile } = await server.ssrLoadModule('/services/billingReportService.ts');
  const pdf = buildBillingForecastPDF(rows, { id: '1', username: 'teste', name: 'Teste', role: 'admin', active: true });
  const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
  assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), '%PDF-', 'o arquivo gerado deve conter um PDF real');

  const pdfFile = createBillingForecastPDFFile(rows, { id: '1', username: 'teste', name: 'Teste', role: 'admin', active: true });
  assert.equal(pdfFile.name, 'base-faturamento-2026-09.pdf');
  assert.equal(pdfFile.type, 'application/pdf');
  const fileBytes = new Uint8Array(await pdfFile.arrayBuffer());
  assert.equal(new TextDecoder().decode(fileBytes.slice(0, 5)), '%PDF-');

  const secondRow = { ...rows[0], identityKey: 'doc-2', client: 'Empresa B', clientNumber: '2', referenceAmount: 900, dueDate: '2026-09-10', missingFields: ['e-mail'] };
  assert.deepEqual(sortBillingForecastRows([rows[0], secondRow], 'referenceAmount', 'asc').map(row => row.identityKey), ['doc-2', 'doc-11111111000111']);
  assert.deepEqual(sortBillingForecastRows([rows[0], secondRow], 'dueDate', 'desc').map(row => row.identityKey), ['doc-11111111000111', 'doc-2']);
  assert.deepEqual(sortBillingForecastRows([rows[0], secondRow], 'status', 'asc').map(row => row.identityKey), ['doc-11111111000111', 'doc-2']);

  let pageHideHandler;
  let clicked = 0;
  let revoked = 0;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  globalThis.window = { addEventListener: (_event, handler) => { pageHideHandler = handler; } };
  globalThis.document = {
    body: { appendChild: () => {} },
    createElement: () => ({ click: () => { clicked += 1; }, remove: () => {} }),
  };
  URL.createObjectURL = () => 'blob:pdf-test';
  URL.revokeObjectURL = () => { revoked += 1; };
  try {
    await BillingReportService.generatePDF(rows, null);
    assert.equal(clicked, 1, 'o fallback deve iniciar o download');
    assert.equal(revoked, 0, 'o Blob nao pode ser liberado enquanto o Safari ainda baixa o PDF');
    pageHideHandler();
    assert.equal(revoked, 1, 'o Blob deve ser liberado quando a pagina for encerrada');
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }

  console.log('OK: base de faturamento agrupa empresas, projeta datas e gera um PDF real.');
} finally {
  await server.close();
}
