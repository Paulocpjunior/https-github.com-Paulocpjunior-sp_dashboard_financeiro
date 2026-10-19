const test = require('node:test');
const assert = require('node:assert/strict');
const { cents, config, createWixTreasuryHandler, estimatePayables, normalizeOrder, normalizeRecord, period, reconcile } = require('./wix-treasury');

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
    env, fetchImpl: wix, now: () => new Date('2026-10-19T12:00:00Z'),
  });
  return {
    calls,
    async call(url = '/api/wix-treasury/report?start=2026-10-01&end=2026-10-31', auth = 'Bearer ok') {
      const res = {};
      const handled = await handler({ url, method: 'GET', headers: { authorization: auth } }, res);
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

const tx = (id, method, amount, createdAt, extra = {}) => ({
  transactionId: id, status: 'APPROVED', provider: 'com.wix.wixpay', paymentMethod: method, type: 'SALE',
  appId: '1380b703-ce81-ff05-f115-39571d94dfcd', createdAt, amount: { amount, currency: 'BRL' },
  order: { description: { wixAppOrderId: `order-${id}` } }, paymentMethodData: {}, refunds: [], ...extra,
});

test('Wix Pagamentos Brasil: parcelas previstas pelas regras conferidas no relatório da Wix', () => {
  const payables = estimatePayables([
    // Valores reais do relatório: cartão 3x de 4.999,25 → líquido 1.604,66 por parcela.
    tx('card', 'creditCard', 4999.25, '2026-10-05T19:39:50Z', { paymentMethodData: { installments: '3' } }),
    tx('pix', 'pix', 339, '2026-10-15T15:41:30Z', { appId: '13ee94c1-b635-8505-3391-97919052c16f' }),
    tx('boleto', 'boleto', 237, '2026-10-15T14:48:48Z', { refunds: [{ amount: { amount: 37 }, createdAt: '2026-10-18T12:00:00Z' }] }),
    tx('presencial', 'inPerson', 500, '2026-10-06T16:44:33Z', { provider: 'NA' }),
    tx('recusada', 'creditCard', 100, '2026-10-05T14:43:33Z', { status: 'DECLINED' }),
  ], '2026-10-19');
  const card = payables.filter(p => p.transactionId === 'card');
  assert.deepEqual(card.map(p => p.netCents), [160466, 160466, 160466]);
  assert.equal(card.reduce((t, p) => t + p.feeCents, 0), 18527);
  assert.deepEqual(card.map(p => p.paymentDate), ['2026-11-05', '2026-12-07', '2027-01-04']);
  assert.ok(card.every(p => p.status === 'aguardando' && p.orderId === 'order-card' && p.estimated));
  const pix = payables.find(p => p.transactionId === 'pix');
  assert.deepEqual([pix.feeCents, pix.netCents, pix.paymentDate, pix.status, pix.orderId], [322, 33578, '2026-10-15', 'liberado', null]);
  const boleto = payables.filter(p => p.transactionId === 'boleto');
  assert.deepEqual(boleto.map(p => [p.netCents, p.paymentDate, p.status]), [[23401, '2026-10-20', 'aguardando'], [-3700, '2026-10-18', 'liberado']]);
  assert.equal(payables.some(p => ['presencial', 'recusada'].includes(p.transactionId)), false);
});

test('sem conta Wix Payments, o relatório busca as transações e devolve as parcelas previstas', async () => {
  const urls = [];
  const f = fixture({
    env: { WIX_API_KEY: 'synthetic-key' },
    fetchImpl: async url => {
      urls.push(url);
      const body = url.includes('/orders/search') ? { orders: [order('o1')], metadata: { hasNext: false } }
        : { transactions: [tx('o1', 'pix', 100, '2026-10-05T12:00:00Z')] };
      return { ok: true, status: 200, json: async () => body };
    },
  });
  const r = await f.call();
  assert.equal(r.status, 200);
  assert.equal(r.body.paymentsEnabled, false);
  assert.equal(r.body.payables.length, 1);
  assert.equal(r.body.payables[0].netCents, 9905);
  const txUrl = new URL(urls.find(url => url.includes('/payments/v2/transactions')));
  assert.equal(txUrl.searchParams.get('from'), '2025-08-27T03:00:00.000Z', '400 dias antes do período');
  assert.equal(txUrl.searchParams.get('to'), '2026-11-01T03:00:00.000Z');
  assert.ok(!urls.some(url => url.includes('wixpay-balances') || url.includes('wixpay-payouts')));
});

test('se a Wix recusar as transações, as vendas continuam saindo com o motivo', async () => {
  const f = fixture({
    env: { WIX_API_KEY: 'synthetic-key' },
    fetchImpl: async url => (url.includes('/orders/search')
      ? { ok: true, status: 200, json: async () => ({ orders: [order('o1')], metadata: { hasNext: false } }) }
      : { ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) }),
  });
  const r = await f.call();
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.soldCents, 10000);
  assert.equal(r.body.payables, undefined);
  assert.match(r.body.paymentsError, /403/);
});
