const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');

const app = express();
const upload = multer();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gen-lang-client-0888019226';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const WEBHOOK_VERSION = '6.13-structured-payload-classification';
const JOTFORM_FORM_ID = process.env.JOTFORM_FORM_ID || '210020525580845';

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseJotformDate(val) {
  if (!val) return null;
  if (typeof val === 'object' && val.day) {
    const { day, month, year } = val;
    if (!day || !month || !year) return null;
    return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
  }
  return val;
}

function toBrDate(str) {
  if (!str) return '';
  if (typeof str === 'object' && str.day && str.month && str.year) {
    return `${String(str.year)}-${String(str.month).padStart(2, '0')}-${String(str.day).padStart(2, '0')}`;
  }
  if (typeof str !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parts = str.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return str;
}

function parseValor(v) {
  if (!v) return 0;
  return parseFloat(String(v).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.')) || 0;
}

function normalizeDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function normalizeName(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(LTDA|EIRELI|ME|EPP|SA|S A)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesProbablyMatch(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  return min >= 10 && (a.includes(b) || b.includes(a));
}

function getDocumentId(row) {
  return row && row.document && row.document.name ? row.document.name.split('/').pop() : '';
}

function getDocumentFields(row) {
  return (row && row.document && row.document.fields) || {};
}

function hasSubmissionMarker(fields) {
  return !!(firestoreString(fields.submissionId) || firestoreString(fields.submissionID));
}

function isJotformCanonical(fields) {
  return firestoreString(fields.source) === 'jotform' || hasSubmissionMarker(fields);
}

function sortRowsForCanonicalUpdate(rows, context = {}) {
  const targetStatus = context.docPago === 'SIM' ? 'Pago' : 'Pendente';
  return [...(rows || [])].sort((a, b) => {
    const af = getDocumentFields(a);
    const bf = getDocumentFields(b);
    const aTarget = firestoreString(af.status) === targetStatus;
    const bTarget = firestoreString(bf.status) === targetStatus;
    if (aTarget !== bTarget) return aTarget ? -1 : 1;

    const aCanonical = isJotformCanonical(af);
    const bCanonical = isJotformCanonical(bf);
    if (aCanonical !== bCanonical) return aCanonical ? -1 : 1;

    return (a.document.createTime || '').localeCompare(b.document.createTime || '');
  });
}

function firestoreNumber(field) {
  if (!field) return NaN;
  if (field.doubleValue != null) return Number(field.doubleValue);
  if (field.integerValue != null) return Number(field.integerValue);
  if (field.stringValue != null) return parseValor(field.stringValue);
  return NaN;
}

function firestoreString(field) {
  if (!field) return '';
  if (field.stringValue != null) return String(field.stringValue);
  if (field.integerValue != null) return String(field.integerValue);
  if (field.doubleValue != null) return String(field.doubleValue);
  if (field.booleanValue != null) return String(field.booleanValue);
  return '';
}

function firestoreBoolean(field) {
  if (!field) return false;
  if (field.booleanValue != null) return Boolean(field.booleanValue);
  if (field.stringValue != null) return String(field.stringValue).toLowerCase() === 'true';
  return false;
}

function sameMoney(a, b, tolerance = 0.01) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function getReceberTotal(cr) {
  const componentTotal = Number(cr.honorarios || 0) + Number(cr.extras || 0);
  return componentTotal > 0 ? componentTotal : Number(cr.valorNum || 0);
}

function matchesReceberAmount(fields, fallback) {
  const targets = [fallback.totalCobranca, fallback.valueReceived, fallback.honorarios]
    .map(Number)
    .filter(v => Number.isFinite(v) && v > 0);
  if (targets.length === 0) return true;

  const candidates = ['totalCobranca', 'valorOriginal', 'valueReceived', 'honorarios', 'valorExtra', 'extras']
    .map(field => firestoreNumber(fields[field]))
    .filter(v => Number.isFinite(v));

  return candidates.some(candidate => targets.some(target => sameMoney(candidate, target)));
}

function matchesReceberIdentity(fields, fallback) {
  if (fields.isExcluded && fields.isExcluded.booleanValue === true) return false;

  const existingSubmission = firestoreString(fields.submissionId) || firestoreString(fields.submissionID);
  const targetSubmission = String(fallback.submissionId || '');
  if (existingSubmission && targetSubmission) {
    if (existingSubmission !== targetSubmission) return false;
    return matchesReceberAmount(fields, fallback);
  }
  if (existingSubmission && !targetSubmission) return false;

  let identityMatched = false;

  const existingCnpj = normalizeDigits(firestoreString(fields.cpfCnpj));
  const targetCnpj = normalizeDigits(fallback.cpfCnpj);
  if (existingCnpj && targetCnpj) {
    if (existingCnpj !== targetCnpj) return false;
    identityMatched = true;
  }

  const existingClientNumber = normalizeDigits(firestoreString(fields.clientNumber) || firestoreString(fields.nCliente)).replace(/^0+/, '');
  const targetClientNumber = normalizeDigits(fallback.clientNumber).replace(/^0+/, '');
  if (existingClientNumber && targetClientNumber) {
    if (existingClientNumber !== targetClientNumber) return false;
    identityMatched = true;
  }

  const existingClient = firestoreString(fields.client) || firestoreString(fields.description);
  if (namesProbablyMatch(existingClient, fallback.client)) identityMatched = true;

  return identityMatched && matchesReceberAmount(fields, fallback);
}

// ── Dynamic field scanner (para IDs desconhecidos) ────────────────────────────
// Varre o raw do JotForm procurando por padrões no nome do campo

function findRawField(raw, ...patterns) {
  for (const key of Object.keys(raw)) {
    const lower = key.toLowerCase();
    if (patterns.some(p => lower.includes(p.toLowerCase()))) {
      const val = raw[key];
      if (val !== null && val !== undefined && val !== '') return val;
    }
  }
  return null;
}

function findRawDate(raw, ...patterns) {
  const value = findRawField(raw, ...patterns);
  return parseJotformDate(value);
}

function payloadText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(payloadText).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${key} ${payloadText(nestedValue)}`)
      .join(' ');
  }
  return String(value);
}

function isContasReceberPayload(raw) {
  const tipo = payloadText(raw?.q4_tipoDe).toUpperCase();
  if (tipo.includes('CONTAS A PAGAR')) return false;
  if (tipo.includes('CONTAS A RECEBER')) return true;
  return Boolean(raw?.q169_nomeEmpresa) || Boolean(raw?.q262_dataVencimentoreceber?.day);
}

function pickPositiveMoney(primary, fallback) {
  const primaryNum = parseValor(primary);
  const fallbackNum = parseValor(fallback);
  if (primary && primaryNum > 0) return primary;
  if (fallback && fallbackNum > 0) return fallback;
  return primary || fallback || '';
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function getFirestoreToken() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = await (await auth.getClient()).getAccessToken();
  return token.token;
}

async function firestoreSet(docId, fields) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}/transactions/${docId}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) throw new Error(`Firestore SET falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore SET: ${docId}`);
  return docId;
}

async function firestorePatch(docId, fields) {
  const token = await getFirestoreToken();
  const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const url = `${FIRESTORE_BASE}/transactions/${docId}?${mask}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) throw new Error(`Firestore PATCH falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore PATCH: ${docId}`);
  return docId;
}

async function firestoreSetInCollection(collectionId, docId, fields) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}/${collectionId}/${docId}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) throw new Error(`Firestore SET ${collectionId} falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore SET ${collectionId}: ${docId}`);
  return docId;
}

function safeEventIdPart(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 64) || 'sem-submission';
}

function eventDocIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(',');
  return value ? String(value) : '';
}

