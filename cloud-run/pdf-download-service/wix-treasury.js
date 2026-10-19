// ============================================================================
// Tesouraria Wix — relatório de vendas x resgates x a receber.
//
// Somente LEITURA. Mesmo padrão da integração da loja no app da Legalização:
// API key da conta Wix no header Authorization + `wix-site-id`. Nada é gravado
// na Wix nem nos lançamentos; o resgate continua sendo feito na página oficial
// de transferências da Wix.
//
// Fontes (REST Wix):
//   Vendas:      POST /ecom/v1/orders/search                      (Read Orders)
//   Saldo:       POST /wixpay-balances/v5/balance-records/query   (View settlement reports and payouts)
//   Resgates:    GET  /wixpay-payouts/v4/payouts                  (View settlement reports and payouts)
//
// Variáveis do Cloud Run (sem elas o relatório diz o que falta e não chama a Wix):
//   WIX_API_KEY               API key da conta Wix. Secret Manager, nunca no código.
//   WIX_SITE_ID               ID do site SPcontabil (padrão: o mesmo da página de transferências).
//   WIX_PAYMENTS_ACCOUNT_ID   ID da conta Wix Payments. Sem ele, saem só as vendas.
// ============================================================================

const API_BASE = 'https://www.wixapis.com';
const DEFAULT_SITE_ID = '1e7a5d33-26d6-4f39-8f4c-be9452b1eb10';
const TIMEOUT_MS = 20000;
const MAX_ORDERS = 5000;
const MAX_RECORDS = 10000;
const MAX_DAYS = 366;

class WixTreasuryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function config(env = process.env) {
  const apiKey = String(env.WIX_API_KEY || '').trim();
  const siteId = String(env.WIX_SITE_ID || DEFAULT_SITE_ID).trim();
  const paymentsAccountId = String(env.WIX_PAYMENTS_ACCOUNT_ID || '').trim();
  return {
    apiKey, siteId, paymentsAccountId,
    missing: [!apiKey && 'WIX_API_KEY', !siteId && 'WIX_SITE_ID'].filter(Boolean),
    paymentsMissing: [!paymentsAccountId && 'WIX_PAYMENTS_ACCOUNT_ID'].filter(Boolean),
  };
}

// Mesmo critério de canOpenWixTreasury no app: usuário ativo da equipe.
function permitted(profile) {
  return Boolean(profile) && profile.active !== false && profile.status !== 'deleted' && profile.status !== 'blocked';
}

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function period(start, end) {
  if (!isDate(start) || !isDate(end) || start > end) throw new WixTreasuryError('Selecione um período válido.');
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days > MAX_DAYS) throw new WixTreasuryError(`Selecione um período de até ${MAX_DAYS} dias.`);
  // Dias no horário de Brasília (UTC-3, sem horário de verão desde 2019).
  const startIso = new Date(Date.parse(`${start}T00:00:00-03:00`)).toISOString();
  const endIso = new Date(Date.parse(`${end}T00:00:00-03:00`) + 86400000).toISOString();
  return { start, end, startIso, endIso };
}

// Money da Wix ({ value | amount, currency }) → centavos. Ausente ≠ zero.
function cents(money) {
  const raw = money && typeof money === 'object' ? (money.value ?? money.amount) : money;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const text = value => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return text(value.translated ?? value.original ?? null);
  const s = String(value).trim();
  return s || null;
};

async function wixRequest(cfg, fetchImpl, path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: cfg.apiKey, 'wix-site-id': cfg.siteId, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new WixTreasuryError('A Wix não respondeu. Tente novamente em instantes.', 502);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.message || data?.details?.applicationError?.description || 'sem mensagem';
    const hint = response.status === 401 || response.status === 403
      ? ` Confira na Wix (API Keys) se a chave tem as permissões de ler pedidos e de ver pagamentos/resgates, e se o site …${cfg.siteId.slice(-6)} está liberado.`
      : '';
    throw new WixTreasuryError(`Wix HTTP ${response.status}: ${String(reason).slice(0, 200)}.${hint}`, 502);
  }
  return data;
}

