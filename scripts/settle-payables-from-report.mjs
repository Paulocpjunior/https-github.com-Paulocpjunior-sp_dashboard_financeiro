#!/usr/bin/env node

// Baixa em lote de contas a pagar listadas num Relatório Financeiro (PDF) que
// já foram pagas fora do app. Sem --apply só lê o Firestore e gera o plano.
// Cada conta só entra no plano com correspondência única; o resto vai para
// revisão manual. Nunca exclui nada e nunca toca em contas a receber.

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DATABASE = '(default)';
const REPORT_DIR = 'migration-backups';
const DEFAULT_INPUT = 'scripts/data/contas-pagar-relatorio-2026-10-28.json';

const usage = `
Usage:
  node scripts/settle-payables-from-report.mjs [--input <json>] [--project <id>]
  node scripts/settle-payables-from-report.mjs --apply --plan <sha256> --actor "<nome>"

Sem --apply: somente leitura. Gera migration-backups/settle-payables-plan-<ts>.json/.md
com as contas encontradas (correspondência única), as ambíguas e as não encontradas.
Com --apply: exige o hash do plano revisado; grava cada conta como Pago com
precondição de updateTime e cria um registro em payableAudit na mesma transação.
`;

export const normalizeText = (value) => String(value ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export const normalizeDate = (value) => {
  const clean = String(value ?? '').trim().split(/[ T]/)[0];
  let m = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};

export const parseMoney = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!raw) return 0;
  if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (raw.includes(',')) raw = raw.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const cents = (value) => Math.round(parseMoney(value) * 100);
const firstPositive = (values) => values.find((v) => v > 0) || 0;

// Mesma ordem de getOriginalAmount (utils/transactionAmounts.ts) para saídas.
export const originalCents = (d) => firstPositive([
  cents(d.valuePaid), cents(d.valorOriginal), cents(d.totalCobranca),
  cents(d.honorarios) + cents(d.valorExtra), cents(d.valueReceived),
]);

const isWix = (id, d) => normalizeText(d.source) === 'wix' || normalizeText(id).startsWith('wix-') ||
  Boolean(d.wixInvoiceNumber || d.wixEntityId || d.wixOrderNumber || d.wixTransactionId);

export const isPayable = (id, d) => {
  if (isWix(id, d)) return false;
  const movement = normalizeText(d.movement);
  const type = normalizeText(d.type);
  if (movement === 'entrada' || type.includes('entrada') || type.includes('receber')) return false;
  return movement === 'saida' || type.includes('saida') || type.includes('pagar');
};

export const isPendingStatus = (status) =>
  ['', 'pendente', 'nao', 'n', 'aberto', 'em aberto'].includes(normalizeText(status));

// Conta com histórico de baixa (parcial ou não) não entra no lote.
export const blocker = (d) => {
  if (d.isExcluded === true) return 'excluída';
  if (!isPendingStatus(d.status)) return `status ${d.status}`;
  if (['sim', 'pago', 'true'].includes(normalizeText(d.pago))) return 'campo pago preenchido';
  if (parseMoney(d.valorPago) > 0) return 'valorPago preenchido';
  if (d.payableBalance || d.payableSettlement || (d.payablePayments || []).length) return 'possui baixa parcial/histórico';
  return '';
};

const clientMatches = (row, d) => {
  const want = normalizeText(row.client);
  const got = normalizeText(d.client);
  if (want === 'favorecido nao informado') return !got || got === want;
  return Boolean(want) && got.startsWith(want);
};