async function recordJotformEvent(event) {
  try {
    const now = new Date().toISOString();
    const submissionPart = safeEventIdPart(event.submissionId);
    const eventId = `jfe-${Date.now()}-${submissionPart}`;
    const fields = toFields({
      receivedAt: now,
      updatedAt: now,
      version: WEBHOOK_VERSION,
      projectId: PROJECT_ID,
      submissionId: event.submissionId || '',
      form: event.form || '',
      action: event.action || '',
      status: event.status || '',
      docId: event.docId || '',
      docIds: eventDocIds(event.docIds),
      duplicateDocIds: eventDocIds(event.duplicateDocIds),
      movimentacao: event.movimentacao || '',
      dueDate: event.dueDate || '',
      amount: Number.isFinite(Number(event.amount)) ? Number(event.amount) : 0,
      docPago: event.docPago || '',
      reason: event.reason || '',
      error: event.error || '',
      rawKeyCount: Number(event.rawKeyCount || 0),
      rawKeys: event.rawKeys || '',
    });
    await firestoreSetInCollection('jotformEvents', eventId, fields);
  } catch (error) {
    console.error('jotformEvents log falhou:', error.message);
  }
}

async function queryFirestore(filters, limit = 100) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}:runQuery`;
  const toQueryValue = (value) => {
    if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
    if (typeof value === 'number') return { doubleValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    return { stringValue: String(value) };
  };
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'transactions' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: filters.map(([field, value]) => ({
            fieldFilter: {
              field: { fieldPath: field },
              op: 'EQUAL',
              value: toQueryValue(value)
            }
          }))
        }
      },
      limit
    }
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return data.filter(d => d.document);
}

function uniqueFirestoreRows(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows || []) {
    const id = getDocumentId(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(row);
  }
  return unique;
}

async function queryReceberCandidateDocs(fallback, statuses = ['Pendente']) {
  if (!fallback || fallback.kind !== 'receber' || !fallback.dueDate) return [];

  const searches = [];
  const addSearch = (filters) => {
    const key = JSON.stringify(filters);
    if (!searches.some(item => item.key === key)) searches.push({ key, filters });
  };

  for (const status of statuses) {
    const rawClientNumber = String(fallback.clientNumber || '').trim();
    const clientNumberDigits = normalizeDigits(rawClientNumber).replace(/^0+/, '');
    const clientNumberValues = [];
    if (rawClientNumber) clientNumberValues.push(rawClientNumber);
    if (clientNumberDigits) {
      clientNumberValues.push(clientNumberDigits);
      const numericClientNumber = Number(clientNumberDigits);
      if (Number.isFinite(numericClientNumber)) clientNumberValues.push(numericClientNumber);
    }

    if (fallback.client) {
      addSearch([
        ['client', fallback.client],
        ['dueDate', fallback.dueDate],
        ['movement', 'Entrada'],
        ['status', status],
      ]);
    }
    for (const value of [...new Set(clientNumberValues)]) {
      addSearch([
        ['clientNumber', value],
        ['dueDate', fallback.dueDate],
        ['movement', 'Entrada'],
        ['status', status],
      ]);
      addSearch([
        ['nCliente', value],
        ['dueDate', fallback.dueDate],
        ['movement', 'Entrada'],
        ['status', status],
      ]);
    }
    if (fallback.cpfCnpj) {
      addSearch([
        ['cpfCnpj', fallback.cpfCnpj],
        ['dueDate', fallback.dueDate],
        ['movement', 'Entrada'],
        ['status', status],
      ]);
    }
    addSearch([
      ['dueDate', fallback.dueDate],
      ['movement', 'Entrada'],
      ['status', status],
    ]);
  }

  const rows = [];
  for (const search of searches) {
    const found = await queryFirestore(search.filters, 100);
    rows.push(...found);
  }

  return uniqueFirestoreRows(rows)
    .filter(d => {
      const fields = (d.document && d.document.fields) || {};
      return !firestoreBoolean(fields.isExcluded) && matchesReceberIdentity(fields, fallback);
    });
}

async function cleanupReceberLegacyDuplicates(cr, submissionId, primaryDocId) {
  if (!cr || !cr.dueDateISO || !cr.nomeEmpresa) {
    console.log('v6.9 RECEBER limpeza de duplicados ignorada: dados insuficientes');
    return;
  }

  const fallback = {
    kind: 'receber',
    client: cr.nomeEmpresa,
    clientNumber: cr.nCliente,
    cpfCnpj: cr.cnpj,
    dueDate: cr.dueDateISO,
    valueReceived: cr.valorNum,
    totalCobranca: getReceberTotal(cr),
    honorarios: cr.honorarios,
    submissionId: '',
  };
  const candidates = await queryReceberCandidateDocs(fallback, ['Pendente', 'Pago']);
  let cleaned = 0;
  let skipped = 0;
  const currentSubmissionId = String(submissionId || '');
  const isCurrentPaid = cr.docPago === 'SIM';
  for (const candidate of candidates) {
    const fields = getDocumentFields(candidate);
    const candidateId = getDocumentId(candidate);
    if (!candidateId || candidateId === primaryDocId) continue;
    if (firestoreBoolean(fields.isExcluded)) continue;

    const candidateSubmissionId = firestoreString(fields.submissionId) || firestoreString(fields.submissionID);
    const candidateStatus = firestoreString(fields.status);
    const candidateSource = firestoreString(fields.source);
    let shouldHide = false;
    let reason = `webhook-v6.9-receber-duplicate-of-${submissionId || primaryDocId}`;

    if (candidateSubmissionId && candidateSubmissionId === currentSubmissionId) {
      shouldHide = true;
      reason = `webhook-v6.9-receber-same-submission-duplicate-${currentSubmissionId}`;
    } else if (!candidateSubmissionId && candidateStatus === 'Pendente' && isCurrentPaid) {
      shouldHide = true;
      reason = candidateSource
        ? `webhook-v6.9-receber-source-without-submission-duplicate-of-${submissionId || primaryDocId}`
        : `webhook-v6.9-receber-legacy-orphan-duplicate-of-${submissionId || primaryDocId}`;
    } else if (!candidateSubmissionId && !candidateSource) {
      shouldHide = true;
      reason = `webhook-v6.9-receber-legacy-orphan-duplicate-of-${submissionId || primaryDocId}`;
    } else if (candidateSubmissionId && candidateSubmissionId !== currentSubmissionId && isCurrentPaid && candidateStatus === 'Pendente') {
      const rawCandidate = await fetchJotformSubmissionRaw(candidateSubmissionId);
      if (!rawCandidate) {
        skipped++;
        continue;
      }
      const candidateCr = extractContasReceber(rawCandidate);
      const sameIdentity =
        candidateCr.dueDateISO === cr.dueDateISO &&
        sameMoney(getReceberTotal(candidateCr), getReceberTotal(cr)) &&
        (
          (candidateCr.cnpj && cr.cnpj && normalizeDigits(candidateCr.cnpj) === normalizeDigits(cr.cnpj)) ||
          (candidateCr.nCliente && cr.nCliente && normalizeDigits(candidateCr.nCliente).replace(/^0+/, '') === normalizeDigits(cr.nCliente).replace(/^0+/, '')) ||
          namesProbablyMatch(candidateCr.nomeEmpresa, cr.nomeEmpresa)
        );
      const staleInJotform = !sameIdentity || candidateCr.docPago === 'SIM';
      if (!staleInJotform) {
        skipped++;
        continue;
      }
      shouldHide = true;
      reason = `webhook-v6.9-receber-stale-jotform-${candidateSubmissionId}-duplicate-of-${submissionId || primaryDocId}`;
    }

    if (!shouldHide) {
      skipped++;
      continue;
    }

    await firestorePatch(candidateId, buildLogicalExcludeFields(reason, 'jotform-webhook-v6.9'));
    cleaned++;
    console.log(`v6.9 RECEBER duplicado/stale ocultado: ${candidateId} (${reason})`);
  }
  if (cleaned === 0) console.log(`v6.9 RECEBER nenhum duplicado ativo encontrado (${skipped} preservado(s))`);
  else console.log(`v6.9 RECEBER resumo: ${cleaned} duplicado(s) ocultado(s), ${skipped} preservado(s)`);
}

function buildLogicalExcludeFields(reason, source = 'jotform-webhook-v6.9') {
  return toFields({
    isExcluded: true,
    exclusionReason: reason,
    exclusionSource: source,
    excludedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function shouldRestoreDataQualityExclusion(row) {
  const fields = getDocumentFields(row);
  if (!firestoreBoolean(fields.isExcluded)) return false;

  const reason = firestoreString(fields.exclusionReason);
  return reason.startsWith('data-quality:');
}

function mergeRestoreDataQualityFields(updateFields, row, source = 'jotform-webhook-v6.10') {
  if (!shouldRestoreDataQualityExclusion(row)) return updateFields;

  const restoredAt = new Date().toISOString();
  const restoredFields = toFields({
    isExcluded: false,
    exclusionReason: '',
    restorationReason: `${source}:valid-jotform-update`,
    restoredAt,
    updatedAt: restoredAt,
  });

  console.log(`v6.10 RESTORE: reativando doc ${getDocumentId(row)} ocultado por data-quality`);
  return {
    ...updateFields,
    ...restoredFields,
  };
}

function isEmptyContasPagar(cp) {
  return !cp ||
    !cp.movimentacao ||
    !cp.dueDateISO ||
    !Number.isFinite(Number(cp.valorNum)) ||
    Number(cp.valorNum) <= 0;
}

async function fetchJotformSubmissionRaw(submissionId) {
  const apiKey = process.env.JOTFORM_API_KEY;
  if (!apiKey || !submissionId) return null;

  const url = `https://api.jotform.com/submission/${encodeURIComponent(submissionId)}?apiKey=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url);
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok || (payload.responseCode && payload.responseCode !== 200)) {
    console.log(`v6.6 PAGAR: nao consegui consultar Jotform sub=${submissionId} status=${payload.responseCode || resp.status}`);
    return null;
  }

  const answers = payload.content && payload.content.answers ? payload.content.answers : {};
  const raw = { submissionID: String(submissionId) };
  for (const [qid, answer] of Object.entries(answers)) {
    if (!answer || !answer.name) continue;
    raw[`q${qid}_${answer.name}`] = answer.answer;
  }
  return raw;
}

