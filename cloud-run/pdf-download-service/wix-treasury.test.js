const test = require('node:test');
const assert = require('node:assert/strict');
const { brCents, brDate, buildReport, cents, config, createWixTreasuryHandler, normalizeOrder, normalizeRecord, parseFundsReport, period, reconcile } = require('./wix-treasury');

const money = value => ({ amount: value, formattedAmount: `R$ ${value}` });
const order = (id, extra = {}) => ({
  id, number: id.slice(-4), createdDate: '2026-10-05T12:00:00Z', status: 'APPROVED', paymentStatus: 'PAID',
  buyerInfo: { email: `${id}@exemplo.test` }, billingInfo: { contactDetails: { firstName: 'Cliente', lastName: id } },
  priceSummary: { total: money('100.00') }, balanceSummary: { paid: money('100.00'), refunded: money('0') }, currency: 'BRL', ...extra,
});
const record = (orderId, status, extra = {}) => ({
  id: `r-${orderId}-${status}`, recordType: 'CREDIT', recordStatus: status,
  amount: { value: '100.00' }, fee: { value: '4.00' }, net: { value: '96.00' },
  paymentInfo: { externalOrderId: orderId }, ...extra,
});

test('cents keeps absent values as null and converts Wix money', () => {
  assert.equal(cents({ value: '12.34' }), 1234);
  assert.equal(cents({ amount: '-5.5' }), -550);
  assert.equal(cents(undefined), null);
  assert.equal(cents({ value: '' }), null);
});

test('config never invents the API key and reports what is missing', () => {
  assert.deepEqual(config({}).missing, ['WIX_API_KEY']);
  assert.deepEqual(config({ WIX_API_KEY: 'k' }).paymentsMissing, ['WIX_PAYMENTS_ACCOUNT_ID']);
  assert.equal(config({ WIX_API_KEY: 'k' }).siteId, '1e7a5d33-26d6-4f39-8f4c-be9452b1eb10');
});

test('period uses Brasilia days and refuses invalid or too long ranges', () => {
  assert.deepEqual(period('2026-10-01', '2026-10-31'), {
    start: '2026-10-01', end: '2026-10-31', startIso: '2026-10-01T03:00:00.000Z', endIso: '2026-11-01T03:00:00.000Z',
  });
  assert.throws(() => period('2026-10-31', '2026-10-01'));
  assert.throws(() => period('2026-02-30', '2026-03-01'));
  assert.throws(() => period('2025-01-01', '2026-10-01'));
});

test('each sale is classified as withdrawn, pending, available, unpaid, canceled or outside Wix Payments', () => {
  const orders = [
    order('a-resgatado'), order('b-liberacao'), order('c-disponivel'), order('d-offline'),
    order('e-aberto', { paymentStatus: 'NOT_PAID', balanceSummary: { paid: money('0') } }),
    order('f-cancelado', { status: 'CANCELED' }),
  ].map(normalizeOrder);
  const records = [
    record('a-resgatado', 'PAID_OUT', { payoutInfo: { payoutId: 'p1', createdDate: '2026-10-09T10:00:00Z' } }),
    record('b-liberacao', 'PENDING_CREDIT', { payoutAvailabilityDate: '2026-10-20' }),
    record('c-disponivel', 'CREDITED'),
    record('fatura-sem-pedido', 'CREDITED', { amount: { value: '50' }, fee: { value: '2' }, net: { value: '48' } }),
  ].map(normalizeRecord);
  const payouts = [{ id: 'p1', status: 'SENT', amountCents: 9600 }, { id: 'p2', status: 'FAILED', amountCents: 100 }];
  const r = reconcile({ orders, records, payouts, inFinance: new Set(['wix-a-resgatado']), paymentsEnabled: true });
  const by = Object.fromEntries(r.rows.map(row => [row.id, row]));
  assert.equal(by['a-resgatado'].situation, 'resgatado');
  assert.equal(by['a-resgatado'].payoutId, 'p1');
  assert.equal(by['a-resgatado'].inFinance, true);
  assert.equal(by['b-liberacao'].situation, 'em_liberacao');
  assert.equal(by['b-liberacao'].availableOn, '2026-10-20');
  assert.equal(by['c-disponivel'].situation, 'disponivel');
  assert.equal(by['d-offline'].situation, 'fora_wix_payments');
  assert.equal(by['d-offline'].netCents, null);
  assert.equal(by['e-aberto'].situation, 'aguardando_cliente');
  assert.equal(by['f-cancelado'].situation, 'cancelado');
  assert.deepEqual(r.totals, {
    orders: 5, canceled: 1,
    soldCents: 50000, paidByCustomersCents: 40000, awaitingCustomersCents: 10000,
    feesCents: 1400, withdrawnCents: 9600, pendingReleaseCents: 9600, availableCents: 9600,
    outsideWixPaymentsCents: 10000, otherRecordsNetCents: 4800,
    payoutsSentCents: 9600, payoutsFailed: 1, notInFinance: 3,
  });
  assert.equal(r.otherRecords.length, 1);
});