export function buildPlan(rows, documents) {
  const byKey = new Map();
  const ineligible = new Map();
  for (const doc of documents) {
    const d = doc.data;
    if (!isPayable(doc.id, d)) continue;
    const key = `${normalizeDate(d.dueDate)}|${originalCents(d)}`;
    const reason = blocker(d);
    const target = reason ? ineligible : byKey;
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(reason ? { doc, reason } : doc);
  }
  const matched = []; const ambiguous = []; const missing = [];
  const used = new Set();
  for (const row of rows) {
    const key = `${row.dueDate}|${row.amountCents}`;
    const pool = (byKey.get(key) || []).filter((doc) => !used.has(doc.id));
    const sameDate = pool.filter((doc) => normalizeDate(doc.data.date) === row.date);
    const exact = sameDate.filter((doc) => clientMatches(row, doc.data));
    const summary = (doc) => ({ id: doc.id, date: doc.data.date, dueDate: doc.data.dueDate, client: doc.data.client,
      description: doc.data.description, status: doc.data.status, amountCents: originalCents(doc.data) });
    if (exact.length === 1) {
      used.add(exact[0].id);
      matched.push({ row, id: exact[0].id, updateTime: exact[0].updateTime, before: summary(exact[0]) });
    } else if (exact.length > 1) {
      ambiguous.push({ row, reason: `${exact.length} contas iguais`, candidates: exact.map(summary) });
    } else {
      const blocked = (ineligible.get(key) || []).filter(({ doc }) => normalizeDate(doc.data.date) === row.date && clientMatches(row, doc.data));
      if (blocked.length) missing.push({ row, reason: `encontrada mas não elegível: ${blocked.map((b) => b.reason).join('; ')}`, candidates: blocked.map((b) => summary(b.doc)) });
      else if (pool.length) ambiguous.push({ row, reason: 'mesmo vencimento e valor, data ou favorecido diferente', candidates: pool.map(summary) });
      else missing.push({ row, reason: 'nenhuma conta pendente com esse vencimento e valor', candidates: [] });
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(matched.map((m) => [m.row.line, m.id, m.updateTime]))).digest('hex');
  const total = (list) => list.reduce((sum, item) => sum + item.row.amountCents, 0);
  return { hash, matched, ambiguous, missing, totals: { matchedCents: total(matched), ambiguousCents: total(ambiguous), missingCents: total(missing) } };
}

// Data da baixa = vencimento (o relatório não traz a data efetiva do pagamento).
export function settlementPatch(row, { at, batchId, actor, account, source }) {
  const date = row.dueDate;
  return {
    status: 'Pago',
    pago: 'Pago',
    paymentDate: date,
    dataPagamento: date.split('-').reverse().join('/'),
    valorPago: (row.amountCents / 100).toFixed(2),
    updatedAt: at,
    bulkPayableSettlement: { batchId, source, reportLine: row.line, date, amountCents: row.amountCents, actor, account, at, rule: 'data da baixa = vencimento' },
  };
}

const encode = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
  return { stringValue: String(value) };
};

const token = () => process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim() ||
  execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const account = () => {
  try { return execFileSync('gcloud', ['config', 'get-value', 'account'], { encoding: 'utf8' }).trim(); } catch { return ''; }
};
const base = (project) => `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(DATABASE)}/documents`;

async function call(url, auth, init = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.text();
  if (!response.ok) throw Object.assign(new Error(`Firestore ${response.status}: ${body.slice(0, 400)}`), { status: response.status });
  return body ? JSON.parse(body) : {};
}

