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
// Conta Wix Pagamentos Brasil: o painel não expõe o accountId e as APIs de saldo
// acima não cobrem a conta BR. Nesse caso o usuário importa o "Relatório de
// pagamentos" (CSV exportado do painel Wix Pagamentos) e o confronto usa as
// parcelas do arquivo no lugar do saldo/resgates da API. O arquivo só é lido
// na requisição; nada é guardado.
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
    // Com parcelas, a próxima liberação é a mais próxima.
    const nextRelease = own.filter(r => r.status === 'PENDING_CREDIT' && r.availableOn).map(r => r.availableOn).sort()[0];
    return {
      ...order,
      situation: state,
      feeCents: own.length ? sum(own, 'feeCents') : null,
      netCents: own.length ? sum(own, 'netCents') : null,
      availableOn: nextRelease || null,
      payoutId: payout?.payoutId || null,
      payoutDate: payout?.payoutDate || null,
      inFinance: inFinance.has(`wix-${order.id}`),
    };
  });

  const live = rows.filter(r => r.situation !== 'cancelado');
  // Somado por registro, não por pedido: venda parcelada pode ter parcelas já pagas e outras em liberação.
  const liveRecords = live.flatMap(r => byOrder.get(r.id) || []);
  const net = (...statuses) => sum(liveRecords.filter(r => statuses.includes(r.status)), 'netCents');
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
      withdrawnCents: paymentsEnabled ? net('PAID_OUT') : null,
      pendingReleaseCents: paymentsEnabled ? net('PENDING_CREDIT') : null,
      availableCents: paymentsEnabled ? net('CREDITED', 'PAYOUT_REVERSED') : null,
      outsideWixPaymentsCents: paymentsEnabled ? sum(rows.filter(r => r.situation === 'fora_wix_payments'), 'paidCents') : null,
      otherRecordsNetCents: paymentsEnabled ? sum(others, 'netCents') : null,
      payoutsSentCents: paymentsEnabled ? sum(sentPayouts, 'amountCents') : null,
      payoutsFailed: payouts.filter(p => p.status === 'FAILED').length,
      notInFinance: live.filter(r => PAID.has(r.paymentStatus) && !r.inFinance).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Relatório de pagamentos do Wix Pagamentos Brasil (CSV do painel, uma linha por parcela).
// Colunas: paymentDate, transactionCreationDate, payableType, amount, wixFee, netAmount,
// payableStatus, installmentNumber, payableId, ..., transactionId, customerName, externalOrderId.
// ---------------------------------------------------------------------------

const FUNDS_COLUMNS = ['paymentDate', 'transactionCreationDate', 'payableType', 'amount', 'wixFee', 'netAmount', 'payableStatus', 'payableId', 'externalOrderId'];
const FUNDS_TYPES = { 'crédito': 'CREDIT', credito: 'CREDIT', reembolsar: 'REFUND', reembolso: 'REFUND', chargeback: 'CHARGEBACK' };
// "Pago" = parcela já paga pela Wix (depósito automático ou resgate); "Aguardando pagamento" = ainda em liberação.
const FUNDS_STATUS = { pago: 'PAID_OUT', 'aguardando pagamento': 'PENDING_CREDIT' };

function parseCsv(textValue) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(textValue).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