async function cleanupPagarStaleDuplicates(cp, submissionId, primaryDocId) {
  if (!cp || cp.docPago !== 'SIM' || isEmptyContasPagar(cp)) {
    console.log('v6.6 PAGAR limpeza de duplicados ignorada: baixa nao paga ou dados insuficientes');
    return;
  }

  const candidates = await queryFirestore([
    ['description', cp.movimentacao],
    ['dueDate', cp.dueDateISO],
    ['movement', 'Saída'],
  ], 100);

  let hidden = 0;
  let skipped = 0;
  for (const candidate of candidates || []) {
    const fields = (candidate.document && candidate.document.fields) || {};
    const candidateId = getDocumentId(candidate);
    if (!candidateId || candidateId === primaryDocId) continue;
    if (firestoreBoolean(fields.isExcluded)) continue;
    if (firestoreString(fields.status) !== 'Pendente') continue;
    if (!sameMoney(firestoreNumber(fields.valuePaid), cp.valorNum)) {
      skipped++;
      continue;
    }

    const candidateSubmissionId = firestoreString(fields.submissionId) || firestoreString(fields.submissionID);
    const candidateSource = firestoreString(fields.source);
    let shouldHide = false;
    let reason = `webhook-v6.6-pagar-duplicate-of-submission-${submissionId || primaryDocId}`;

    if (candidateSubmissionId && candidateSubmissionId !== String(submissionId || '')) {
      const rawCandidate = await fetchJotformSubmissionRaw(candidateSubmissionId);
      if (!rawCandidate) {
        skipped++;
        continue;
      }
      const candidateCp = extractContasPagar(rawCandidate);
      const staleInJotform = isEmptyContasPagar(candidateCp) ||
        candidateCp.movimentacao !== cp.movimentacao ||
        candidateCp.dueDateISO !== cp.dueDateISO ||
        !sameMoney(candidateCp.valorNum, cp.valorNum);
      if (!staleInJotform) {
        skipped++;
        continue;
      }
      shouldHide = true;
      reason = `webhook-v6.6-pagar-stale-jotform-${candidateSubmissionId}-duplicate-of-${submissionId || primaryDocId}`;
    } else if (!candidateSubmissionId) {
      shouldHide = true;
      reason = candidateSource
        ? `webhook-v6.9-pagar-source-without-submission-duplicate-of-${submissionId || primaryDocId}`
        : `webhook-v6.9-pagar-legacy-orphan-duplicate-of-${submissionId || primaryDocId}`;
    }

    if (!shouldHide) {
      skipped++;
      continue;
    }

    await firestorePatch(candidateId, buildLogicalExcludeFields(reason, 'jotform-webhook-v6.9'));
    hidden++;
    console.log(`v6.6 PAGAR duplicado/stale ocultado: ${candidateId} (${reason})`);
  }

  if (hidden === 0) console.log(`v6.6 PAGAR nenhum duplicado stale ativo encontrado (${skipped} preservado(s))`);
  else console.log(`v6.6 PAGAR resumo: ${hidden} ocultado(s), ${skipped} preservado(s)`);
}

async function firestoreDelete(docId) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}/${docId}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 404) {
    const txt = await resp.text();
    throw new Error(`Delete falhou (${resp.status}): ${txt}`);
  }
  console.log(`Firestore DELETE: ${docId}`);
  return true;
}

// ── NOVO: busca por submissionId ──────────────────────────────────────────────

async function queryExactBySubmissionId(submissionId) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}:runQuery`;

  for (const fieldName of ['submissionId', 'submissionID']) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'transactions' }],
        where: { fieldFilter: {
          field: { fieldPath: fieldName },
          op: 'EQUAL',
          value: { stringValue: String(submissionId) }
        }},
        limit: 10
      }
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    const found = (data || []).filter(d => d.document);
    if (found.length > 0) {
      console.log(`Match por ${fieldName}=${submissionId} → ${found.length} doc(s)`);
      return found;
    }
  }

  return null;
}

async function queryBySubmissionId(submissionId, fallback) {
  const exact = await queryExactBySubmissionId(submissionId);
  if (exact && exact.length > 0) return exact;

  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}:runQuery`;

  // 2) Fallback Receber v6.5: upsert seguro por identidade + vencimento + valor.
  // Quando o Jotform manda uma edição/baixa de uma submission antiga que ainda
  // não tinha submissionId no Firestore, atualiza o pendente legado em vez de
  // criar outro lançamento visível.
  if (fallback && fallback.kind === 'receber') {
    if (!fallback.dueDate) {
      console.log(`Fallback Receber v6.5 NAO APLICADO - falta vencimento`);
    } else {
      const statuses = fallback.docPago === 'SIM' ? ['Pendente', 'Pago'] : ['Pendente'];
      console.log(`Fallback Receber v6.5: cliente='${fallback.client}' cnpj='${fallback.cpfCnpj}' nCliente='${fallback.clientNumber}' venc=${fallback.dueDate} total=${fallback.totalCobranca} recebido=${fallback.valueReceived} statuses=${statuses.join('|')}`);
      const identityMatches = await queryReceberCandidateDocs(fallback, statuses);
      if (identityMatches.length === 1) {
        console.log(`Fallback Receber v6.5 match UNICO → doc ${getDocumentId(identityMatches[0])}`);
        return identityMatches;
      }
      if (identityMatches.length > 1) {
        console.log(`Fallback Receber v6.9 AMBIGUO: ${identityMatches.length} matches — atualizara canônico e ocultara duplicados`);
        return identityMatches;
      }
      console.log(`Fallback Receber v6.5: sem match - criara novo doc`);
    }
  }

  // 3) Fallback Pagar: (description + dueDate + valuePaid)
  if (fallback && fallback.kind === 'pagar' && fallback.description && fallback.dueDate && fallback.valuePaid != null) {
    console.log(`Fallback Pagar: desc='${fallback.description}' venc=${fallback.dueDate} valor=${fallback.valuePaid}`);
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'transactions' }],
        where: { compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'description' }, op: 'EQUAL', value: { stringValue: String(fallback.description) } } },
            { fieldFilter: { field: { fieldPath: 'dueDate' }, op: 'EQUAL', value: { stringValue: String(fallback.dueDate) } } }
          ]
        }},
        limit: 50
      }
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    const all = (data || []).filter(d => d.document);
    // Filtragem client-side por valuePaid (evita índice composto)
    const target = Number(fallback.valuePaid);
    const matches = all.filter(d => {
      const fields = d.document.fields || {};
      if (firestoreBoolean(fields.isExcluded)) return false;
      // v5.7: NUNCA sobrescrever docs ja Pagos — so atualiza Pendentes
      const st = fields.status && fields.status.stringValue;
      if (st !== 'Pendente') return false;
      // v5.7: rejeitar docs com _dedupe=true (orfaos ja tratados)
      const ded = fields._dedupe && fields._dedupe.booleanValue;
      if (ded === true) return false;
      const vp = fields.valuePaid;
      if (!vp) return false;
      const v = vp.doubleValue != null ? Number(vp.doubleValue)
              : vp.integerValue != null ? Number(vp.integerValue)
              : vp.stringValue != null ? Number(String(vp.stringValue).replace(',', '.'))
              : NaN;
      return Number.isFinite(v) && Math.abs(v - target) < 0.005;
    });
    // v6.9: match estrito multiplo ainda e a mesma identidade financeira; atualiza um canônico e oculta o resto.
    if (matches.length === 1) { console.log(`Fallback Pagar match UNICO → doc ${matches[0].document.name.split('/').pop()}`); return matches; }
    if (matches.length > 1) { console.log(`Fallback Pagar v6.9 AMBIGUO ESTRITO: ${matches.length} matches — atualizara canônico e ocultara duplicados`); return matches; }

    console.log('Fallback Pagar estrito: sem match por valor - criara novo doc deterministico');
  }

  return null;
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}

