// Leitura independente do checklist: não chama webhooks de lançamento nem grava transações.
const { createHash } = require('node:crypto');
const FORM_ID = '210135417457653';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const labels = {
  client: ['EMPRESA NOME'], clientNumber: ['NOSSO NUMERO'], document: ['CNPJ', 'CPF CNPJ', 'CPF'],
  amount: ['HONORARIOS'], entryDate: ['DATA CADASTRO ESCRITORIO'], exitDate: ['DATA SAIDA ESCRITORIO'],
  suspensionDate: ['DATA SUSPENSAO'], status: ['STATUS CLIENTES'], notes: ['OBSERVACAO'],
  billingDay: ['DIA DE COBRANCA'], lastChargeDate: ['ULTIMA COBRANCA', 'DATA ULTIMA COBRANCA'],
};
const fieldNames = { client: 'Nome do cliente', clientNumber: 'Nosso número', document: 'CPF/CNPJ', amount: 'Honorários', entryDate: 'Data de entrada', exitDate: 'Data de saída', suspensionDate: 'Data de suspensão', status: 'Status do cliente', notes: 'Observações', billingDay: 'Dia de cobrança', lastChargeDate: 'Última cobrança' };
const text = value => value == null ? '' : typeof value === 'string' || typeof value === 'number' ? String(value).trim() : JSON.stringify(value);
function date(value) {
  if (!value) return '';
  let s = typeof value === 'object' && value.year && value.month && value.day
    ? `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}` : String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) s = s.split('/').reverse().join('-');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00Z') : null;
  return d && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}
function amount(value) {
  let s = text(value).replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null;
}
function mapChecklist(questions, submissions) {
  const fields = Object.fromEntries(Object.entries(labels).map(([key, names]) => [key,
    Object.entries(questions).filter(([, q]) => names.includes(normalize(q.text))).map(([id]) => id)]));
  if (!fields.client.length || !fields.clientNumber.length || !fields.amount.length || !fields.notes.length)
    throw new Error('CHECKLIST_SCHEMA_INCOMPLETE');
  const records = submissions.map(submission => {
    const issues = [];
    const read = (key, parser = text) => {
      const values = fields[key].map(id => submission.answers?.[id]?.answer).filter(v => v != null && text(v) !== '').map(parser);
      if (values.includes(null)) issues.push(`${fieldNames[key]}: valor inválido`);
      const unique = [...new Set(values.filter(v => v != null))];
      if (unique.length > 1) { issues.push(`${fieldNames[key]}: campos duplicados divergem`); return null; }
      return unique[0] ?? null;
    };
    const client = read('client'); const clientNumber = read('clientNumber');
    const document = (read('document') || '').replace(/\D/g, '');
    const identity = [11, 14].includes(document.length) ? `doc:${document}` : clientNumber ? `number:${clientNumber}` : '';
    if (!client) issues.push('Nome do cliente ausente');
    if (!identity) issues.push('Identificação ausente: não unir por nome');
    const fee = read('amount', amount); if (fee == null) issues.push('Honorários ausentes ou inválidos');
    const entryDate = read('entryDate', date); const exitDate = read('exitDate', date);
    const suspensionDate = read('suspensionDate', date);
    if (entryDate && exitDate && exitDate < entryDate) issues.push('Saída anterior à entrada');
    const billingDay = read('billingDay'); const lastChargeDate = read('lastChargeDate', date);
    return { submissionId: String(submission.id), sourceUrl: `https://www.jotform.com/submissions/${FORM_ID}`,
      sourceCreatedAt: submission.created_at || null, sourceUpdatedAt: submission.updated_at || null,
      identity, client, clientNumber, document, amount: fee, entryDate, exitDate, suspensionDate,
      status: read('status'), notes: read('notes'), billingDay, lastChargeDate,
      observationsRequireReview: !fields.billingDay.length || !fields.lastChargeDate.length,
      issues, contractValidated: false };
  });
  const groups = new Map();
  for (const r of records) { if (!r.identity) continue; const group = groups.get(r.identity) || []; group.push(r); groups.set(r.identity, group); }
  for (const group of groups.values()) if (group.length > 1) for (const r of group) r.issues.push('Mais de uma resposta para o cliente: confirmar vigência; não substituir automaticamente');
  const valid = records.filter(r => !r.issues.length).length;
  return { records, fields, validRecords: valid, conflictRecords: records.length - valid,
    observationsToReview: records.filter(r => r.observationsRequireReview).length };
}

