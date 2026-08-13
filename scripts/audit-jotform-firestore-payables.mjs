#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const input = arg('--input');
const updatedSince = arg('--updated-since', `${new Date().getFullYear()}-01-01`);
const out = arg('--out', `migration-backups/jotform-payables-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const formId = arg('--form-id', '210020525580845');
const pageSize = Math.min(Math.max(Number(arg('--page-size', '200')), 20), 200);
const projectId = arg('--project', 'gen-lang-client-0888019226');

if (!input) throw new Error('Informe --input <backup Firestore JSON>');
if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedSince)) throw new Error('--updated-since deve usar YYYY-MM-DD');

function getApiKey() {
  if (process.env.JOTFORM_API_KEY) return process.env.JOTFORM_API_KEY;
  const json = execFileSync('gcloud', [
    'run', 'services', 'describe', 'jotform-webhook',
    '--region=southamerica-east1', `--project=${projectId}`, '--format=json',
  ], { encoding: 'utf8' });
  const service = JSON.parse(json);
  const env = service.spec?.template?.spec?.containers?.[0]?.env || [];
  return env.find(item => item.name === 'JOTFORM_API_KEY')?.value || '';
}

const apiKey = getApiKey();
if (!apiKey) throw new Error('JOTFORM_API_KEY indisponivel');

const toEpoch = value => {
  if (!value) return 0;
  const normalized = String(value).replace(' ', 'T');
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}-03:00`;
  return Date.parse(zoned) || 0;
};
const cutoff = toEpoch(`${updatedSince} 00:00:00`);

async function fetchPage(offset, orderby, attempt = 1) {
  const url = new URL(`https://api.jotform.com/form/${formId}/submissions`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('limit', String(pageSize));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('orderby', orderby);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.responseCode !== 200) throw new Error(`HTTP ${payload.responseCode || response.status}`);
    return payload.content || [];
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    return fetchPage(offset, orderby, attempt + 1);
  }
}

const submissionsById = new Map();
for (const orderby of ['created_at', 'updated_at']) {
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const page = await fetchPage(offset, orderby);
    if (page.length === 0) break;
    for (const item of page) {
      if (toEpoch(item[orderby]) >= cutoff) submissionsById.set(String(item.id), item);
    }
    const last = toEpoch(page.at(-1)?.[orderby]);
    process.stdout.write(`Jotform ${orderby} offset ${offset}: ${page.length} registros, ultimo=${page.at(-1)?.[orderby] || '-'}\n`);
    if (page.length < pageSize || last < cutoff) break;
  }
}
const submissions = [...submissionsById.values()];