// v5.3: gera trx-N sequencial via counter atomico em meta/lastTrxN
async function generateDocId(submissionId) {
  if (submissionId) {
    const safeSubmissionId = String(submissionId).replace(/[^A-Za-z0-9_-]/g, '');
    if (safeSubmissionId) {
      const deterministicId = `trx-jf-${safeSubmissionId}`;
      console.log(`generateDocId deterministic by submissionId: ${deterministicId}`);
      return deterministicId;
    }
  }

  const token = await getFirestoreToken();
  const counterUrl = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents:commit';
  const docPath = 'projects/' + PROJECT_ID + '/databases/(default)/documents/meta/lastTrxN';
  const body = {
    writes: [{
      transform: {
        document: docPath,
        fieldTransforms: [{ fieldPath: 'value', increment: { integerValue: '1' } }]
      }
    }]
  };
  try {
    const resp = await fetch(counterUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.writeResults && data.writeResults[0] && data.writeResults[0].transformResults) {
      const newVal = data.writeResults[0].transformResults[0].integerValue;
      const id = 'trx-' + newVal;
      console.log('generateDocId: ' + id);
      return id;
    }
    console.log('generateDocId: counter response unexpected, fallback. resp=' + JSON.stringify(data).slice(0,200));
  } catch (e) {
    console.log('generateDocId: counter ERR ' + e.message + ', fallback');
  }
  const fallback = 'trx-jf-' + Date.now();
  console.log('generateDocId FALLBACK: ' + fallback);
  return fallback;
}

// ── Extrai todos os campos relevantes do raw JotForm ─────────────────────────
// Centraliza o parsing para reutilizar no UPDATE e no CREATE

function extractContasReceber(raw) {
  const nomeEmpresaRaw = raw.q169_nomeEmpresa || findRawField(raw, 'nomeempresa', 'nome_empresa', 'empresa_credor', 'credor');
  const docPagoRaw     = raw.q314_docpago314  || findRawField(raw, 'docpago', 'doc_pago');
  const nomeEmpresa  = (nomeEmpresaRaw || '').toString().trim();
  const docPago      = (docPagoRaw  || '').toString().toUpperCase().trim();
  const valorRecebido = raw.q252_valorRecebido || raw.q279_totalCobranca279 ||
    findRawField(raw, 'valorrecebido', 'valor_recebido', 'totalcobranca', 'total_cobranca') || '';
  const dataLanc     = parseJotformDate(raw.q6_dataLancamento6) ||
    findRawDate(raw, 'datalancamento', 'data_lancamento', 'lancamentoareceber');
  const dataVenc     = parseJotformDate(raw.q262_dataVencimentoreceber) ||
    findRawDate(raw, 'datavencimento', 'data_vencimento', 'vencimentoreceber', 'vencimento');
  const dataReceb    = parseJotformDate(raw.q263_dataRecebimento) ||
    findRawDate(raw, 'datarecebimento', 'data_recebimento', 'databaixa', 'data_baixa');

  // Dynamic scan para campos sem ID fixo conhecido
  const honorariosRaw = findRawField(raw, 'honorar', 'honora');
  const extrasRaw     = findRawField(raw, 'valorextra', 'extras', 'valorExtra');
  const nClienteRaw   = findRawField(raw, 'ncliente', 'nclient', 'codigoempresa', 'codigocliente', 'clientenum');
  const cnpjRaw       = findRawField(raw, 'cnpj', 'cpfcnpj', 'cpf_cnpj', 'cpf');
  const metodoRaw     = findRawField(raw, 'metodopag', 'metodoenv', 'recebivelmetodo', 'recebivel');
  const obsRaw        = findRawField(raw, 'observac', 'obs_');
  const cobrancaExtra = findRawField(raw, 'cobrancaextra', 'cobextra', 'cobrancas');

  console.log('[CR] Dynamic scan:', {
    honorariosRaw, extrasRaw, nClienteRaw, cnpjRaw, metodoRaw
  });

  return {
    nomeEmpresa,
    docPago,
    valorRecebido,
    dataLanc,
    dataVenc,
    dataReceb,
    honorarios: parseValor(honorariosRaw),
    extras:     parseValor(extrasRaw),
    nCliente:   nClienteRaw ? (parseInt(String(nClienteRaw).trim().replace(/\D/g,''),10) || String(nClienteRaw).trim()) : '',
    cnpj:       cnpjRaw     ? String(cnpjRaw).trim()    : '',
    metodo:     metodoRaw   ? String(metodoRaw).trim()  : '',
    obs:        obsRaw      ? String(obsRaw).trim()     : '',
    cobrancaExtra: cobrancaExtra ? String(cobrancaExtra).trim() : '',
    valorNum:   parseValor(valorRecebido),
    dataLancISO: toBrDate(dataLanc),
    dueDateISO: toBrDate(dataVenc),
    dataPgto:   dataReceb || dataVenc || new Date().toLocaleDateString('pt-BR'),
  };
}

function extractContasPagar(raw) {
  const movimentacao = (raw.q44_movimentacao44 || '').toString().trim();
  const docPago      = (raw.q291_docpago       || '').toString().toUpperCase().trim();
  const valorRef     = pickPositiveMoney(raw.q56_valorRefvalor56, raw.q57_valorPago);
  const dataLanc     = parseJotformDate(raw.q15_dataLancamento || raw.q167_dataLancamento167);
  const dataAPagar   = parseJotformDate(raw.q313_dataA);
  const dataBaixa    = parseJotformDate(raw.q129_dataBaixa);
  const identificacaoUnica = raw.q284_identificacaoUnica || '';
  const identificacaoUnicaAlt = raw.q285_identificacaoUnica285 || '';

  const obsRaw    = findRawField(raw, 'observac', 'obs_');
  const metodoRaw = findRawField(raw, 'metodopag', 'metodoenv');

  return {
    movimentacao,
    docPago,
    valorRef,
    dataLanc,
    dataAPagar,
    dataBaixa,
    obs:       obsRaw    ? String(obsRaw).trim()    : '',
    metodo:    metodoRaw ? String(metodoRaw).trim() : '',
    valorNum:  parseValor(valorRef),
    dataLancISO: toBrDate(dataLanc),
    dueDateISO: toBrDate(dataAPagar),
    dataPgto:  dataBaixa || dataAPagar || new Date().toLocaleDateString('pt-BR'),
    identificacaoUnica: identificacaoUnica ? String(identificacaoUnica).trim() : '',
    identificacaoUnicaAlt: identificacaoUnicaAlt ? String(identificacaoUnicaAlt).trim() : '',
  };
}