async function loadChecklist({ apiKey, fetcher = fetch }) {
  if (!apiKey) throw new Error('CHECKLIST_CREDENTIAL_MISSING');
  const request = async path => {
    const response = await fetcher(`https://api.jotform.com${path}`, {
      headers: { APIKEY: apiKey }, signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.responseCode !== 200 || body.content == null) throw new Error('CHECKLIST_SOURCE_UNAVAILABLE');
    return body.content;
  };
  const getCount = form => {
    const raw = form.submission_count ?? form.count;
    if (raw == null || raw === '' || !/^\d+$/.test(String(raw))) throw new Error('CHECKLIST_COUNT_UNAVAILABLE');
    return Number(raw);
  };
  const before = await request(`/form/${FORM_ID}`); const expected = getCount(before);
  const questions = await request(`/form/${FORM_ID}/questions`);
  if (!questions || Array.isArray(questions) || typeof questions !== 'object') throw new Error('CHECKLIST_SCHEMA_INCOMPLETE');
  const scan = async () => {
    const rows = [], ids = new Set();
    for (let offset = 0; offset <= 100000; offset += 200) {
      const batch = await request(`/form/${FORM_ID}/submissions?limit=200&offset=${offset}&orderby=id`);
      if (!Array.isArray(batch)) throw new Error('CHECKLIST_INCOMPLETE');
      for (const row of batch) {
        if (!/^\d+$/.test(String(row.id)) || String(row.form_id) !== FORM_ID || ids.has(String(row.id))) throw new Error('CHECKLIST_PAGINATION_CHANGED');
        ids.add(String(row.id)); rows.push(row);
      }
      if (batch.length < 200) return rows;
    }
    throw new Error('CHECKLIST_LIMIT_EXCEEDED');
  };
  const signature = rows => createHash('sha256').update(JSON.stringify(rows.map(r => [String(r.id), r.status, r.created_at, r.updated_at, r.answers]).sort((a,b) => a[0].localeCompare(b[0])))).digest('hex');
  const first = await scan(); const second = await scan(); const after = await request(`/form/${FORM_ID}`);
  const questionsAfter = await request(`/form/${FORM_ID}/questions`);
  if (first.length !== expected || second.length !== expected || getCount(after) !== expected ||
      signature(first) !== signature(second) || JSON.stringify(questions) !== JSON.stringify(questionsAfter)) throw new Error('CHECKLIST_CHANGED_OR_INCOMPLETE');
  const excluded = first.filter(r => r.status !== 'ACTIVE');
  const active = first.filter(r => r.status === 'ACTIVE');
  const mapped = mapChecklist(questions, active);
  return { formId: FORM_ID, title: String(before.title || 'Check List Atual 2026'), readAt: new Date().toISOString(),
    sourceFingerprint: signature(first), complete: true, expected, received: first.length, active: active.length,
    excluded: excluded.length, postingCoverage: null, canCloseMonth: false, ...mapped };
}

function installChecklistRoute(app, google, projectId) {
  let cache = null, pending = null;
  app.post('/api/billing-checklist/review', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const bearer = req.get('authorization') || '';
      if (!/^Bearer [^\s]+$/.test(bearer)) return res.status(401).json({ error: 'Entre novamente para ler o checklist.' });
      const apiKey = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyD8ALStO87VkkDcI00oe570cctmKCB7iBg';
      const identity = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: bearer.slice(7) }), signal: AbortSignal.timeout(10000),
      });
      const account = await identity.json().catch(() => ({}));
      const uid = account.users?.[0]?.localId;
      if (!identity.ok || !uid || account.users[0].disabled) return res.status(401).json({ error: 'Sessão inválida.' });
      const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
      const client = await auth.getClient();
      let profile;
      try { profile = await client.request({ url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}` }); }
      catch { return res.status(403).json({ error: 'Perfil financeiro indisponível.' }); }
      if (profile.data.fields?.active?.booleanValue !== true) return res.status(403).json({ error: 'Perfil financeiro inativo.' });
      const elapsed = cache ? Date.now() - cache.at : Infinity;
      if (!cache || elapsed > 600000 || (req.body?.force === true && elapsed > 30000)) {
        if (!pending) {
          pending = loadChecklist({ apiKey: process.env.JOTFORM_API_KEY }).then(data => { cache = { at: Date.now(), data }; return data; }).finally(() => { pending = null; });
        }
        await pending;
      }
      return res.json(cache.data);
    } catch (error) {
      // Nunca registrar URL da API, token, observações ou chave.
      return res.status(503).json({ error: 'Não foi possível confirmar a leitura completa do checklist. Nenhuma conclusão mensal foi liberada.', code: /^CHECKLIST_[A-Z_]+$/.test(error.message) ? error.message : 'CHECKLIST_READ_FAILED' });
    }
  });
}
module.exports = { mapChecklist, loadChecklist, installChecklistRoute, FORM_ID };
