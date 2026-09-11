const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  console.log('health ok');
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ----------------------------------------------------------------------------
// unwrapWixBody: Wix Automations as vezes envelopam o payload em camadas
// ({data:{data:{...}}}). Desembrulha ate 3 niveis defensivamente.
// Adicionado em 02/05/2026 apos diagnostico de 82% de miss pos-Wave 2.
// ----------------------------------------------------------------------------
function unwrapWixBody(rawBody) {
  let b = rawBody || {};
  for (let i = 0; i < 3; i++) {
    if (b && typeof b === 'object' && b.data && typeof b.data === 'object'
        && !Array.isArray(b.data)) {
      b = b.data;
    } else break;
  }
  return b;
}

function normalizeDate(value) {
  if (!value) return '';
  const text = String(value).trim();
  const iso = text.includes('T') ? text.split('T')[0] : text;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

function firstDate(...values) {
  for (const value of values) {
    const normalized = normalizeDate(value);
    if (normalized) return normalized;
  }
  return '';
}

function parseTotal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value === 'object') {
    return firstPositiveAmount(
      value.amount,
      value.value,
      value.total,
      value.formattedAmount,
      value.formattedValue
    );
  }
  if (typeof value !== 'string') return 0;

  let raw = value.trim().replace(/[^0-9,.\-]/g, '');
  if (!raw) return 0;

  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // O ultimo separador e o decimal: aceita R$ 3.300,00 e $3,300.00.
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    raw = raw.replace(thousands, '').replace(decimal, '.');
  } else if (comma >= 0) {
    const decimals = raw.length - comma - 1;
    raw = decimals === 2 ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (dot >= 0) {
    const parts = raw.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      raw = parts.join('');
    }
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPositiveAmount(...values) {
  for (const value of values) {
    const amount = parseTotal(value);
    if (amount > 0) return amount;
  }
  return 0;
}

function canonicalInvoiceStatus(value, fallback = 'Pendente') {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (['paid', 'pago', 'paga', 'received', 'recebido', 'settled', 'quitado', 'liquidado'].includes(normalized)) return 'Paga';
  if (['overdue', 'vencido', 'vencida'].includes(normalized)) return 'Vencida';
  if (['pending', 'pendente', 'sent', 'enviada', 'enviado', 'unpaid'].includes(normalized)) return 'Pendente';
  return String(value || fallback).trim() || fallback;
}

function isPaidInvoiceStatus(value) {
  return canonicalInvoiceStatus(value, '') === 'Paga';
}

function resolveInvoiceAmount(existing, body) {
  return firstPositiveAmount(
    body.total,
    body.amount,
    body.totalAmount,
    body.invoiceTotal,
    body.balance,
    body.price,
    existing.valorOriginal,
    existing.totalCobranca,
    existing.valueReceived,
    existing.valuePaid
  );
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  return null;
}

async function getExistingTransaction(token, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${docId}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (response.status === 404) return {};
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`firestore GET ${docId} failed ${response.status}: ${detail.substring(0, 200)}`);
  }
  const payload = await response.json();
  return Object.fromEntries(
    Object.entries(payload.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
}

function resolveInvoiceDates(existing, body, status, fallbackToday) {
  const issueDate = firstDate(
    body.issueDate,
    body.emissionDate,
    body.issue_date,
    body.createdDate,
    body.date,
    existing.date,
    fallbackToday
  );

  if (isPaidInvoiceStatus(status)) {
    const paymentDate = firstDate(
      body.actualPaymentDate,
      body.paidDate,
      body.paymentDate,
      existing.paymentDate,
      fallbackToday
    );
    const dueDate = firstDate(
      body.dueDate,
      body.validityDate,
      body.expirationDate,
      existing.dueDate,
      body.paymentDate,
      issueDate
    );
    return { issueDate, dueDate, paymentDate };
  }

  const dueDate = firstDate(
    body.dueDate,
    body.validityDate,
    body.expirationDate,
    body.paymentDate,
    existing.dueDate,
    issueDate
  );
  return { issueDate, dueDate, paymentDate: '' };
}

function buildInvoiceTransaction(existing, body, requestedStatus, identifiers, fallbackToday) {
  const incomingStatus = canonicalInvoiceStatus(requestedStatus);
  // Automacoes de vencimento/pendencia podem chegar fora de ordem. Uma baixa ja
  // confirmada nunca pode ser desfeita por esses eventos atrasados.
  const status = isPaidInvoiceStatus(existing.status) && !isPaidInvoiceStatus(incomingStatus)
    ? canonicalInvoiceStatus(existing.status)
    : incomingStatus;
  const total = resolveInvoiceAmount(existing, body);
  const dates = resolveInvoiceDates(existing, body, status, fallbackToday);
  const paid = isPaidInvoiceStatus(status);
  const { docId, numStr, entityId } = identifiers;

  return {
    ...existing,
    id: docId,
    source: 'wix',
    movement: 'Entrada',
    type: 'Entrada de Caixa / Contas a Receber',
    status,
    client: body.client || body.customer || existing.client || '',
    date: dates.issueDate,
    dueDate: dates.dueDate,
    paymentDate: paid ? dates.paymentDate : '',
    valorOriginal: total,
    valuePaid: 0,
    valueReceived: paid ? total : 0,
    bankAccount: existing.bankAccount || '',
    description: existing.description || (numStr
      ? `Fatura Wix #${numStr}`
      : `Fatura Wix (id ${String(entityId).substring(0, 8)})`),
    wixInvoiceNumber: numStr || existing.wixInvoiceNumber || '',
    wixEntityId: entityId || existing.wixEntityId || '',
    method: existing.method || 'Fatura Online',
    updatedAt: new Date().toISOString()
  };
}


app.post('/wix-import', async (req, res) => {
  try {
    const { invoices = [] } = req.body;
    const token = await getToken();
    let total = 0;
    for (const inv of invoices) {
      await fetch(`https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${inv.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFirestore(inv) })
      });
      total++;
    }
    res.json({ ok: true, imported: total });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/wix-payment', async (req, res) => {
  try {
    const { invoiceNumber, status, paymentDate } = req.body;
    if (!invoiceNumber) return res.status(400).json({ ok: false, error: 'invoiceNumber required' });
    const numStr = String(invoiceNumber).padStart(7, '0');
    const docId = `wix-inv-${numStr}`;
    const token = await getToken();
    const existing = await getExistingTransaction(token, docId);
    const total = resolveInvoiceAmount(existing, req.body);
    const fields = {
      status: { stringValue: canonicalInvoiceStatus(status || 'Paga') },
      paymentDate: { stringValue: paymentDate || new Date().toISOString().split('T')[0] },
      valuePaid: { doubleValue: 0 },
      valueReceived: { doubleValue: total },
      valorOriginal: { doubleValue: total },
      updatedAt: { stringValue: new Date().toISOString() }
    };
    const masks = ['status', 'paymentDate', 'valuePaid', 'valueReceived', 'valorOriginal', 'updatedAt']
      .map((field) => `updateMask.fieldPaths=${field}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${docId}?${masks}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    console.log(`Payment synced: ${docId} -> ${status} @ ${paymentDate}`);
    res.json({ ok: true, docId });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ============================================================================
// NOVA ROTA (Wave 2) — POST /wix-webhook
// Recebe Wix Automations "Fatura é paga" (e futuros: enviada / vencida).
// Body atual (do screenshot): { entityId, client, total, paymentDate }
// Body futuro (quando Paulo adicionar): { number, status, ... }
// ============================================================================
app.post('/wix-webhook', async (req, res) => {
  try {
    const b = unwrapWixBody(req.body);

    // Resolve identificadores: prefere "number" humano, fallback pra entityId UUID.
    const wixNumber = b.number || b.invoiceNumber || b.invoice_number || null;
    const entityId  = b.entityId || b.id || b.invoiceId || null;

    if (!wixNumber && !entityId) {
      console.warn('wix-webhook: missing both number and entityId; raw=',
        JSON.stringify(req.body).substring(0, 400),
        'parsed=', JSON.stringify(b).substring(0, 200));
      return res.status(400).json({
        ok: false,
        error: 'either number/invoiceNumber or entityId required',
        received: b
      });
    }

    // docId: prefere número humano (wix-inv-0004107) ao UUID (wix-inv-abc12345-...)
    const numStr = wixNumber ? String(wixNumber).padStart(7, '0') : null;
    const docId  = numStr ? `wix-inv-${numStr}` : `wix-inv-${entityId}`;

    // Status: default 'Paga' (Automation atual é "Fatura é paga").
    const status = canonicalInvoiceStatus(b.status || 'Paga');

    const token = await getToken();
    const existing = await getExistingTransaction(token, docId);
    const today = new Date().toISOString().split('T')[0];
    const doc = buildInvoiceTransaction(existing, b, status, { docId, numStr, entityId }, today);

    const url = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${docId}`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestore(doc) })
    });

    if (!r.ok) {
      const t = await r.text();
      console.error(`wix-webhook PATCH failed ${r.status}: ${t.substring(0, 300)}`);
      return res.status(500).json({
        ok: false,
        error: `firestore ${r.status}`,
        detail: t.substring(0, 200)
      });
    }

    console.log(`wix-webhook OK: ${docId} status=${doc.status} client="${(b.client||'').substring(0,40)}" total=${doc.valorOriginal} issue=${doc.date} due=${doc.dueDate} paid=${doc.paymentDate}`);
    res.json({
      ok: true,
      docId,
      status: doc.status,
      identifierUsed: numStr ? 'number' : 'entityId'
    });
  } catch (err) {
    console.error('wix-webhook error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Health check pra confirmar que a rota existe.
app.get('/wix-webhook', (req, res) => {
  res.json({
    ok: true,
    note: 'POST aqui com body do Wix Automation. GET é só health check.',
    expectedFields: ['entityId | number', 'client', 'total', 'paymentDate', '(opcional) status']
  });
});


// ============================================================================
// NOVA ROTA (Wave 2b) — POST /wix-webhook-pendente e /wix-webhook-vencida
// Mesma logica de /wix-webhook mas com status default diferente:
//   /wix-webhook-pendente -> status='Pendente'  (gatilho "Fatura é enviada")
//   /wix-webhook-vencida  -> status='Vencida'   (gatilho "Fatura está vencida")
//
// O body permanece igual (5 campos: entityId, client, total, paymentDate, number).
// Nao precisa do campo 'status' no body porque a rota define isso.
// ============================================================================
function makeStatusHandler(defaultStatus) {
  return async function(req, res) {
    try {
      const b = unwrapWixBody(req.body);

      // Resolve identificadores: prefere "number" humano, fallback pra entityId UUID.
      const wixNumber = b.number || b.invoiceNumber || b.invoice_number || null;
      const entityId  = b.entityId || b.id || b.invoiceId || null;

      if (!wixNumber && !entityId) {
        console.warn(`wix-webhook-${defaultStatus.toLowerCase()}: missing both number and entityId; raw=`,
          JSON.stringify(req.body).substring(0, 400),
          'parsed=', JSON.stringify(b).substring(0, 200));
        return res.status(400).json({
          ok: false,
          error: 'either number/invoiceNumber or entityId required',
          received: b
        });
      }

      const numStr = wixNumber ? String(wixNumber).padStart(7, '0') : null;
      const docId  = numStr ? `wix-inv-${numStr}` : `wix-inv-${entityId}`;

      // Status forcado pela rota (ignora status no body, se vier).
      const status = canonicalInvoiceStatus(defaultStatus);

      const token = await getToken();
      const existing = await getExistingTransaction(token, docId);
      const today = new Date().toISOString().split('T')[0];
      const doc = buildInvoiceTransaction(existing, b, status, { docId, numStr, entityId }, today);

      const url = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${docId}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFirestore(doc) })
      });

      if (!r.ok) {
        const t = await r.text();
        console.error(`wix-webhook-${status} PATCH failed ${r.status}: ${t.substring(0, 300)}`);
        return res.status(500).json({
          ok: false,
          error: `firestore ${r.status}`,
          detail: t.substring(0, 200)
        });
      }

      console.log(`wix-webhook-${status} OK: ${docId} client="${(b.client||'').substring(0,40)}" total=${doc.valorOriginal} issue=${doc.date} due=${doc.dueDate}`);
      res.json({
        ok: true,
        docId,
        status,
        identifierUsed: numStr ? 'number' : 'entityId'
      });
    } catch (err) {
      console.error(`wix-webhook-${defaultStatus} error:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  };
}

app.post('/wix-webhook-pendente', makeStatusHandler('Pendente'));
app.get('/wix-webhook-pendente', (req, res) => {
  res.json({
    ok: true,
    note: 'POST aqui com body do Wix Automation "Fatura é enviada".',
    expectedFields: ['entityId | number', 'client', 'total', 'paymentDate (=Data de validade)', '(opcional) number']
  });
});

app.post('/wix-webhook-vencida', makeStatusHandler('Vencida'));
app.get('/wix-webhook-vencida', (req, res) => {
  res.json({
    ok: true,
    note: 'POST aqui com body do Wix Automation "Fatura está vencida".',
    expectedFields: ['entityId | number', 'client', 'total', 'paymentDate (=Data de validade)', '(opcional) number']
  });
});

// NOVA ROTA — Lista IDs das faturas wix-* já no Firestore.
// Usado pelo polling Velo pra calcular quais faturas faltam empurrar.
// Usa runQuery (filtro server-side source=wix) + paginação por __name__ cursor.
app.get('/list-wix-ids', async (req, res) => {
  try {
    const token = await getToken();
    const ids = new Set();
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 30; // até 30k docs (temos ~750)
    let cursorName = null;
    let pages = 0;
    let totalDocsSeen = 0;

    while (pages < MAX_PAGES) {
      const body = {
        structuredQuery: {
          from: [{ collectionId: 'transactions' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'source' },
              op: 'EQUAL',
              value: { stringValue: 'wix' }
            }
          },
          orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
          limit: PAGE_SIZE
        }
      };
      if (cursorName) {
        body.structuredQuery.startAt = {
          values: [{ referenceValue: cursorName }],
          before: false
        };
      }

      const r = await fetch(
        'https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents:runQuery',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      );
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`runQuery failed ${r.status}: ${t.substring(0, 300)}`);
      }
      const arr = await r.json();
      const pageDocs = arr.filter(x => x && x.document);
      pages++;
      totalDocsSeen += pageDocs.length;

      let lastName = null;
      for (const row of pageDocs) {
        const docName = row.document.name;
        const docId = docName.split('/').pop();
        ids.add(docId);
        lastName = docName;
      }

      // Se essa página retornou menos que PAGE_SIZE, acabou.
      if (pageDocs.length < PAGE_SIZE) break;
      cursorName = lastName; // próximo page começa depois (before:false) deste
    }

    const result = Array.from(ids).sort();
    console.log(`list-wix-ids: ${result.length} unique IDs (${totalDocsSeen} rows scanned in ${pages} pages)`);
    res.json({ ok: true, count: result.length, pages, ids: result });
  } catch (err) {
    console.error('list-wix-ids error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// NOVA ROTA — testa se a Wix REST API responde com nossa WIX_API_KEY.
// Tenta múltiplos endpoints (moderno e legado) e retorna qual funciona.
// NÃO expõe a chave; só status, sample e erro.
app.get('/test-wix-rest', async (req, res) => {
  try {
    const apiKey = process.env.WIX_API_KEY || '';
    const siteId = '1e7a5d33-26d6-4f39-8f4c-be9452b1eb10';

    const keyInfo = {
      present: !!apiKey,
      length: apiKey.length,
      starts_with: apiKey ? apiKey.substring(0, 4) : null
    };

    // Endpoints candidatos a testar
    const endpoints = [
      // ⭐ ESTE É O QUE A SP USAVA EM MAR/26 (WixSync.gs v20)
      { name: 'ecom_v1_orders_search', method: 'POST',
        url: 'https://www.wixapis.com/ecom/v1/orders/search',
        body: JSON.stringify({
          search: {
            filter: { paymentStatus: 'PAID' },
            sort: [{ fieldName: 'createdDate', order: 'DESC' }],
            cursorPaging: { limit: 5 }
          }
        }) },
      // FALLBACK que tava no código antigo
      { name: 'stores_v2_orders_query', method: 'POST',
        url: 'https://www.wixapis.com/stores/v2/orders/query',
        body: JSON.stringify({
          query: {
            filter: '{"paymentStatus":"PAID"}',
            sort: '[{"number":"desc"}]',
            paging: { limit: 5, offset: 0 }
          }
        }) },
      // V3 moderno (Wix Invoices novo)
      { name: 'invoices_v3_query', method: 'POST',
        url: 'https://www.wixapis.com/invoices/v3/invoices/query',
        body: JSON.stringify({ query: { paging: { limit: 5 } } }) },
      { name: 'invoices_v3_list', method: 'GET',
        url: 'https://www.wixapis.com/invoices/v3/invoices?paging.limit=5' },
      // Billing V2 / legado
      { name: 'billing_v2_invoices', method: 'GET',
        url: 'https://www.wixapis.com/billing/v2/invoices?paging.limit=5' },
      { name: 'billing_v1_invoices', method: 'GET',
        url: 'https://www.wixapis.com/billing/v1/invoices?limit=5' },
      // Tenta também o app moderno via path alternativo
      { name: 'apps_invoices_query', method: 'POST',
        url: 'https://www.wixapis.com/_api/invoices-server/invoices/query',
        body: JSON.stringify({ query: { paging: { limit: 5 } } }) }
    ];

    const results = {};

    for (const ep of endpoints) {
      try {
        const init = {
          method: ep.method,
          headers: {
            'Authorization': apiKey,
            'wix-site-id': siteId,
            'wix-account-id': '09770c2d-a415-40b6-87a6-6cded615ba67',
            'Content-Type': 'application/json'
          }
        };
        if (ep.body) init.body = ep.body;

        const r = await fetch(ep.url, init);
        const text = await r.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { /* not json */ }

        results[ep.name] = {
          status: r.status,
          ok: r.ok,
          // Primeiros 600 chars do body
          body_preview: text.substring(0, 5000),
          // Se for JSON e tiver invoices/items, conta
          item_count: parsed && (
            (parsed.invoices && parsed.invoices.length) ||
            (parsed.items && parsed.items.length) ||
            null
          )
        };
      } catch (err) {
        results[ep.name] = { error: err.message };
      }
    }

    res.json({ ok: true, key: keyInfo, siteId, results });
  } catch (err) {
    console.error('test-wix-rest error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ============================================================================
// /sync-wix-orders — porta a lógica do WixSync.gs v20 (mar/26).
// Lê pedidos PAGOS do Wix e empurra os novos pro Firestore.
//
// Uso:
//   GET  /sync-wix-orders                  → últimos 30 dias, max 1000 orders
//   GET  /sync-wix-orders?days=7           → últimos 7 dias
//   GET  /sync-wix-orders?days=365         → últimos 12 meses
//   GET  /sync-wix-orders?days=999&dry=1   → DRY-RUN (não escreve no Firestore)
//
// Aceita GET (Cloud Scheduler usa GET por padrão) e POST.
// ============================================================================
const WIX_SITE_ID    = '1e7a5d33-26d6-4f39-8f4c-be9452b1eb10';
const WIX_ACCOUNT_ID = '09770c2d-a415-40b6-87a6-6cded615ba67';

function wixHeaders() {
  return {
    'Authorization': process.env.WIX_API_KEY || '',
    'wix-site-id': WIX_SITE_ID,
    'wix-account-id': WIX_ACCOUNT_ID,
    'Content-Type': 'application/json'
  };
}

// Detecta método de pagamento legível (mesma lógica do WixSync.gs antigo)
function describePayment(rawMethod) {
  const m = String(rawMethod || '').toLowerCase();
  if (m.includes('credit'))  return 'Cartao de Credito';
  if (m.includes('debit'))   return 'Cartao de Debito';
  if (m.includes('pix'))     return 'PIX via Wix';
  if (m.includes('boleto'))  return 'Boleto via Wix';
  if (m.includes('manual'))  return 'Pago Manualmente';
  if (m.includes('offline')) return 'Pagamento Offline';
  if (m.includes('cash'))    return 'Dinheiro';
  return rawMethod || 'Recebimento Wix / Cartao';
}

// Mapeia uma order do /stores/v2 pro formato do nosso Firestore
function mapStoresOrder(o) {
  const id = o.id || o._id || '';
  const number = o.number != null ? String(o.number) : '';

  // Datas: usa dateCreated (formato Stores v2)
  const dateIso = o.dateCreated || o.createdDate || o.purchasedDate || new Date().toISOString();
  const dateStr = String(dateIso).split('T')[0]; // YYYY-MM-DD
  const updatedIso = o.updatedDate || dateIso;

  // Cliente
  let client = '';
  if (o.buyerInfo) {
    const fn = o.buyerInfo.firstName || '';
    const ln = o.buyerInfo.lastName || '';
    client = (fn + ' ' + ln).trim();
    if (!client && o.buyerInfo.email) client = o.buyerInfo.email;
  }
  if (!client && o.billingInfo && o.billingInfo.contactDetails) {
    const c = o.billingInfo.contactDetails;
    client = ((c.firstName || '') + ' ' + (c.lastName || '')).trim();
  }
  if (!client) client = 'Cliente Wix';

  // Valor: totals.total no /stores/v2 vem como string ("2200")
  let amount = 0;
  if (o.totals && o.totals.total != null) amount = parseFloat(o.totals.total) || 0;
  else if (o.priceSummary && o.priceSummary.total) amount = parseFloat(o.priceSummary.total.amount) || 0;

  // Método de pagamento
  const rawPayment = (o.billingInfo && o.billingInfo.paymentMethod) || '';
  const description = describePayment(rawPayment);

  return {
    id: 'wix-' + id,
    source: 'wix',
    movement: 'Entrada',
    type: 'Recebimento Wix / Cartao',
    status: 'Pago',
    client: client,
    date: dateStr,
    dueDate: dateStr,
    paymentDate: dateStr,
    valorOriginal: amount,
    valuePaid: 0,
    valueReceived: amount,
    bankAccount: 'Wix Payments',
    description: description,
    wixOrderNumber: number,
    wixTransactionId: id,
    paymentMethod: rawPayment,
    updatedAt: updatedIso
  };
}

// Busca uma página de orders (offset-based)
async function fetchStoresOrdersPage(offset, limit) {
  const r = await fetch('https://www.wixapis.com/stores/v2/orders/query', {
    method: 'POST',
    headers: wixHeaders(),
    body: JSON.stringify({
      query: {
        filter: '{"paymentStatus":"PAID"}',
        sort: '[{"dateCreated":"desc"}]',
        paging: { limit: limit, offset: offset }
      }
    })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`stores/v2 query failed ${r.status}: ${t.substring(0, 300)}`);
  }
  const j = await r.json();
  return j.orders || [];
}

// Lista os IDs de docs wix-* já existentes no Firestore (reusa lógica de /list-wix-ids)
async function getExistingWixIds() {
  const token = await getToken();
  const ids = new Set();
  const PAGE_SIZE = 1000;
  let cursorName = null;
  let pages = 0;
  while (pages < 30) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'transactions' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'source' },
            op: 'EQUAL',
            value: { stringValue: 'wix' }
          }
        },
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGE_SIZE
      }
    };
    if (cursorName) {
      body.structuredQuery.startAt = {
        values: [{ referenceValue: cursorName }],
        before: false
      };
    }
    const r = await fetch(
      'https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents:runQuery',
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`runQuery failed ${r.status}: ${t.substring(0, 300)}`);
    }
    const arr = await r.json();
    const pageDocs = arr.filter(x => x && x.document);
    pages++;
    let lastName = null;
    for (const row of pageDocs) {
      ids.add(row.document.name.split('/').pop());
      lastName = row.document.name;
    }
    if (pageDocs.length < PAGE_SIZE) break;
    cursorName = lastName;
  }
  return ids;
}

// Escreve UM doc no Firestore (PATCH com fields completo, mesma técnica do /wix-import)
async function writeOneToFirestore(token, parsed) {
  const id = parsed.id;
  const fields = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined)        fields[k] = { nullValue: null };
    else if (typeof v === 'string')           fields[k] = { stringValue: v };
    else if (typeof v === 'number')           fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean')          fields[k] = { booleanValue: v };
    else                                      fields[k] = { stringValue: String(v) };
  }
  const url = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${id}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`firestore PATCH ${id} failed ${r.status}: ${t.substring(0, 200)}`);
  }
}

async function syncWixOrdersHandler(req, res) {
  try {
    const days = parseInt((req.query && req.query.days) || '30', 10);
    const dryRun = (req.query && (req.query.dry === '1' || req.query.dry === 'true')) || false;
    const cutoffMs = Date.now() - days * 86400 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    if (!process.env.WIX_API_KEY) {
      return res.status(500).json({ ok: false, error: 'WIX_API_KEY env not set' });
    }

    // 1) Carrega lista de IDs já existentes
    const existing = await getExistingWixIds();

    // 2) Pagina /stores/v2/orders/query até passar do cutoff ou esgotar
    const PAGE = 100;
    const MAX_PAGES = 50; // até 5000 orders por execução (suficiente)
    let offset = 0;
    let pageCount = 0;
    let scanned = 0;
    let stoppedReason = 'esgotou';
    const candidates = []; // orders dentro da janela e novas

    while (pageCount < MAX_PAGES) {
      const orders = await fetchStoresOrdersPage(offset, PAGE);
      pageCount++;
      if (!orders.length) { stoppedReason = 'sem-mais-orders'; break; }

      let oldestThisPage = null;
      for (const o of orders) {
        scanned++;
        const created = o.dateCreated || o.createdDate || '';
        if (!oldestThisPage || created < oldestThisPage) oldestThisPage = created;

        // Se já passou do cutoff, ignora (mas continua o loop pra verificar se a página inteira é antiga)
        if (created && created < cutoffIso) continue;

        // Verifica se já existe
        const docId = 'wix-' + (o.id || o._id || '');
        if (existing.has(docId)) continue;

        candidates.push(o);
      }

      // Se a página INTEIRA já é mais antiga que cutoff, encerra
      if (oldestThisPage && oldestThisPage < cutoffIso) {
        stoppedReason = 'cutoff-atingido';
        break;
      }
      offset += PAGE;
    }

    // 3) Escreve as novas no Firestore (a menos que dryRun)
    let imported = 0;
    const errors = [];
    let writeToken = null;
    if (!dryRun && candidates.length > 0) {
      writeToken = await getToken();
      for (const o of candidates) {
        try {
          const parsed = mapStoresOrder(o);
          await writeOneToFirestore(writeToken, parsed);
          imported++;
        } catch (err) {
          errors.push({ id: o.id, err: err.message });
        }
      }
    }

    const sample = candidates.slice(0, 5).map(o => ({
      number: o.number,
      date: o.dateCreated,
      client: (o.buyerInfo && (o.buyerInfo.firstName || o.buyerInfo.email)) || '?',
      total: o.totals && o.totals.total
    }));

    console.log(`sync-wix-orders: scanned=${scanned} new=${candidates.length} imported=${imported} errors=${errors.length} dryRun=${dryRun}`);
    res.json({
      ok: true,
      dryRun,
      days,
      cutoff: cutoffIso,
      pages_scanned: pageCount,
      orders_scanned: scanned,
      new_candidates: candidates.length,
      imported,
      skipped_already_exists: scanned - candidates.length, // aproximado (ignorando filtro de cutoff)
      stopped_reason: stoppedReason,
      errors: errors.slice(0, 20),
      sample
    });
  } catch (err) {
    console.error('sync-wix-orders error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// Aceita tanto GET (Cloud Scheduler default) quanto POST
app.get('/sync-wix-orders', syncWixOrdersHandler);
app.post('/sync-wix-orders', syncWixOrdersHandler);


async function getToken() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  const d = await r.json();
  return d.access_token;
}
function toFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}
const PORT = process.env.PORT || 8080;
if (require.main === module) {
  app.listen(PORT, () => console.log('ok porta', PORT));
}

module.exports = {
  app,
  buildInvoiceTransaction,
  canonicalInvoiceStatus,
  normalizeDate,
  parseTotal,
  resolveInvoiceAmount,
  resolveInvoiceDates,
};