// ── Monta fields completos para UPDATE no Firestore ───────────────────────────

function buildContasReceberFields(cr, submissionId) {
  const isPago = cr.docPago === 'SIM';
  const totalCobranca = getReceberTotal(cr);
  const obj = {
    source:        'jotform',
    movement:      'Entrada',
    type:          'Entrada de Caixa / Contas a Receber',
    status:        isPago ? 'Pago' : 'Pendente',
    pago:          isPago ? 'Pago' : 'Não',
    client:        cr.nomeEmpresa,
    description:   cr.nomeEmpresa,
    dueDate:       cr.dueDateISO,
    date:          cr.dataLancISO || cr.dueDateISO,
    paymentDate:   isPago ? toBrDate(cr.dataPgto) : '',
    dataPagamento: isPago ? cr.dataPgto : '',
    valorOriginal: totalCobranca,
    totalCobranca: totalCobranca,
    valuePaid:     0,
    valueReceived: isPago ? cr.valorNum : 0,
    valorPago:     isPago ? String(cr.valorRecebido || '') : '',
    updatedAt:     new Date().toISOString(),
  };

  // Campos extras — só grava se tiver valor
  if (cr.honorarios > 0)  obj.honorarios  = cr.honorarios;
  obj.valorExtra = cr.extras || 0;
  obj.extras = cr.extras || 0;
  if (cr.nCliente)        obj.clientNumber = cr.nCliente;
  if (cr.nCliente)        obj.nCliente     = cr.nCliente;
  if (cr.cnpj)            obj.cpfCnpj      = cr.cnpj;
  if (cr.metodo)          obj.metodoPagamento = cr.metodo;
  if (cr.obs)             obj.observacao   = cr.obs;
  if (cr.cobrancaExtra)   obj.cobrancaExtra = cr.cobrancaExtra;
  if (submissionId)       obj.submissionId  = String(submissionId);

  return toFields(obj);
}

function buildContasPagarFields(cp, submissionId) {
  const isPago = cp.docPago === 'SIM';
  const obj = {
    source:        'jotform',
    movement:      'Saída',
    type:          'Saída de Caixa / Contas a Pagar',
    status:        isPago ? 'Pago' : 'Pendente',
    pago:          isPago ? 'Pago' : 'Não',
    description:   cp.movimentacao,
    client:        cp.movimentacao,
    dueDate:       cp.dueDateISO,
    date:          cp.dataLancISO || cp.dueDateISO,
    paymentDate:   isPago ? toBrDate(cp.dataPgto) : '',
    dataPagamento: isPago ? cp.dataPgto : '',
    valorOriginal: cp.valorNum,
    valuePaid:     cp.valorNum,
    valueReceived: 0,
    valorPago:     isPago ? String(cp.valorRef || '') : '',
    updatedAt:     new Date().toISOString(),
  };

  if (cp.obs)    obj.observacaoAPagar = cp.obs;
  if (cp.metodo) obj.metodoPagamento = cp.metodo;
  if (cp.identificacaoUnica) obj.identificacaoUnica = cp.identificacaoUnica;
  if (cp.identificacaoUnicaAlt) obj.identificacaoUnicaAlt = cp.identificacaoUnicaAlt;
  if (submissionId) obj.submissionId = String(submissionId);

  return toFields(obj);
}

// ── Main webhook ──────────────────────────────────────────────────────────────