async function searchOrders(cfg, fetchImpl, range) {
  const orders = [];
  let cursor = null;
  for (;;) {
    // Com cursor, a Wix exige só o cursor (filtro e ordem vão dentro dele).
    const search = cursor
      ? { cursorPaging: { limit: 100, cursor } }
      : {
        filter: { $and: [{ createdDate: { $gte: range.startIso } }, { createdDate: { $lt: range.endIso } }] },
        sort: [{ fieldName: 'createdDate', order: 'ASC' }],
        cursorPaging: { limit: 100 },
      };
    const data = await wixRequest(cfg, fetchImpl, '/ecom/v1/orders/search', { method: 'POST', body: { search } });
    orders.push(...(data.orders || []));
    cursor = data.metadata?.hasNext ? data.metadata?.cursors?.next : null;
    if (!cursor) return { orders, truncated: false };
    if (orders.length >= MAX_ORDERS) return { orders, truncated: true };
  }
}

async function queryBalanceRecords(cfg, fetchImpl, range) {
  const records = [];
  for (let offset = 0; ; offset += 1000) {
    const data = await wixRequest(cfg, fetchImpl, '/wixpay-balances/v5/balance-records/query', {
      method: 'POST',
      body: {
        accountId: cfg.paymentsAccountId,
        excludeTotal: true,
        query: {
          filter: { $and: [
            { transaction_creation_date: { $gte: range.startIso } },
            { transaction_creation_date: { $lt: range.endIso } },
          ] },
          sort: [{ fieldName: 'applied_date', order: 'ASC' }],
          paging: { limit: 1000, offset },
        },
      },
    });
    const page = data.records || [];
    records.push(...page);
    if (page.length < 1000) return { records, truncated: false };
    if (records.length >= MAX_RECORDS) return { records, truncated: true };
  }
}

// Saldo atual da conta por etiqueta (PENDING = em liberação, AVAILABLE = disponível para resgate).
async function balanceByTag(cfg, fetchImpl, tag) {
  const data = await wixRequest(cfg, fetchImpl, '/wixpay-balances/v5/balance-records/query', {
    method: 'POST',
    body: { accountId: cfg.paymentsAccountId, includeSummary: true, query: { filter: { tags: { $in: [tag] } }, paging: { limit: 1, offset: 0 } } },
  });
  return cents(data.summary?.totalNet ?? data.summary?.total);
}

async function listPayouts(cfg, fetchImpl, range) {
  const payouts = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const params = new URLSearchParams({
      accountId: cfg.paymentsAccountId,
      createdAfter: range.startIso,
      createdBefore: range.endIso,
      'paging.limit': '100',
      'paging.offset': String(offset),
    });
    const data = await wixRequest(cfg, fetchImpl, `/wixpay-payouts/v4/payouts?${params}`);
    const page = data.payouts || [];
    payouts.push(...page);
    if (page.length < 100) break;
  }
  return payouts;
}