test('without the Wix Payments account the report keeps the sales and leaves balances unknown', () => {
  const r = reconcile({ orders: [normalizeOrder(order('a'))], records: [], payouts: [], paymentsEnabled: false });
  assert.equal(r.rows[0].situation, 'pago');
  assert.equal(r.totals.withdrawnCents, null);
  assert.equal(r.totals.soldCents, 10000);
});

function fixture({ profile = { active: true, role: 'user' }, env = { WIX_API_KEY: 'synthetic-key', WIX_PAYMENTS_ACCOUNT_ID: 'acc' }, fetchImpl } = {}) {
  const calls = [];
  const db = {
    collection: name => ({ doc: id => ({ id, get: async () => ({ exists: name === 'users' && Boolean(profile), data: () => profile }) }) }),
    getAll: async (...refs) => refs.map(ref => ({ id: ref.id, exists: ref.id === 'wix-o1', data: () => ({}) })),
  };
  const wix = fetchImpl || (async (url, init) => {
    calls.push({ url, init });
    const body = url.includes('/ecom/v1/orders/search') ? { orders: [order('o1')], metadata: { hasNext: false } }
      : url.includes('/balance-records/query') ? (JSON.parse(init.body).includeSummary ? { records: [], summary: { totalNet: { value: '10.00' } } } : { records: [record('o1', 'PAID_OUT', { payoutInfo: { payoutId: 'p1' } })] })
        : { payouts: [{ id: 'p1', status: 'SENT', amount: { value: '96.00' } }] };
    return { ok: true, status: 200, json: async () => body };
  });
  const handler = createWixTreasuryHandler({
    getServices: () => ({ adminAuth: { verifyIdToken: async token => { if (token !== 'ok') throw new Error('bad'); return { uid: 'u' }; } }, adminDb: db }),
    sendJson: (_req, res, status, body) => Object.assign(res, { status, body }),
    readBody: async req => { if (req.tooLarge) throw new Error('request too large'); return Buffer.from(req.body || ''); },
    env, fetchImpl: wix, now: () => new Date('2026-10-19T12:00:00Z'),
  });
  return {
    calls,
    async call(url = '/api/wix-treasury/report?start=2026-10-01&end=2026-10-31', auth = 'Bearer ok', extra = {}) {
      const res = {};
      const handled = await handler({ url, method: 'GET', headers: { authorization: auth }, ...extra }, res);
      return { handled, ...res };
    },
  };
}

test('handler ignores other routes and requires an active signed-in user', async () => {
  assert.equal((await fixture().call('/api/itau/statements')).handled, false);
  assert.equal((await fixture().call(undefined, '')).status, 401);
  assert.equal((await fixture().call(undefined, 'Bearer expired')).status, 401);
  assert.equal((await fixture({ profile: { active: false } }).call()).status, 403);
  assert.equal((await fixture({ profile: { active: true, status: 'blocked' } }).call()).status, 403);
});

test('handler reports missing credentials without calling Wix', async () => {
  const f = fixture({ env: {}, fetchImpl: async () => { throw new Error('Unexpected Wix call'); } });
  const r = await f.call();
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.deepEqual(r.body.missing, ['WIX_API_KEY']);
});