// "1.666,43" → 166643. Ausente ≠ zero.
function brCents(value) {
  const raw = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// "05/01/27 06:00" (horário de Brasília) → { iso, day: '2027-01-05' }.
function brDate(value) {
  const m = String(value ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const day = `${year}-${m[2]}-${m[1]}`;
  if (!isDate(day)) return null;
  return { day, iso: new Date(Date.parse(`${day}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`)).toISOString() };
}

/** CSV do painel → registros no mesmo formato de normalizeRecord. */
function parseFundsReport(csvText) {
  const [header, ...lines] = parseCsv(csvText);
  const cols = (header || []).map(h => h.trim());
  const missing = FUNDS_COLUMNS.filter(c => !cols.includes(c));
  if (missing.length) {
    throw new WixTreasuryError(`O arquivo não é o Relatório de pagamentos do Wix Pagamentos (faltam as colunas ${missing.join(', ')}).`);
  }
  return lines.map(line => {
    const get = name => text(line[cols.indexOf(name)]);
    const paid = brDate(get('paymentDate'));
    const created = brDate(get('transactionCreationDate'));
    const typeRaw = (get('payableType') || '').toLowerCase();
    const status = FUNDS_STATUS[(get('payableStatus') || '').toLowerCase()] || 'UNKNOWN';
    return {
      id: get('payableId'),
      type: FUNDS_TYPES[typeRaw] || (typeRaw ? typeRaw.toUpperCase() : 'UNKNOWN'),
      status,
      amountCents: brCents(get('amount')),
      feeCents: brCents(get('wixFee')),
      netCents: brCents(get('netAmount')),
      appliedDate: created?.iso || null,
      availableOn: status === 'PENDING_CREDIT' ? paid?.day || null : null,
      payoutId: status === 'PAID_OUT' && paid ? `wix-br-${paid.day}` : null,
      payoutDate: status === 'PAID_OUT' ? paid?.iso || null : null,
      orderId: get('externalOrderId'),
      displayOrderId: null,
      customer: get('customerName'),
      transactionCreated: created?.iso || null,
      installment: get('installmentNumber'),
    };
  });
}

// Parcelas das vendas do período, pagamentos da Wix no período (agrupados por dia) e saldo a liberar hoje.
function fundsReportView(records, range) {
  const within = iso => Boolean(iso) && iso >= range.startIso && iso < range.endIso;
  const byDay = new Map();
  for (const r of records) {
    if (r.status !== 'PAID_OUT' || !within(r.payoutDate)) continue;
    const day = r.payoutId;
    if (!byDay.has(day)) byDay.set(day, { id: day, createdDate: r.payoutDate, status: 'SENT', amountCents: 0, arrival: day.slice(-10), reference: null, failure: null });
    byDay.get(day).amountCents += r.netCents || 0;
  }
  return {
    records: records.filter(r => within(r.transactionCreated)),
    payouts: [...byDay.values()].sort((a, b) => a.createdDate.localeCompare(b.createdDate)),
    balance: { pendingCents: sum(records.filter(r => r.status === 'PENDING_CREDIT'), 'netCents'), availableCents: null },
    summary: {
      payables: records.length,
      latestPaymentDate: records.map(r => r.payoutDate).filter(Boolean).sort().pop() || null,
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

async function buildReport({ db, env, fetchImpl, start, end, fundsCsv = null, now = () => new Date() }) {
  const cfg = config(env);
  const range = period(start, end);
  if (cfg.missing.length) {
    return { configured: false, missing: cfg.missing, paymentsMissing: cfg.paymentsMissing, period: { start, end } };
  }
  // O relatório importado tem prioridade: é o único caminho para a conta Wix Pagamentos Brasil.
  const funds = fundsCsv ? fundsReportView(parseFundsReport(fundsCsv), range) : null;
  const apiPayments = !funds && cfg.paymentsMissing.length === 0;
  const paymentsEnabled = Boolean(funds) || apiPayments;
  const [orderResult, recordResult, payouts, pending, available] = await Promise.all([
    searchOrders(cfg, fetchImpl, range),
    apiPayments ? queryBalanceRecords(cfg, fetchImpl, range) : { records: [], truncated: false },
    apiPayments ? listPayouts(cfg, fetchImpl, range) : [],
    apiPayments ? balanceByTag(cfg, fetchImpl, 'PENDING') : null,
    apiPayments ? balanceByTag(cfg, fetchImpl, 'AVAILABLE') : null,
  ]);
  const orders = orderResult.orders.map(normalizeOrder).filter(Boolean);
  const records = funds ? funds.records : recordResult.records.map(normalizeRecord);
  const result = reconcile({
    orders,
    records,
    payouts: funds ? funds.payouts : payouts.map(normalizePayout),
    inFinance: await financeIds(db, orders),
    paymentsEnabled,
  });
  return {
    configured: true,
    paymentsEnabled,
    paymentsSource: funds ? 'funds_report' : apiPayments ? 'api' : null,
    paymentsMissing: cfg.paymentsMissing,
    fundsReport: funds ? funds.summary : undefined,
    period: { start, end },
    generatedAt: now().toISOString(),
    truncated: orderResult.truncated || recordResult.truncated,
    balance: funds ? funds.balance : apiPayments ? { pendingCents: pending, availableCents: available } : null,
    ...result,
  };
}

// GET: só a API. POST { start, end, fundsCsv }: com o Relatório de pagamentos importado.
function createWixTreasuryHandler({ getServices, sendJson, readBody, env = process.env, fetchImpl = fetch, now }) {
  return async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/wix-treasury/')) return false;
    try {
      const post = request.method === 'POST' && typeof readBody === 'function';
      if ((request.method !== 'GET' && !post) || url.pathname !== '/api/wix-treasury/report') throw new WixTreasuryError('Rota não encontrada.', 404);
      const { adminAuth, adminDb: db } = getServices();
      const bearer = String(request.headers.authorization || '').match(/^Bearer (\S+)$/);
      if (!bearer) throw new WixTreasuryError('Entre novamente para consultar a Tesouraria Wix.', 401);
      let uid;
      try { uid = (await adminAuth.verifyIdToken(bearer[1], true)).uid; } catch { throw new WixTreasuryError('Sessão expirada. Entre novamente.', 401); }
      const profile = await db.collection('users').doc(uid).get();
      if (!profile.exists || !permitted(profile.data())) throw new WixTreasuryError('Sem permissão para a Tesouraria Wix.', 403);
      let params = { start: url.searchParams.get('start'), end: url.searchParams.get('end'), fundsCsv: null };
      if (post) {
        let body;
        try { body = JSON.parse((await readBody(request)).toString('utf8')); } catch (error) {
          throw new WixTreasuryError(/too large/.test(error?.message) ? 'Arquivo grande demais. Exporte o relatório de pagamentos só do período.' : 'Envio inválido.', /too large/.test(error?.message) ? 413 : 400);
        }
        if (typeof body?.fundsCsv !== 'string' || !body.fundsCsv.trim()) throw new WixTreasuryError('Envie o Relatório de pagamentos (CSV).');
        params = { start: body.start, end: body.end, fundsCsv: body.fundsCsv };
      }
      const report = await buildReport({ db, env, fetchImpl, now, ...params });
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
  brCents,
  brDate,
  buildReport,
  cents,
  config,
  createWixTreasuryHandler,
  fundsReportView,
  normalizeOrder,
  normalizePayout,
  normalizeRecord,
  parseCsv,
  parseFundsReport,
  period,
  reconcile,
};