app.post('/', upload.any(), async (req, res) => {
  let eventContext = {
    form: '',
    submissionId: '',
    rawKeyCount: 0,
    rawKeys: '',
  };
  try {
    const topBody = req.body || {};
    let raw = {};
    if (topBody.rawRequest) {
      try { raw = JSON.parse(topBody.rawRequest); } catch(e) { raw = {}; }
    }

    // LOG COMPLETO — identifica IDs de campos desconhecidos nos logs do Cloud Run
    const rawKeys = Object.keys(raw);
    console.log('=== RAW PAYLOAD KEYS ===', rawKeys.join(', '));
    console.log('=== RAW PAYLOAD ===', JSON.stringify(raw, null, 2));

    const submissionId = raw.submissionID || topBody.submissionID ||
                         raw.submission_id || topBody.submission_id || null;

    const isContasReceber = isContasReceberPayload(raw);

    console.log('Formulário:', isContasReceber ? 'Contas a Receber' : 'Contas a Pagar');
    console.log('submissionId:', submissionId);
    eventContext = {
      form: isContasReceber ? 'contas_receber' : 'contas_pagar',
      submissionId: submissionId || '',
      rawKeyCount: rawKeys.length,
      rawKeys: rawKeys.slice(0, 120).join(', '),
    };

    // ══════════════════════════════════════════════════════════════════════════
    // CAMINHO 1: EDIÇÃO — submissionId já existe no Firestore → UPDATE completo
    // ══════════════════════════════════════════════════════════════════════════
    if (submissionId) {
      // v5.2: fallback DESABILITADO para Contas a Pagar (causou sobrescrita de docs alheios
      // porque clientNumber em Pagar = categoria de movimentação, não cliente único).
      // Receber mantém fallback porque q169_nomeEmpresa tem cardinalidade alta.
      let fallbackLookup;
      if (isContasReceber) {
        const cr = extractContasReceber(raw);
        fallbackLookup = {
          kind: 'receber',
          client: cr.nomeEmpresa,
          clientNumber: cr.nCliente,
          cpfCnpj: cr.cnpj,
          dueDate: cr.dueDateISO,
          valueReceived: cr.valorNum,
          totalCobranca: getReceberTotal(cr),
          honorarios: cr.honorarios,
          submissionId,
          docPago: cr.docPago,
        };
      }
      // Um novo Pagar pendente sempre vira um documento deterministico pelo
      // submissionId. O fallback financeiro so e permitido em baixas, quando
      // uma submission antiga ainda nao tinha submissionId no Firestore.
      if (!isContasReceber) {
        const cp = extractContasPagar(raw);
        if (cp.docPago === 'SIM') {
          fallbackLookup = {
            kind: 'pagar',
            description: cp.movimentacao,
            dueDate: cp.dueDateISO,
            valuePaid: cp.valorNum,
            docPago: cp.docPago,
          };
        }
      }
      const existingArr = await queryBySubmissionId(submissionId, fallbackLookup);

      if (existingArr && existingArr.length > 0) {
        const orderedExistingArr = sortRowsForCanonicalUpdate(existingArr, fallbackLookup || {});
        const primary = orderedExistingArr[0];
        const duplicates = orderedExistingArr.slice(1);
        const docId = primary.document.name.split('/').pop();
        if (duplicates.length > 0) {
          console.log(`DUPLICATAS detectadas (${duplicates.length}) para submissionId ${submissionId} — mantendo ${docId}, ocultando: ${duplicates.map(d=>d.document.name.split('/').pop()).join(', ')}`);
          for (const dup of duplicates) {
            const dupId = dup.document.name.split('/').pop();
            try {
              await firestorePatch(dupId, buildLogicalExcludeFields(`webhook-v6.9-duplicate-of-${submissionId || docId}`, 'jotform-webhook-v6.9'));
            }
            catch (e) { console.error(`Falha ao ocultar duplicata ${dupId}:`, e.message); }
          }
        }
        console.log(`EDIÇÃO DETECTADA — submissionId ${submissionId} → doc ${docId}`);

        let updateFields;
        let parsedReceber = null;
        let parsedPagar = null;
        if (isContasReceber) {
          const cr = extractContasReceber(raw);
          parsedReceber = cr;
          console.log('[CR] Parsed:', cr);
          updateFields = buildContasReceberFields(cr, submissionId);
        } else {
          const cp = extractContasPagar(raw);
          parsedPagar = cp;
          console.log('[CP] Parsed:', cp);
          if (isEmptyContasPagar(cp)) {
            await firestorePatch(docId, buildLogicalExcludeFields(`webhook-v6.6-pagar-empty-or-zero-submission-${submissionId}`));
            console.log(`v6.6 PAGAR submission ${submissionId} sem vencimento/valor valido — doc ${docId} ocultado`);
            await recordJotformEvent({
              ...eventContext,
              action: 'entry_excluded',
              status: 'ok',
              docId,
              movimentacao: cp.movimentacao,
              dueDate: cp.dueDateISO,
              amount: cp.valorNum,
              docPago: cp.docPago,
              reason: 'pagar_empty_or_zero',
            });
            return res.status(200).json({
              status: 'entry_excluded',
              docId,
              submissionId,
              form: 'contas_pagar',
              reason: 'pagar_empty_or_zero'
            });
          }
          updateFields = buildContasPagarFields(cp, submissionId);
        }

        updateFields = mergeRestoreDataQualityFields(updateFields, primary);
        await firestorePatch(docId, updateFields);
        if (isContasReceber && parsedReceber) {
          await cleanupReceberLegacyDuplicates(parsedReceber, submissionId, docId);
        }
        if (!isContasReceber && parsedPagar) {
          await cleanupPagarStaleDuplicates(parsedPagar, submissionId, docId);
        }
        console.log(`UPDATE OK: ${docId} (submissionId: ${submissionId})`);

        // ──────────────────────────────────────────────────────────────────
        // v6.2: AUTO-LIMPEZA DE ÓRFÃOS LEGADOS — RESTRITIVA POR VALOR
        // Após PATCH (qualquer status), varre órfãos (sem submissionId E sem
        // source) com mesmo description+dueDate+movement="Saída" E mesmo
        // valuePaid (±0,01). Só roda em Contas a Pagar.
        // Restrição por valor protege descrições genéricas que agregam
        // múltiplos lançamentos legítimos (Vale Transporte, Impostos, etc).
        // ──────────────────────────────────────────────────────────────────
        if (!isContasReceber) {
          try {
            const cpCheck = extractContasPagar(raw);
            if (cpCheck.movimentacao && cpCheck.dueDateISO && Number.isFinite(cpCheck.valorNum)) {
              const orfaos = await queryFirestore([
                ['description', cpCheck.movimentacao],
                ['dueDate',     cpCheck.dueDateISO],
                ['movement',    'Saída'],
              ]);
              let cleaned = 0; let skippedValue = 0;
	              for (const o of (orfaos || [])) {
	                const of = (o.document && o.document.fields) || {};
	                if (firestoreBoolean(of.isExcluded)) continue;
	                // Só deleta órfão LEGADO: SEM submissionId E SEM source
	                if (of.submissionId || of.source) continue;
                const orfaoId = o.document.name.split('/').pop();
                if (orfaoId === docId) continue;
                // Match por valor ±0,01
                const vp = of.valuePaid;
                let v = NaN;
                if (vp) {
                  v = vp.doubleValue != null ? Number(vp.doubleValue)
                    : vp.integerValue != null ? Number(vp.integerValue)
                    : vp.stringValue != null ? Number(String(vp.stringValue).replace(',', '.'))
                    : NaN;
                }
                if (!Number.isFinite(v) || Math.abs(v - cpCheck.valorNum) > 0.01) {
                  skippedValue++;
                  console.log(`v6.2 SKIP por valor: órfão ${orfaoId} vp=${v} != ${cpCheck.valorNum}`);
                  continue;
	                }
	                try {
	                  await firestorePatch(orfaoId, buildLogicalExcludeFields(`webhook-v6.9-pagar-legacy-orphan-duplicate-of-${submissionId || docId}`, 'jotform-webhook-v6.9'));
	                  cleaned++;
	                  console.log(`v6.6 ÓRFÃO OCULTADO: ${orfaoId} (par de ${docId}, valor ${cpCheck.valorNum})`);
	                } catch (e) {
	                  console.error(`v6.6 falha ao ocultar órfão ${orfaoId}: ${e.message}`);
	                }
              }
              if (cleaned === 0 && skippedValue === 0) console.log('v6.2 nenhum órfão encontrado (ok)');
              else console.log(`v6.2 resumo: ${cleaned} limpos, ${skippedValue} preservados por valor diferente`);
            }
          } catch (e) {
            console.error(`v6.2 erro na varredura de órfãos: ${e.message}`);
          }
        }

        await recordJotformEvent({
          ...eventContext,
          action: 'entry_updated',
          status: 'ok',
          docId,
          duplicateDocIds: duplicates.map(d => d.document.name.split('/').pop()),
          movimentacao: isContasReceber ? (parsedReceber && parsedReceber.nomeEmpresa) : (parsedPagar && parsedPagar.movimentacao),
          dueDate: isContasReceber ? (parsedReceber && parsedReceber.dueDateISO) : (parsedPagar && parsedPagar.dueDateISO),
          amount: isContasReceber ? (parsedReceber && getReceberTotal(parsedReceber)) : (parsedPagar && parsedPagar.valorNum),
          docPago: isContasReceber ? (parsedReceber && parsedReceber.docPago) : (parsedPagar && parsedPagar.docPago),
        });
        return res.status(200).json({
          status: 'entry_updated',
          docId,
          submissionId,
          form: isContasReceber ? 'contas_receber' : 'contas_pagar'
        });
      }
      // submissionId presente mas NÃO encontrado no Firestore → segue fluxo normal
      console.log(`submissionId ${submissionId} não encontrado no Firestore — tratando como novo`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CAMINHO 2 e 3: lógica original (baixa ou novo lançamento)
    // ══════════════════════════════════════════════════════════════════════════

    const docPago = isContasReceber
      ? (raw.q314_docpago314 || '').toString().toUpperCase().trim()
      : (raw.q291_docpago    || '').toString().toUpperCase().trim();

    const movimentacao = isContasReceber
      ? (raw.q169_nomeEmpresa || '').toString().trim()
      : (raw.q44_movimentacao44 || '').toString().trim();

    const valorRef = isContasReceber
      ? (raw.q252_valorRecebido || raw.q279_totalCobranca279 || '')
      : pickPositiveMoney(raw.q56_valorRefvalor56, raw.q57_valorPago);

    const dataAPagar = isContasReceber
      ? parseJotformDate(raw.q262_dataVencimentoreceber)
      : parseJotformDate(raw.q313_dataA);

    const dataBaixa = isContasReceber
      ? parseJotformDate(raw.q263_dataRecebimento)
      : parseJotformDate(raw.q129_dataBaixa);

    if (!movimentacao) {
      console.error('Movimentacao ausente — DUMP:', JSON.stringify(raw, null, 2));
      await recordJotformEvent({
        ...eventContext,
        action: 'invalid_payload',
        status: 'error',
        reason: 'movimentacao_ausente',
      });
      return res.status(400).json({ error: 'Movimentacao ausente' });
    }

    const dataPgto   = dataBaixa || dataAPagar || new Date().toLocaleDateString('pt-BR');
    const dueDateISO = toBrDate(dataAPagar);
    const valorNum   = parseValor(valorRef);

    // ── CAMINHO 2: BAIXA (Doc.Pago = SIM) ────────────────────────────────────
    if (docPago === 'SIM') {
      const movement    = isContasReceber ? 'Entrada' : 'Saída';
      const clientField = isContasReceber ? 'client' : 'description';

      // v6.0: SO baixa Pendentes. Nunca sobrescreve docs Pagos.
      // v6.3 FIX A: filtra tambem por valuePaid (±0,01) — impede baixar doc de OUTRO lancamento
      // que compartilha description+dueDate (ex: VT/VR de funcionarios diferentes).
      const receberFallback = isContasReceber ? (() => {
        const cr = extractContasReceber(raw);
        return {
          kind: 'receber',
          client: cr.nomeEmpresa,
          clientNumber: cr.nCliente,
          cpfCnpj: cr.cnpj,
          dueDate: cr.dueDateISO,
          valueReceived: cr.valorNum,
          totalCobranca: getReceberTotal(cr),
          honorarios: cr.honorarios,
          submissionId,
          docPago: cr.docPago,
        };
      })() : null;

      const matchDocsRaw = isContasReceber
        ? await queryReceberCandidateDocs(receberFallback, ['Pendente'])
        : await queryFirestore([
            [clientField, movimentacao],
            ['dueDate',   dueDateISO],
            ['movement',  movement],
            ['status',    'Pendente'],
          ]);

      const matchDocs = matchDocsRaw.filter(d => {
	        const ff = (d.document && d.document.fields) || {};
	        if (firestoreBoolean(ff.isExcluded)) return false;
	        if (isContasReceber) {
	          const ok = matchesReceberIdentity(ff, receberFallback);
          if (!ok) console.log(`v6.4 CAMINHO 2 RECEBER SKIP: ${d.document.name.split('/').pop()}`);
          return ok;
        }
        const vp = ff.valuePaid;
        if (!vp) return false;
        const v = vp.doubleValue != null ? Number(vp.doubleValue)
                : vp.integerValue != null ? Number(vp.integerValue)
                : vp.stringValue != null ? Number(String(vp.stringValue).replace(',', '.'))
                : NaN;
        const ok = Number.isFinite(v) && Math.abs(v - Number(valorNum)) < 0.01;
        if (!ok) console.log(`v6.3 CAMINHO 2 SKIP por valor: ${d.document.name.split('/').pop()} vp=${v} != ${valorNum}`);
        return ok;
      });

      if (matchDocs.length === 0) {
        // v5.9: ao inves de 404, cai para CAMINHO 3 e cria doc novo ja como Pago.
        // Isso preserva lancamentos "compra e pagamento no mesmo dia" sem Pendente previo.
        console.warn(`CAMINHO 2: nenhum Pendente para baixar (${movimentacao} ${dueDateISO} ${movement}) — criando doc novo como Pago via CAMINHO 3`);
      } else {

      const trxIds = [];
      const orderedMatchDocs = sortRowsForCanonicalUpdate(matchDocs, {
        kind: isContasReceber ? 'receber' : 'pagar',
        docPago,
      });
	      const docsToPatch = orderedMatchDocs.slice(0, 1);
	      if (isContasReceber && orderedMatchDocs.length > 1) {
	        console.log(`v6.5 CAMINHO 2 RECEBER: ${orderedMatchDocs.length} matches; atualizando ${getDocumentId(docsToPatch[0])} e ocultando legados duplicados depois`);
	      }
	      if (!isContasReceber && orderedMatchDocs.length > 1) {
	        console.log(`v6.6 CAMINHO 2 PAGAR: ${orderedMatchDocs.length} matches; atualizando ${getDocumentId(docsToPatch[0])} e verificando duplicados/stale depois`);
	      }

      for (const d of docsToPatch) {
        const docId = d.document.name.split('/').pop();

        const patchFields = isContasReceber
          ? {
              pago:          { stringValue: 'Pago' },
              status:        { stringValue: 'Pago' },
              valueReceived: { doubleValue: valorNum },
              valorPago:     { stringValue: String(valorRef || '') },
              dataPagamento: { stringValue: dataPgto },
              paymentDate:   { stringValue: toBrDate(dataPgto) },
              updatedAt:     { stringValue: new Date().toISOString() },
            }
          : {
              pago:          { stringValue: 'Pago' },
              status:        { stringValue: 'Pago' },
              valorPago:     { stringValue: String(valorRef || '') },
              dataPagamento: { stringValue: dataPgto },
              paymentDate:   { stringValue: toBrDate(dataPgto) },
              updatedAt:     { stringValue: new Date().toISOString() },
            };

        if (submissionId) patchFields.submissionId = { stringValue: String(submissionId) };

        await firestorePatch(docId, patchFields);
        trxIds.push(docId);
      }

      console.log('BAIXA OK:', movimentacao, '->', trxIds.join(', '));
	      if (isContasReceber && trxIds[0]) {
	        const crCleanup = extractContasReceber(raw);
	        await cleanupReceberLegacyDuplicates(crCleanup, submissionId, trxIds[0]);
	      }
	      if (!isContasReceber && trxIds[0]) {
	        const cpCleanup = extractContasPagar(raw);
	        await cleanupPagarStaleDuplicates(cpCleanup, submissionId, trxIds[0]);
	      }
      await recordJotformEvent({
        ...eventContext,
        action: 'payment_updated',
        status: 'ok',
        docIds: trxIds,
        movimentacao,
        dueDate: dueDateISO,
        amount: valorNum,
        docPago,
      });
      return res.status(200).json({ status: 'payment_updated', movimentacao, trxIds, submissionId });
      } // fecha else do v5.9 (matchDocs.length > 0)
    }

    // ── CAMINHO 3: NOVO LANÇAMENTO ────────────────────────────────────────────
    const docId   = await generateDocId(submissionId);
    const dateISO = dueDateISO || new Date().toISOString().split('T')[0];

    let docData;
    if (isContasReceber) {
      const cr = extractContasReceber(raw);
      const isPagoCR = docPago === 'SIM';
      const totalCobranca = getReceberTotal(cr);
      docData = {
        id:            docId,
        source:        'jotform',
        movement:      'Entrada',
        type:          'Entrada de Caixa / Contas a Receber',
        status:        isPagoCR ? 'Pago' : 'Pendente',
        pago:          isPagoCR ? 'Pago' : 'Não',
        client:        movimentacao,
        description:   movimentacao,
        date:          cr.dataLancISO || dateISO,
        dueDate:       dueDateISO || dateISO,
        paymentDate:   isPagoCR ? toBrDate(dataPgto) : '',
        dataPagamento: isPagoCR ? dataPgto : '',
        valorOriginal: totalCobranca,
        totalCobranca: totalCobranca,
        valuePaid:     0,
        valueReceived: isPagoCR ? valorNum : 0,
        valorPago:     isPagoCR ? String(valorRef || '') : '',
        bankAccount:   '',
        updatedAt:     new Date().toISOString(),
      };
      // Campos extras capturados
      if (cr.honorarios > 0) docData.honorarios   = cr.honorarios;
      docData.valorExtra = cr.extras || 0;
      docData.extras = cr.extras || 0;
      if (cr.nCliente)       docData.clientNumber  = cr.nCliente;
      if (cr.nCliente)       docData.nCliente      = cr.nCliente;
      if (cr.cnpj)           docData.cpfCnpj       = cr.cnpj;
      if (cr.metodo)         docData.metodoPagamento = cr.metodo;
      if (cr.obs)            docData.observacao    = cr.obs;
      if (cr.cobrancaExtra)  docData.cobrancaExtra = cr.cobrancaExtra;
	    } else {
	      // v5.9: respeita docPago para casos "compra e pagamento no mesmo dia"
	      const cp = extractContasPagar(raw);
	      const isPagoCP = docPago === 'SIM';
	      if (isEmptyContasPagar(cp)) {
	        console.log(`v6.6 PAGAR novo lançamento ignorado: submission ${submissionId || '(sem id)'} sem vencimento/valor valido`);
	        await recordJotformEvent({
	          ...eventContext,
	          action: 'entry_ignored',
	          status: 'ok',
	          movimentacao: cp.movimentacao,
	          dueDate: cp.dueDateISO,
	          amount: cp.valorNum,
	          docPago: cp.docPago,
	          reason: 'pagar_empty_or_zero',
	        });
	        return res.status(200).json({
	          status: 'entry_ignored',
	          submissionId,
	          form: 'contas_pagar',
	          reason: 'pagar_empty_or_zero'
	        });
	      }
	      docData = {
        id:            docId,
        source:        'jotform',
        movement:      'Saída',
        type:          'Saída de Caixa / Contas a Pagar',
        status:        isPagoCP ? 'Pago' : 'Pendente',
        pago:          isPagoCP ? 'Pago' : 'Não',
        description:   movimentacao,
        client:        movimentacao,
        date:          cp.dataLancISO || dateISO,
        dueDate:       dueDateISO || dateISO,
        paymentDate:   isPagoCP ? toBrDate(dataPgto) : '',
        dataPagamento: isPagoCP ? dataPgto : '',
        valorOriginal: valorNum,
        valuePaid:     valorNum,
        valueReceived: 0,
        valorPago:     isPagoCP ? String(valorRef || '') : '',
        bankAccount:   '',
        updatedAt:     new Date().toISOString(),
      };
	      if (cp.obs)    docData.observacaoAPagar = cp.obs;
	      if (cp.metodo) docData.metodoPagamento  = cp.metodo;
	      if (cp.identificacaoUnica) docData.identificacaoUnica = cp.identificacaoUnica;
	      if (cp.identificacaoUnicaAlt) docData.identificacaoUnicaAlt = cp.identificacaoUnicaAlt;
	    }

    if (submissionId) docData.submissionId = String(submissionId);

	    await firestoreSet(docId, toFields(docData));
	    if (isContasReceber) {
	      const crCleanup = extractContasReceber(raw);
	      await cleanupReceberLegacyDuplicates(crCleanup, submissionId, docId);
	    }
	    if (!isContasReceber) {
	      const cpCleanup = extractContasPagar(raw);
	      await cleanupPagarStaleDuplicates(cpCleanup, submissionId, docId);
	    }

	    console.log(`LANÇAMENTO OK (${isContasReceber ? 'RECEBER' : 'PAGAR'}): ${movimentacao} → ${docId}`);
    await recordJotformEvent({
      ...eventContext,
      action: 'entry_created',
      status: 'ok',
      docId,
      movimentacao,
      dueDate: dueDateISO || dateISO,
      amount: valorNum,
      docPago,
    });
    return res.status(200).json({ status: 'entry_created', movimentacao, docId, submissionId });

  } catch (err) {
    console.error('Erro geral:', err.message);
    await recordJotformEvent({
      ...eventContext,
      action: 'error',
      status: 'error',
      error: err.message,
    });
    return res.status(500).json({ error: err.message });
  }
});

function jotformDateToEpoch(value) {
  if (!value) return 0;
  const normalized = String(value).replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}-03:00`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function listRecentJotformSubmissionIds(sinceHours) {
  const apiKey = process.env.JOTFORM_API_KEY;
  if (!apiKey) throw new Error('JOTFORM_API_KEY env nao configurada');

  const cutoff = Date.now() - (sinceHours * 60 * 60 * 1000);
  const fetchOrdered = async orderby => {
    const url = new URL(`https://api.jotform.com/form/${encodeURIComponent(JOTFORM_FORM_ID)}/submissions`);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('limit', '200');
    url.searchParams.set('orderby', orderby);

    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.responseCode !== 200) {
      throw new Error(`Jotform list ${orderby} falhou (${payload.responseCode || response.status})`);
    }

    return (payload.content || [])
      .filter(item => item && item.id && item.status === 'ACTIVE')
      .filter(item => jotformDateToEpoch(item[orderby]) >= cutoff)
      .map(item => String(item.id));
  };

  // Envios novos podem ter updated_at nulo. Consultar apenas updated_at deixa
  // esses lancamentos invisiveis; por isso conciliamos criacoes e edicoes.
  const [createdIds, updatedIds] = await Promise.all([
    fetchOrdered('created_at'),
    fetchOrdered('updated_at'),
  ]);
  return [...new Set([...createdIds, ...updatedIds])];
}