function normalizeOrder(order) {
  if (!order?.id) return null;
  const contact = order.billingInfo?.contactDetails || {};
  const buyer = [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(' ') || text(contact.company) || text(order.buyerInfo?.email);
  return {
    id: String(order.id),
    number: text(order.number),
    createdDate: text(order.createdDate),
    purchasedDate: text(order.purchasedDate),
    status: text(order.status),
    paymentStatus: text(order.paymentStatus),
    buyer: buyer || 'Cliente Wix',
    email: text(order.buyerInfo?.email),
    items: (order.lineItems || []).map(li => text(li?.productName)).filter(Boolean),
    totalCents: cents(order.priceSummary?.total),
    paidCents: cents(order.balanceSummary?.paid),
    refundedCents: cents(order.balanceSummary?.refunded),
    currency: text(order.currency),
  };
}

function normalizeRecord(record) {
  return {
    id: record.id || null,
    type: record.recordType || 'UNKNOWN',
    status: record.recordStatus || 'UNKNOWN',
    amountCents: cents(record.amount),
    feeCents: cents(record.fee),
    netCents: cents(record.net),
    appliedDate: record.appliedDate || null,
    availableOn: record.payoutAvailabilityDate || null,
    payoutId: record.payoutInfo?.payoutId || record.reserveInfo?.hold?.payoutId || null,
    payoutDate: record.payoutInfo?.createdDate || record.bookTransferInfo?.createdDate || null,
    orderId: record.paymentInfo?.externalOrderId || null,
    displayOrderId: record.paymentInfo?.externalDisplayOrderId || null,
    customer: record.paymentInfo?.customerName || record.paymentInfo?.cardHolderName || null,
    transactionCreated: record.paymentInfo?.createdDate || null,
  };
}

function normalizePayout(payout) {
  return {
    id: payout.id || null,
    createdDate: payout.createdDate || null,
    status: payout.status || 'UNKNOWN',
    amountCents: cents(payout.amount),
    arrival: payout.estimatedArrivalDateV2 || null,
    reference: payout.bankTransferReference || null,
    failure: payout.failureReason?.code || null,
  };
}

const PAID = new Set(['PAID', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED']);
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);

// Situação de cada venda frente ao saldo Wix Payments.
function situation(order, records, paymentsEnabled) {
  if (order.status === 'CANCELED') return 'cancelado';
  if (!PAID.has(order.paymentStatus) && !(order.paidCents > 0)) return 'aguardando_cliente';
  if (!paymentsEnabled) return 'pago';
  const credits = records.filter(r => r.type === 'CREDIT');
  if (!credits.length) return 'fora_wix_payments';
  if (credits.some(r => r.status === 'PENDING_CREDIT')) return 'em_liberacao';
  if (credits.some(r => r.status === 'CREDITED' || r.status === 'PAYOUT_REVERSED')) return 'disponivel';
  if (credits.every(r => r.status === 'PAID_OUT')) return 'resgatado';
  return 'conferir';
}

/**
 * Confronto puro (sem I/O): vendas do período x registros do saldo x resgates.
 * Valores em centavos; null quando a Wix não informou.
 */
function reconcile({ orders, records, payouts, inFinance = new Set(), paymentsEnabled }) {
  const byOrder = new Map();
  const matched = new Set();
  const index = new Map();
  for (const order of orders) {
    index.set(order.id, order);
    if (order.number) index.set(`#${order.number}`, order);
  }
  for (const record of records) {
    const order = index.get(record.orderId) || (record.displayOrderId && index.get(`#${String(record.displayOrderId).replace(/^#/, '')}`));
    if (!order) continue;
    matched.add(record);
    if (!byOrder.has(order.id)) byOrder.set(order.id, []);
    byOrder.get(order.id).push(record);
  }

  const rows = orders.map(order => {
    const own = byOrder.get(order.id) || [];
    const state = situation(order, own, paymentsEnabled);
    const payout = own.find(r => r.payoutId);
    return {
      ...order,
      situation: state,
      feeCents: own.length ? sum(own, 'feeCents') : null,
      netCents: own.length ? sum(own, 'netCents') : null,
      availableOn: own.find(r => r.status === 'PENDING_CREDIT')?.availableOn || null,
      payoutId: payout?.payoutId || null,
      payoutDate: payout?.payoutDate || null,
      inFinance: inFinance.has(`wix-${order.id}`),
    };
  });

  const live = rows.filter(r => r.situation !== 'cancelado');
  const net = state => sum(rows.filter(r => r.situation === state), 'netCents');
  const others = records.filter(r => !matched.has(r));
  const sentPayouts = payouts.filter(p => p.status === 'SENT');

  return {
    rows,
    otherRecords: others,
    payouts,
    totals: {
      orders: live.length,
      canceled: rows.length - live.length,
      soldCents: sum(live, 'totalCents'),
      paidByCustomersCents: sum(live, 'paidCents'),
      awaitingCustomersCents: sum(live.filter(r => r.situation === 'aguardando_cliente'), 'totalCents'),
      feesCents: paymentsEnabled ? sum(records, 'feeCents') : null,
      withdrawnCents: paymentsEnabled ? net('resgatado') : null,
      pendingReleaseCents: paymentsEnabled ? net('em_liberacao') : null,
      availableCents: paymentsEnabled ? net('disponivel') : null,
      outsideWixPaymentsCents: paymentsEnabled ? sum(rows.filter(r => r.situation === 'fora_wix_payments'), 'paidCents') : null,
      otherRecordsNetCents: paymentsEnabled ? sum(others, 'netCents') : null,
      payoutsSentCents: paymentsEnabled ? sum(sentPayouts, 'amountCents') : null,
      payoutsFailed: payouts.filter(p => p.status === 'FAILED').length,
      notInFinance: live.filter(r => PAID.has(r.paymentStatus) && !r.inFinance).length,
    },
  };
}

// Pedidos pagos já lançados no Financeiro pelo /sync-wix-orders (docId wix-{UUID}).
async function financeIds(db, orders) {
  const found = new Set();
  if (typeof db.getAll !== 'function') return found;
  const refs = orders.map(o => db.collection('transactions').doc(`wix-${o.id}`));
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    for (const snap of snaps) if (snap.exists && snap.data()?.isExcluded !== true) found.add(snap.id);
  }
  return found;
}

async function buildReport({ db, env, fetchImpl, start, end, now = () => new Date() }) {
  const cfg = config(env);
  const range = period(start, end);
  if (cfg.missing.length) {
    return { configured: false, missing: cfg.missing, paymentsMissing: cfg.paymentsMissing, period: { start, end } };
  }
  const paymentsEnabled = cfg.paymentsMissing.length === 0;
  const [orderResult, recordResult, payouts, pending, available] = await Promise.all([
    searchOrders(cfg, fetchImpl, range),
    paymentsEnabled ? queryBalanceRecords(cfg, fetchImpl, range) : { records: [], truncated: false },
    paymentsEnabled ? listPayouts(cfg, fetchImpl, range) : [],
    paymentsEnabled ? balanceByTag(cfg, fetchImpl, 'PENDING') : null,
    paymentsEnabled ? balanceByTag(cfg, fetchImpl, 'AVAILABLE') : null,
  ]);
  const orders = orderResult.orders.map(normalizeOrder).filter(Boolean);
  const records = recordResult.records.map(normalizeRecord);
  const result = reconcile({
    orders,
    records,
    payouts: payouts.map(normalizePayout),
    inFinance: await financeIds(db, orders),
    paymentsEnabled,
  });
  return {
    configured: true,
    paymentsEnabled,
    paymentsMissing: cfg.paymentsMissing,
    period: { start, end },
    generatedAt: now().toISOString(),
    truncated: orderResult.truncated || recordResult.truncated,
    balance: paymentsEnabled ? { pendingCents: pending, availableCents: available } : null,
    ...result,
  };
}

function createWixTreasuryHandler({ getServices, sendJson, env = process.env, fetchImpl = fetch, now }) {
  return async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/wix-treasury/')) return false;
    try {
      if (request.method !== 'GET' || url.pathname !== '/api/wix-treasury/report') throw new WixTreasuryError('Rota não encontrada.', 404);
      const { adminAuth, adminDb: db } = getServices();
      const bearer = String(request.headers.authorization || '').match(/^Bearer (\S+)$/);
      if (!bearer) throw new WixTreasuryError('Entre novamente para consultar a Tesouraria Wix.', 401);
      let uid;
      try { uid = (await adminAuth.verifyIdToken(bearer[1], true)).uid; } catch { throw new WixTreasuryError('Sessão expirada. Entre novamente.', 401); }
      const profile = await db.collection('users').doc(uid).get();
      if (!profile.exists || !permitted(profile.data())) throw new WixTreasuryError('Sem permissão para a Tesouraria Wix.', 403);
      const report = await buildReport({
        db, env, fetchImpl, now,
        start: url.searchParams.get('start'),
        end: url.searchParams.get('end'),
      });
      sendJson(request, response, 200, report);
    } catch (error) {
      const status = error instanceof WixTreasuryError ? error.status : 500;
      if (status >= 500 && !(error instanceof WixTreasuryError)) console.error('[wix-treasury]', error);
      sendJson(request, response, status, { error: error instanceof WixTreasuryError ? error.message : 'Não foi possível gerar o relatório Wix.' });
    }
    return true;
  };
}

module.exports = {
  WixTreasuryError,
  buildReport,
  cents,
  config,
  createWixTreasuryHandler,
  normalizeOrder,
  normalizePayout,
  normalizeRecord,
  period,
  reconcile,
};
