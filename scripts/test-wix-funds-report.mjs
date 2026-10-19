import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
  logLevel: 'error',
});

const HEADER = '﻿"paymentDate","transactionCreationDate","payableType","amount","wixFee","netAmount","payableStatus","installmentNumber","payableId","anticipationFee","daysAnticipated","transactionId","externalTransactionId","customerName","externalOrderId"';
const line = (paymentDate, created, type, amount, fee, net, status, installment, tx, order) =>
  `"${paymentDate} 06:00","${created} 20:00","${type}","${amount}","${fee}","${net}","${status}",${installment},"p-${tx}-${installment}","0,00",,"${tx}","${tx}","Cliente, Teste","${order}"`;

const csv = [
  HEADER,
  // Pedido A parcelado em 3: uma parcela liberada e duas a receber.
  line('05/11/26', '05/10/26', 'Crédito', '1.666,39', '61,73', '1.604,66', 'Pago', 1, 'tx-a', 'order-a'),
  line('07/12/26', '05/10/26', 'Crédito', '1.666,43', '61,77', '1.604,66', 'Aguardando pagamento', 2, 'tx-a', 'order-a'),
  line('05/01/27', '05/10/26', 'Crédito', '1.666,43', '61,77', '1.604,66', 'Aguardando pagamento', 3, 'tx-a', 'order-a'),
  // Pedido B à vista, já liberado.
  line('13/10/26', '08/10/26', 'Crédito', '237,00', '2,99', '234,01', 'Pago', '', 'tx-b', 'order-b'),
  // Fatura sem pedido da loja e um chargeback no período.
  line('15/10/26', '15/10/26', 'Crédito', '339,00', '3,22', '335,78', 'Pago', '', 'tx-c', ''),
  line('20/10/26', '01/09/26', 'Chargeback', '-733,33', '-27,24', '-706,09', 'Pago', 3, 'tx-d', ''),
].join('\r\n');

const row = (id, extra = {}) => ({
  id, number: id.slice(-1), createdDate: '2026-10-05T12:00:00Z', purchasedDate: null, status: 'APPROVED', paymentStatus: 'PAID',
  buyer: 'Cliente', email: null, items: [], totalCents: 10000, paidCents: 10000, refundedCents: 0, feeCents: null, netCents: null,
  situation: 'pago', availableOn: null, payoutId: null, payoutDate: null, inFinance: false, ...extra,
});