function reconcileRequestAuthorized(req) {
  const expected = process.env.JOTFORM_RECONCILE_KEY || '';
  const received = req.get('x-reconcile-key') || '';
  return expected.length >= 24 && received === expected;
}

// Recupera webhooks perdidos e reaplica edicoes recentes de forma idempotente.
// O processamento volta pela rota principal para manter um unico contrato de
// parsing e persistencia. Novos documentos usam sempre trx-jf-{submissionId}.
app.post('/reconcile-jotform', async (req, res) => {
  if (!reconcileRequestAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const body = req.body || {};
    const dryRun = body.dryRun === true;
    const sinceHours = Math.min(Math.max(Number(body.sinceHours) || 6, 1), 168);
    const explicitIds = Array.isArray(body.submissionIds)
      ? body.submissionIds.map(String).filter(Boolean).slice(0, 100)
      : [];
    const submissionIds = explicitIds.length > 0
      ? [...new Set(explicitIds)]
      : [...new Set(await listRecentJotformSubmissionIds(sinceHours))];

    const results = [];
    const baseUrl = process.env.K_SERVICE
      ? `https://${req.get('host')}`
      : `http://127.0.0.1:${process.env.PORT || 8080}`;

    for (const submissionId of submissionIds) {
      const exactBefore = await queryExactBySubmissionId(submissionId);
      const raw = await fetchJotformSubmissionRaw(submissionId);
      if (!raw) {
        results.push({ submissionId, status: 'jotform_not_found' });
        continue;
      }

      if (dryRun) {
        results.push({
          submissionId,
          status: exactBefore && exactBefore.length > 0 ? 'would_update' : 'would_create',
        });
        continue;
      }

      const params = new URLSearchParams();
      params.set('submissionID', submissionId);
      params.set('rawRequest', JSON.stringify(raw));
      const processed = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const processedBody = await processed.json().catch(() => ({}));
      if (!processed.ok) {
        results.push({ submissionId, status: 'error', error: processedBody.error || `HTTP ${processed.status}` });
        continue;
      }
      results.push({ submissionId, status: processedBody.status || 'processed', docId: processedBody.docId || '' });
    }

    const failures = results.filter(item => item.status === 'error' || item.status === 'jotform_not_found');
    return res.status(failures.length > 0 ? 207 : 200).json({
      ok: failures.length === 0,
      version: WEBHOOK_VERSION,
      dryRun,
      sinceHours,
      scanned: submissionIds.length,
      failures: failures.length,
      results,
    });
  } catch (error) {
    console.error('reconcile-jotform error:', error.message);
    return res.status(500).json({ ok: false, error: error.message, version: WEBHOOK_VERSION });
  }
});