const markdown = (plan, meta) => {
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const line = (item) => `| ${item.row.line} | ${item.row.dueDate} | ${brl(item.row.amountCents)} | ${item.row.client} | ${item.reason} | ${item.candidates.map((c) => c.id).join(', ')} |`;
  return [
    '# Baixa em lote de contas a pagar', '',
    `Gerado em: ${meta.generatedAt}`, `Origem: ${meta.source}`, `Hash do plano: ${plan.hash}`, '',
    `- Linhas no relatório: ${meta.rows}`,
    `- Encontradas (correspondência única): ${plan.matched.length} — ${brl(plan.totals.matchedCents)}`,
    `- Ambíguas: ${plan.ambiguous.length} — ${brl(plan.totals.ambiguousCents)}`,
    `- Não encontradas/não elegíveis: ${plan.missing.length} — ${brl(plan.totals.missingCents)}`, '',
    '## Para revisão manual', '', '| Linha | Venc. | Valor | Favorecido | Motivo | Candidatas |', '|---|---|---|---|---|---|',
    ...plan.ambiguous.map(line), ...plan.missing.map(line), '',
  ].join('\n');
};

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : ''; };
  if (argv.includes('--help')) { console.log(usage.trim()); return; }
  const project = opt('--project') || DEFAULT_PROJECT_ID;
  const input = JSON.parse(readFileSync(resolve(opt('--input') || DEFAULT_INPUT), 'utf8'));
  const apply = argv.includes('--apply');
  if (input.rows.length !== input.count || input.rows.reduce((s, r) => s + r.amountCents, 0) !== input.totalCents)
    throw new Error('Arquivo de entrada inconsistente com o total do relatório.');

  const { listCollection } = await import('./export-firestore-data.mjs');
  const auth = token();
  const documents = await listCollection(project, 'transactions', auth);
  const plan = buildPlan(input.rows, documents);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const meta = { generatedAt: new Date().toISOString(), source: input.source, rows: input.rows.length, project };
  const out = resolve(`${REPORT_DIR}/settle-payables-${apply ? 'apply' : 'plan'}-${stamp}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out.replace(/\.json$/, '.md'), markdown(plan, meta));

  console.log(`Encontradas: ${plan.matched.length} (${(plan.totals.matchedCents / 100).toFixed(2)})`);
  console.log(`Ambíguas: ${plan.ambiguous.length} | Não encontradas/não elegíveis: ${plan.missing.length}`);
  console.log(`Hash do plano: ${plan.hash}`);

  if (!apply) {
    writeFileSync(out, JSON.stringify({ meta, ...plan }, null, 2));
    console.log(`Somente leitura. Plano: ${out}`);
    return;
  }
  const actor = opt('--actor').trim();
  if (!actor) throw new Error('Informe --actor com o nome de quem autorizou.');
  if (opt('--plan') !== plan.hash) throw new Error('O plano mudou desde a revisão (ou --plan ausente). Gere e revise de novo.');

  // Cópia local integral (formato bruto do Firestore) antes de qualquer escrita.
  const ids = new Set(plan.matched.map((m) => m.id));
  const raw = [];
  for (const id of ids) raw.push(await call(`${base(project)}/transactions/${encodeURIComponent(id)}`, auth));
  writeFileSync(out.replace(/\.json$/, '-backup.json'), JSON.stringify(raw, null, 2));

  const batchId = randomUUID();
  const who = account();
  const results = [];
  for (const item of plan.matched) {
    const at = new Date().toISOString();
    const patch = settlementPatch(item.row, { at, batchId, actor, account: who, source: input.source });
    const name = `projects/${project}/databases/${DATABASE}/documents/transactions/${item.id}`;
    const auditId = createHash('sha256').update(`${batchId}|${item.id}`).digest('hex');
    const audit = { action: 'bulk-report-payment', transactionId: item.id, batchId, actor, account: who, at, source: input.source,
      reportLine: item.row.line, before: item.before, after: patch };
    try {
      await call(`${base(project)}:commit`, auth, { method: 'POST', body: JSON.stringify({ writes: [
        { update: { name, fields: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, encode(v)])) },
          updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: item.updateTime } },
        { update: { name: `projects/${project}/databases/${DATABASE}/documents/payableAudit/${auditId}`,
          fields: Object.fromEntries(Object.entries(audit).map(([k, v]) => [k, encode(v)])) }, currentDocument: { exists: false } },
      ] }) });
      results.push({ id: item.id, line: item.row.line, ok: true });
    } catch (error) {
      results.push({ id: item.id, line: item.row.line, ok: false, error: error.message });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  writeFileSync(out, JSON.stringify({ meta: { ...meta, batchId, actor, account: who }, ...plan, results }, null, 2));
  console.log(`Gravadas: ${ok} | Falhas: ${results.length - ok} | Lote: ${batchId}`);
  console.log(`Relatório: ${out}`);
  if (ok !== results.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