const answersByName = submission => Object.values(submission.answers || {}).reduce((map, answer) => {
  if (answer?.name) map[answer.name] = answer.answer;
  return map;
}, {});
const asDate = value => {
  if (!value) return '';
  if (typeof value === 'object' && value.year && value.month && value.day) {
    return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  }
  const match = String(value).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : String(value).slice(0, 10);
};
const money = value => Number(String(value || '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const normalize = value => String(value || '').trim().toUpperCase();

const candidatePayables = submissions
  .filter(submission => submission.status === 'ACTIVE')
  .map(submission => ({ submission, answers: answersByName(submission) }))
  .filter(({ answers }) => normalize(answers.tipoDe).includes('CONTAS A PAGAR'))
  .map(({ submission, answers }) => ({
    submissionId: String(submission.id),
    identificacaoUnica: String(answers.identificacaoUnica || ''),
    identificacaoUnicaAlt: String(answers.identificacaoUnica285 || ''),
    createdAt: submission.created_at || '',
    updatedAt: submission.updated_at || '',
    launchDate: asDate(answers.dataLancamento || answers.dataLancamento167 || answers.dataLancamento6),
    dueDate: asDate(answers.dataA),
    description: String(answers.movimentacao44 || '').trim(),
    observation: String(answers.observacao17 || answers.observacao || '').trim(),
    amount: money(answers.valorRefvalor56 || answers.valorPago),
    docPago: normalize(answers.docpago),
  }));
const invalidPayables = candidatePayables.filter(item => !item.description || !item.dueDate || item.amount <= 0);
const payables = candidatePayables.filter(item => item.description && item.dueDate && item.amount > 0);

const backup = JSON.parse(readFileSync(input, 'utf8'));
const transactionCollection = (backup.collections || []).find(item => item.name === 'transactions');
const transactions = transactionCollection?.documents || [];
const bySubmission = new Map();
const byFinancialIdentity = new Map();
const financialKey = (description, dueDate, amount) => [
  normalize(description),
  String(dueDate || ''),
  Math.round(Number(amount || 0) * 100),
].join('|');
for (const document of transactions) {
  const data = document.data || {};
  const submissionId = String(document.data?.submissionId || document.data?.submissionID || '');
  if (submissionId) {
    if (!bySubmission.has(submissionId)) bySubmission.set(submissionId, []);
    bySubmission.get(submissionId).push(document);
  }
  if (data.isExcluded === true) continue;
  const amount = Number(data.valuePaid || data.valorOriginal || 0);
  const key = financialKey(data.description, data.dueDate, amount);
  if (!byFinancialIdentity.has(key)) byFinancialIdentity.set(key, []);
  byFinancialIdentity.get(key).push(document);
}

const missing = [];
const legacyFinancialMatches = [];
const excludedActive = [];
const mismatches = [];
for (const payable of payables) {
  const documents = bySubmission.get(payable.submissionId) || [];
  if (documents.length === 0) {
    const financialMatches = byFinancialIdentity.get(financialKey(payable.description, payable.dueDate, payable.amount)) || [];
    if (financialMatches.length > 0) {
      legacyFinancialMatches.push({
        ...payable,
        firestoreIds: financialMatches.map(document => document.id),
      });
    } else {
      missing.push(payable);
    }
    continue;
  }
  const active = documents.filter(document => document.data?.isExcluded !== true);
  if (active.length === 0) {
    excludedActive.push({ ...payable, firestoreIds: documents.map(document => document.id) });
    continue;
  }
  const document = active[0];
  const data = document.data || {};
  const expectedStatus = payable.docPago === 'SIM' ? 'PAGO' : 'PENDENTE';
  const fields = [];
  if (String(data.dueDate || '') !== payable.dueDate) fields.push('dueDate');
  if (Math.abs(Number(data.valuePaid || data.valorOriginal || 0) - payable.amount) > 0.01) fields.push('amount');
  if (normalize(data.status) !== expectedStatus) fields.push('status');
  if (normalize(data.description) !== normalize(payable.description)) fields.push('description');
  if (fields.length > 0) {
    mismatches.push({
      ...payable,
      firestoreId: document.id,
      fields,
      firestore: {
        dueDate: data.dueDate || '',
        amount: Number(data.valuePaid || data.valorOriginal || 0),
        status: data.status || '',
        description: data.description || '',
      },
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  projectId,
  formId,
  input: path.resolve(input),
  updatedSince,
  counts: {
    jotformSubmissionsScanned: submissions.length,
    validActivePayables: payables.length,
    invalidActivePayables: invalidPayables.length,
    missingInFirestore: missing.length,
    legacyFinancialMatchesWithoutSubmissionId: legacyFinancialMatches.length,
    activeInJotformButExcluded: excludedActive.length,
    fieldMismatches: mismatches.length,
  },
  missing,
  legacyFinancialMatches,
  invalidPayables,
  excludedActive,
  mismatches,
};

const jsonPath = path.resolve(out);
const mdPath = jsonPath.replace(/\.json$/i, '.md');
const csvPath = jsonPath.replace(/\.json$/i, '.csv');
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const mdRows = missing.map(item => `| ${item.submissionId} | ${item.identificacaoUnica || '-'} | ${item.launchDate} | ${item.dueDate} | ${item.description.replace(/\|/g, '/')} | ${item.observation.replace(/\|/g, '/')} | ${item.amount.toFixed(2)} | ${item.docPago} |`);
writeFileSync(mdPath, [
  '# Auditoria Jotform x Firestore - Contas a Pagar', '',
  `- Gerado em: ${report.generatedAt}`,
  `- Atualizados desde: ${updatedSince}`,
  `- Contas a pagar validos no Jotform: ${payables.length}`,
  `- Contas a pagar ativos com campos invalidos: ${invalidPayables.length}`,
  `- Ausentes no Firestore: ${missing.length}`,
  `- Correspondencias financeiras legadas sem submissionId: ${legacyFinancialMatches.length}`,
  `- Ativos no Jotform, mas excluidos no Firestore: ${excludedActive.length}`,
  `- Divergencias de campos: ${mismatches.length}`, '',
  '## Ausentes no Firestore', '',
  '| Submission ID | Identificacao | Lancamento | Vencimento | Movimentacao | Observacao | Valor | Doc.Pago |',
  '|---|---|---|---|---|---|---:|---|',
  ...(mdRows.length ? mdRows : ['| - | - | - | - | Nenhum | - | 0,00 | - |']), '',
].join('\n'));

const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
const csvHeader = ['submissionId','identificacaoUnica','createdAt','updatedAt','launchDate','dueDate','description','observation','amount','docPago'];
writeFileSync(csvPath, [
  csvHeader.join(','),
  ...missing.map(item => csvHeader.map(key => csvEscape(item[key])).join(',')),
].join('\n') + '\n');

console.log(JSON.stringify({ jsonPath, mdPath, csvPath, counts: report.counts }, null, 2));