try {
  const { applyWixFunds, brDateToIso, brMoneyToCents, parseWixFundsCsv } = await server.ssrLoadModule('/services/wixFundsReport.ts');

  assert.equal(brMoneyToCents('1.666,43'), 166643);
  assert.equal(brMoneyToCents('-27,24'), -2724);
  assert.equal(brDateToIso('05/01/27 06:00'), '2027-01-05');
  assert.throws(() => parseWixFundsCsv('"data","valor"\n"1","2"'), /Relatório de pagamentos/);

  const payables = parseWixFundsCsv(csv);
  assert.equal(payables.length, 6);
  assert.equal(payables[0].orderId, 'order-a');
  assert.equal(payables[0].status, 'liberado');
  assert.equal(payables[1].status, 'aguardando');
  assert.equal(payables[3].installment, null);
  assert.equal(payables[4].orderId, null, 'fatura sem pedido da loja');

  const report = {
    configured: true, paymentsEnabled: false, period: { start: '2026-10-01', end: '2026-10-31' },
    rows: [
      row('order-a'), row('order-b'), row('order-x'),
      row('order-y', { situation: 'aguardando_cliente', paidCents: 0 }),
      row('order-z', { situation: 'cancelado' }),
    ],
    totals: { orders: 4, canceled: 1, soldCents: 40000, paidByCustomersCents: 30000, awaitingCustomersCents: 10000, feesCents: null, withdrawnCents: null, pendingReleaseCents: null, availableCents: null, outsideWixPaymentsCents: null, otherRecordsNetCents: null, payoutsSentCents: null, payoutsFailed: 0, notInFinance: 3 },
  };
  const { report: merged, summary } = applyWixFunds(report, payables, 'funds.csv');
  const by = Object.fromEntries(merged.rows.map(item => [item.id, item]));

  assert.equal(by['order-a'].situation, 'em_liberacao');
  assert.equal(by['order-a'].availableOn, '2026-12-07', 'próxima parcela a liberar');
  assert.equal(by['order-a'].releasedCents, 160466);
  assert.equal(by['order-a'].pendingCents, 320932);
  assert.equal(by['order-a'].feeCents, 18527);
  assert.equal(by['order-a'].installments, 3);
  assert.equal(by['order-b'].situation, 'liberado');
  assert.equal(by['order-b'].payoutDate, '2026-10-13');
  assert.equal(by['order-x'].situation, 'fora_wix_payments', 'pedido pago sem parcela na Wix');
  assert.equal(by['order-y'].situation, 'aguardando_cliente');
  assert.equal(by['order-z'].situation, 'cancelado');

  assert.equal(summary.matchedOrders, 2);
  assert.equal(summary.releasedCents, 160466 + 23401);
  assert.equal(summary.pendingCents, 320932);
  assert.equal(summary.releasedInPeriodCents, 23401 + 33578 - 70609, 'liberações de outubro, inclusive fatura e chargeback');
  assert.equal(summary.pendingAllCents, 320932);
  assert.deepEqual(summary.nextRelease, { date: '2026-12-07', cents: 160466 });
  assert.equal(summary.noOrderInPeriodCents, 33578);
  assert.equal(summary.reversalsInPeriodCents, -70609);
  assert.equal(summary.fileStart, '2026-09-01');
  assert.equal(summary.coversPeriod, true);
  assert.equal(merged.totals.withdrawnCents, 183867);
  assert.equal(merged.totals.outsideWixPaymentsCents, 10000);
  assert.equal(merged.totals.soldCents, 40000, 'vendas não mudam com a importação');
  assert.equal(report.rows[0].situation, 'pago', 'relatório original não é alterado');

  // Arquivo exportado antes de uma venda do período: a venda fica para conferir e o aviso aparece.
  const later = applyWixFunds({ ...report, rows: [row('order-b'), row('order-new', { createdDate: '2026-10-20T15:00:00Z' })] }, payables.filter(item => item.transactionId !== 'tx-c'), 'antigo.csv');
  assert.equal(later.report.rows[1].situation, 'conferir');
  assert.equal(later.summary.coversPeriod, false);

  // Status desconhecido da Wix não vira "liberado".
  const odd = parseWixFundsCsv(csv.replace('"Pago",,"p-tx-b', '"Em análise",,"p-tx-b'));
  assert.equal(odd[3].status, 'outro');
  assert.equal(applyWixFunds(report, odd, 'f.csv').report.rows[1].situation, 'conferir');

  const { wixReportToCsv } = await server.ssrLoadModule('/services/wixTreasuryService.ts');
  const exported = wixReportToCsv(merged);
  assert.match(exported, /Já liberado;A liberar/);
  assert.match(exported, /Em liberação na Wix;2026-12-07/);

  const { buildWixReportPDF, wixReportPdfFileName } = await server.ssrLoadModule('/services/wixReportPdf.ts');
  // Junta o texto escrito no PDF (cabeçalho, resumo, tabela e rodapé) para conferir o conteúdo.
  const pdfText = (...args) => {
    const doc = buildWixReportPDF(...args);
    const written = [];
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      written.push(doc.internal.pages[page].join('\n'));
    }
    return { doc, text: written.join('\n').replace(/\\([()\\])/g, '$1') };
  };
  const user = { name: 'Paulo' };
  const { doc: pdf, text: printed } = pdfText({ ...merged, rows: [...merged.rows, row('order-evil', { number: '9', buyer: 'Cliente (teste)', items: ['A & B'] })] }, summary, user, new Date('2026-10-19T15:00:00Z'));
  assert.equal(pdf.internal.pageSize.getWidth() > pdf.internal.pageSize.getHeight(), true, 'A4 deitado como os relatórios do Financeiro');
  assert.match(printed, /Relat.rio de Vendas Wix/);
  assert.match(printed, /PER.ODO: 01\/10\/2026 a 31\/10\/2026/);
  assert.match(printed, /EMITIDO POR: PAULO/);
  assert.match(printed, /LIBERADO PELA WIX/);
  assert.match(printed, /Pr.xima em 07\/12\/2026/);
  assert.match(printed, /Pedidos da Loja Wix \(6\)/);
  assert.match(printed, /Cliente \(teste\)/);
  assert.match(printed, /P.gina 1 de 1/);
  assert.equal(wixReportPdfFileName(merged), 'Relatorio_Vendas_Wix_2026-10-01_a_2026-10-31.pdf');

  const salesOnly = pdfText({ ...report, rows: [], paymentsError: 'Wix fora do ar.' }, null, null).text;
  assert.match(salesOnly, /Nenhuma venda na loja Wix/);
  assert.match(salesOnly, /Wix fora do ar\./);
  assert.match(salesOnly, /EMITIDO POR: USU.RIO DO SISTEMA/);
  // Conta com accountId: saldo e resgates reais, sem parcelas previstas.
  const live = pdfText({
    ...report, paymentsEnabled: true, balance: { pendingCents: 12345, availableCents: 6789 },
    payouts: [{ id: 'p1', status: 'SENT' }, { id: 'p2', status: 'FAILED' }], otherRecords: [{ id: 'r1' }],
    totals: { ...report.totals, payoutsSentCents: 50000, payoutsFailed: 1, otherRecordsNetCents: -1000 },
  }, null, user).text;
  assert.doesNotMatch(live, /Mostrando s. as vendas/);
  assert.match(live, /RESGATADO/);
  assert.match(live, /Dispon.vel para resgate hoje/);
  assert.match(live, /1 movimento\(s\) sem pedido/);
  assert.match(live, /Resgates enviados: R\$.500,00 \(1\), 1 com falha/, 'conta só os enviados e mantém o aviso de falha');

  console.log('Relatório de pagamentos da Wix: confronto validado.');
} finally {
  await server.close();
}