// ----------------------------------------------------------------------------
// /jotform-update-submission
// Edita uma submission existente no JotForm via API.
// Substitui o uso direto da JotForm API a partir do frontend (Admin.tsx),
// que tinha JOTFORM_API_KEY hardcoded no bundle publico.
// Body: { submissionId: string, fields: Record<string, string> }
// fields ex: { "submission[q291_docpago]": "Sim", "submission[q129_dataBaixa]": "2026-05-02" }
// Adicionado em 02/05/2026.
// ----------------------------------------------------------------------------
app.post('/jotform-update-submission', async (req, res) => {
  try {
    const apiKey = process.env.JOTFORM_API_KEY;
    if (!apiKey) {
      console.error('jotform-update-submission: JOTFORM_API_KEY env nao configurada');
      return res.status(500).json({ ok: false, error: 'server_misconfigured' });
    }

    const body = (req.body && req.body.data) ? req.body.data : (req.body || {});
    const submissionId = body.submissionId;
    const fields = body.fields || {};

    if (!submissionId || typeof submissionId !== 'string') {
      return res.status(400).json({ ok: false, error: 'submissionId required' });
    }
    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      return res.status(400).json({ ok: false, error: 'fields required (non-empty object)' });
    }

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) params.append(k, String(v));
    }

    const url = `https://api.jotform.com/submission/${encodeURIComponent(submissionId)}?apiKey=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || data.responseCode !== 200) {
      console.error(`jotform-update-submission failed sub=${submissionId} jotformStatus=${data.responseCode || r.status}`);
      return res.status(502).json({
        ok: false,
        error: 'jotform_api_error',
        jotformStatus: data.responseCode || r.status,
        message: data.message,
      });
    }

    console.log(`jotform-update-submission OK: sub=${submissionId} fields=${Object.keys(fields).join(',')}`);
    res.json({ ok: true, submissionId, updated: Object.keys(fields).length });
  } catch (err) {
    console.error('jotform-update-submission error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'jotform-webhook online', version: WEBHOOK_VERSION }));

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
}

module.exports = {
  app,
  WEBHOOK_VERSION,
  parseValor,
  toBrDate,
  normalizeDigits,
  namesProbablyMatch,
  matchesReceberIdentity,
  sortRowsForCanonicalUpdate,
  getReceberTotal,
  extractContasReceber,
  extractContasPagar,
  isContasReceberPayload,
  isEmptyContasPagar,
  jotformDateToEpoch,
};
