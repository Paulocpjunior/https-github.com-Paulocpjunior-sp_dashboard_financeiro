#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ID = 'gen-lang-client-0888019226';
const DATABASE_ID = '(default)';
const CUTOVER_DATE = '2026-06-01';
const apply = process.argv.includes('--apply');
const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
const confirmCountArg = process.argv.find((arg) => arg.startsWith('--confirm-count='));

if (!inputArg) {
  throw new Error('Use --input=<backup.json> [--apply --confirm-count=<quantidade planejada>]');
}

const inputPath = path.resolve(inputArg.slice('--input='.length));
const backup = JSON.parse(readFileSync(inputPath, 'utf8'));
const transactions = backup.collections
  ?.find((collection) => collection.name === 'transactions')
  ?.documents ?? [];

const toLocalDate = (timestamp) => {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
};

const candidates = transactions
  .filter((document) => document.id?.startsWith('wix-inv-'))
  .filter((document) => document.data?.isExcluded !== true)
  .map((document) => ({
    document,
    sourceIssueDate: toLocalDate(document.createTime),
  }))
  .filter(({ sourceIssueDate }) => sourceIssueDate >= CUTOVER_DATE)
  .filter(({ document, sourceIssueDate }) => document.data?.date !== sourceIssueDate)
  .map(({ document, sourceIssueDate }) => ({
    id: document.id,
    invoiceNumber: document.data?.wixInvoiceNumber ?? document.id.replace('wix-inv-', ''),
    client: document.data?.client ?? '',
    beforeDate: document.data?.date ?? '',
    afterDate: sourceIssueDate,
    dueDate: document.data?.dueDate ?? '',
    paymentDate: document.data?.paymentDate ?? '',
    status: document.data?.status ?? '',
    updateTime: document.updateTime,
  }))
  .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));

if (apply) {
  const confirmedCount = Number(confirmCountArg?.slice('--confirm-count='.length));
  if (!Number.isSafeInteger(confirmedCount) || confirmedCount !== candidates.length) {
    throw new Error(`Aplicacao bloqueada: confirme exatamente ${candidates.length} alteracao(oes) com --confirm-count=${candidates.length}.`);
  }
}

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputDir = path.resolve('migration-backups', `wix-issue-date-reconciliation-${timestamp}`);
mkdirSync(outputDir, { recursive: true });

const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csvHeader = ['id', 'invoiceNumber', 'client', 'beforeDate', 'afterDate', 'dueDate', 'paymentDate', 'status'];
const csv = [
  csvHeader.join(','),
  ...candidates.map((item) => csvHeader.map((key) => escapeCsv(item[key])).join(',')),
].join('\n');

writeFileSync(path.join(outputDir, 'plan.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  inputPath,
  cutoverDate: CUTOVER_DATE,
  apply,
  count: candidates.length,
  changes: candidates,
}, null, 2));
writeFileSync(path.join(outputDir, 'plan.csv'), `${csv}\n`);

let token = '';
if (apply && candidates.length) {
  token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
}

const results = [];
for (const item of candidates) {
  if (!apply) {
    results.push({ id: item.id, status: 'planned' });
    continue;
  }

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE_ID)}/documents/transactions/${encodeURIComponent(item.id)}`,
  );
  url.searchParams.append('updateMask.fieldPaths', 'date');
  url.searchParams.set('currentDocument.updateTime', item.updateTime);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: { date: { stringValue: item.afterDate } } }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    results.push({ id: item.id, status: 'error', httpStatus: response.status, error: body.error?.message ?? body });
    continue;
  }
  results.push({ id: item.id, status: 'updated', updateTime: body.updateTime });
}

const updated = results.filter((result) => result.status === 'updated').length;
const errors = results.filter((result) => result.status === 'error');
writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ apply, updated, errors, results }, null, 2));

const markdown = [
  '# Reconciliacao de datas de emissao das Faturas Wix',
  '',
  `- Gerado em: ${new Date().toISOString()}`,
  `- Backup de origem: \`${inputPath}\``,
  `- Inicio da sincronizacao em tempo real: ${CUTOVER_DATE}`,
  `- Modo: ${apply ? 'APLICACAO' : 'SIMULACAO'}`,
  `- Alteracoes identificadas: ${candidates.length}`,
  `- Atualizacoes confirmadas: ${updated}`,
  `- Erros: ${errors.length}`,
  '',
  '| Fatura | Cliente | Antes | Emissao restaurada | Vencimento | Pagamento | Status |',
  '|---|---|---:|---:|---:|---:|---|',
  ...candidates.map((item) => `| ${item.invoiceNumber} | ${item.client.replaceAll('|', '/')} | ${item.beforeDate} | ${item.afterDate} | ${item.dueDate || '-'} | ${item.paymentDate || '-'} | ${item.status} |`),
  '',
].join('\n');
writeFileSync(path.join(outputDir, 'report.md'), markdown);

console.log(JSON.stringify({ outputDir, apply, planned: candidates.length, updated, errors: errors.length }, null, 2));
if (errors.length) process.exitCode = 1;