test('handler builds the read-only report with key and site headers only', async () => {
  const f = fixture();
  const r = await f.call();
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.withdrawnCents, 9600);
  assert.equal(r.body.totals.payoutsSentCents, 9600);
  assert.equal(r.body.balance.availableCents, 1000);
  assert.equal(r.body.rows[0].inFinance, true);
  for (const call of f.calls) {
    assert.equal(call.init.headers.Authorization, 'synthetic-key');
    assert.equal(call.init.headers['wix-site-id'], '1e7a5d33-26d6-4f39-8f4c-be9452b1eb10');
    assert.ok(['GET', 'POST'].includes(call.init.method));
    assert.ok(/\/(ecom\/v1\/orders\/search|wixpay-balances\/v5\/balance-records\/query|wixpay-payouts\/v4\/payouts)/.test(call.url));
  }
  assert.ok(!JSON.stringify(r.body).includes('synthetic-key'));
});

test('handler turns Wix permission errors into a clear message', async () => {
  const f = fixture({ fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) }) });
  const r = await f.call();
  assert.equal(r.status, 502);
  assert.match(r.body.error, /permissões/);
});

// Relatório de pagamentos do Wix Pagamentos Brasil (CSV do painel). Dados sintéticos.
const FUNDS_HEADER = '﻿"paymentDate","transactionCreationDate","payableType","amount","wixFee","netAmount","payableStatus","installmentNumber","payableId","anticipationFee","daysAnticipated","transactionId","externalTransactionId","customerName","externalOrderId"';
const fundsLine = (paid, created, type, amount, fee, net, status, inst, id, orderId, customer = 'Cliente Teste') =>
  `"${paid}","${created}","${type}","${amount}","${fee}","${net}","${status}",${inst},"${id}","0,00",,"t-${id}","t-${id}","${customer}","${orderId}"`;
const FUNDS_CSV = [
  FUNDS_HEADER,
  // o1: venda à vista já paga pela Wix.
  fundsLine('09/10/26 06:00', '05/10/26 10:00', 'Crédito', '100,00', '4,00', '96,00', 'Pago', '', 'p-o1', 'o1'),
  // o2: parcelada em 2, uma paga e outra em liberação.
  fundsLine('06/10/26 06:00', '05/10/26 11:00', 'Crédito', '1.000,00', '37,00', '963,00', 'Pago', 1, 'p-o2-1', 'o2'),
  fundsLine('05/11/26 06:00', '05/10/26 11:00', 'Crédito', '1.000,00', '37,00', '963,00', 'Aguardando pagamento', 2, 'p-o2-2', 'o2'),
  // Venda sem pedido da loja (link de pagamento) e estorno antigo fora do período.
  fundsLine('20/10/26 06:00', '12/10/26 09:00', 'Crédito', '50,00', '2,00', '48,00', 'Pago', '', 'p-avulso', ''),
  fundsLine('10/07/25 06:00', '09/06/25 19:16', 'Reembolsar', '-364,00', '-13,77', '-350,23', 'Pago', '', 'p-reemb', 'antigo'),
  // Venda de setembro ainda em liberação: entra no saldo a liberar, não no período.
  fundsLine('20/11/26 06:00', '20/09/26 09:00', 'Crédito', '200,00', '8,00', '192,00', 'Aguardando pagamento', 3, 'p-set', 'set'),
].join('\r\n');

test('Brazilian money and dates from the Wix Pagamentos export', () => {
  assert.equal(brCents('1.666,43'), 166643);
  assert.equal(brCents('-364,00'), -36400);
  assert.equal(brCents(''), null);
  assert.deepEqual(brDate('05/01/27 06:00'), { day: '2027-01-05', iso: '2027-01-05T09:00:00.000Z' });
  assert.equal(brDate('31/02/26 06:00'), null);
});

test('funds report rows become balance records by installment', () => {
  const records = parseFundsReport(FUNDS_CSV);
  assert.equal(records.length, 6);
  const by = Object.fromEntries(records.map(r => [r.id, r]));
  assert.deepEqual({ type: by['p-o1'].type, status: by['p-o1'].status, net: by['p-o1'].netCents, order: by['p-o1'].orderId, payout: by['p-o1'].payoutId },
    { type: 'CREDIT', status: 'PAID_OUT', net: 9600, order: 'o1', payout: 'wix-br-2026-10-09' });
  assert.equal(by['p-o2-2'].status, 'PENDING_CREDIT');
  assert.equal(by['p-o2-2'].availableOn, '2026-11-05');
  assert.equal(by['p-o2-2'].payoutDate, null);
  assert.equal(by['p-reemb'].type, 'REFUND');
  assert.equal(by['p-avulso'].orderId, null);
  assert.throws(() => parseFundsReport('"data","valor"\n"01/10/26","1,00"'), /Relatório de pagamentos/);
});

test('report with the imported funds file classifies sales without the Wix Payments API', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ orders: [order('o1'), order('o2', { priceSummary: { total: money('2000.00') }, balanceSummary: { paid: money('2000.00') } }), order('o3')], metadata: { hasNext: false } }) };
  };
  const report = await buildReport({
    db: { getAll: async (...refs) => refs.map(ref => ({ id: ref.id, exists: false })), collection: () => ({ doc: id => ({ id }) }) },
    env: { WIX_API_KEY: 'k' }, fetchImpl, start: '2026-10-01', end: '2026-10-31', fundsCsv: FUNDS_CSV,
    now: () => new Date('2026-10-19T12:00:00Z'),
  });
  assert.deepEqual(calls.map(u => new URL(u).pathname), ['/ecom/v1/orders/search']);
  assert.equal(report.paymentsEnabled, true);
  assert.equal(report.paymentsSource, 'funds_report');
  const by = Object.fromEntries(report.rows.map(r => [r.id, r]));
  assert.equal(by.o1.situation, 'resgatado');
  assert.equal(by.o1.payoutDate, '2026-10-09T09:00:00.000Z');
  assert.equal(by.o2.situation, 'em_liberacao');
  assert.equal(by.o2.availableOn, '2026-11-05');
  assert.equal(by.o2.netCents, 192600);
  assert.equal(by.o3.situation, 'fora_wix_payments');
  // Parcela paga de o2 conta como paga; a outra como a liberar.
  assert.equal(report.totals.withdrawnCents, 9600 + 96300);
  assert.equal(report.totals.pendingReleaseCents, 96300);
  assert.equal(report.totals.availableCents, 0);
  assert.equal(report.totals.feesCents, 400 + 3700 + 3700 + 200);
  assert.equal(report.totals.otherRecordsNetCents, 4800);
  // Pagamentos da Wix no período, por dia; saldo a liberar hoje inclui a venda de setembro.
  assert.deepEqual(report.payouts.map(p => [p.arrival, p.amountCents]), [['2026-10-06', 96300], ['2026-10-09', 9600], ['2026-10-20', 4800]]);
  assert.equal(report.totals.payoutsSentCents, 96300 + 9600 + 4800);
  assert.deepEqual(report.balance, { pendingCents: 96300 + 19200, availableCents: null });
  assert.deepEqual(report.fundsReport, { payables: 6, latestPaymentDate: '2026-10-20T09:00:00.000Z' });
});

test('handler accepts the funds file by POST and rejects oversize or empty uploads', async () => {
  const f = fixture({ env: { WIX_API_KEY: 'synthetic-key' } });
  const post = body => ({ method: 'POST', body: JSON.stringify(body) });
  const ok = await f.call('/api/wix-treasury/report', 'Bearer ok', post({ start: '2026-10-01', end: '2026-10-31', fundsCsv: FUNDS_CSV }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.paymentsSource, 'funds_report');
  assert.equal(ok.body.rows[0].situation, 'resgatado');
  assert.ok(f.calls.every(c => !/wixpay/.test(c.url)));
  assert.equal((await f.call('/api/wix-treasury/report', 'Bearer ok', post({ start: '2026-10-01', end: '2026-10-31' }))).status, 400);
  assert.equal((await f.call('/api/wix-treasury/report', 'Bearer ok', { method: 'POST', tooLarge: true })).status, 413);
  assert.equal((await f.call('/api/wix-treasury/report', '', post({ fundsCsv: FUNDS_CSV }))).status, 401);
});
