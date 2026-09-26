#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const input = getArg('--input');
const since = getArg('--since', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
const out = getArg('--out', `migration-backups/jotform-events-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Uso: node scripts/audit-jotform-events.mjs --input <backup.json> [--since <ISO>] [--out <relatorio.json>]');
  process.exit(0);
}
if (!input) throw new Error('Informe --input <backup Firestore JSON>');
if (!Number.isFinite(Date.parse(since))) throw new Error('--since deve ser uma data ISO valida');

const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
const asDate = value => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '');
const isFailure = event => String(event.status || '').toLowerCase() === 'error'
  || ['invalid_payload', 'error'].includes(String(event.action || '').toLowerCase());
const isSuccess = event => ['entry_created', 'entry_updated', 'payment_updated'].includes(String(event.action || '').toLowerCase())
  && !isFailure(event);

const backupPath = resolve(input);
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const collection = (backup.collections || []).find(item => item.name === 'jotformEvents');
if (!collection) {
  throw new Error('Backup sem a colecao jotformEvents. Gere um novo backup com npm run backup:firestore.');
}

const cutoff = Date.parse(since);
const events = (collection.documents || [])
  .map(document => ({ id: document.id, ...(document.data || {}) }))
  .filter(event => Date.parse(event.receivedAt || event.updatedAt || '') >= cutoff)
  .sort((left, right) => Date.parse(right.receivedAt || right.updatedAt || 0) - Date.parse(left.receivedAt || left.updatedAt || 0));
const failures = events.filter(isFailure);
const successes = events.filter(isSuccess);
const byReason = failures.reduce((counts, event) => {
  const reason = String(event.error || event.reason || event.action || 'sem_motivo');
  counts[reason] = (counts[reason] || 0) + 1;
  return counts;
}, {});

const report = {
  generatedAt: new Date().toISOString(),
  input: backupPath,
  backupGeneratedAt: backup.generatedAt || '',
  since: new Date(cutoff).toISOString(),
  counts: {
    events: events.length,
    successful: successes.length,
    failed: failures.length,
    unclassified: events.length - successes.length - failures.length,
  },
  failuresByReason: byReason,
  failures: failures.map(event => ({
    eventId: event.id,
    receivedAt: asDate(event.receivedAt || event.updatedAt),
    submissionId: event.submissionId || '',
    action: event.action || '',
    status: event.status || '',
    reason: event.reason || '',
    error: event.error || '',
    movimentacao: event.movimentacao || '',
    dueDate: event.dueDate || '',
    amount: Number(event.amount || 0),
    docPago: event.docPago || '',
  })),
};

const jsonPath = resolve(out);
const mdPath = jsonPath.replace(/\.json$/i, '.md');
const csvPath = jsonPath.replace(/\.json$/i, '.csv');
mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(mdPath, [
  '# Auditoria de eventos Jotform', '',
  `- Gerado em: ${report.generatedAt}`,
  `- Backup: ${report.input}`,
  `- Eventos desde: ${report.since}`,
  `- Eventos analisados: ${report.counts.events}`,
  `- Sucessos: ${report.counts.successful}`,
  `- Falhas: ${report.counts.failed}`,
  `- Sem classificacao: ${report.counts.unclassified}`, '',
  '## Falhas por motivo', '',
  ...(Object.keys(byReason).length ? Object.entries(byReason).map(([reason, count]) => `- ${reason}: ${count}`) : ['- Nenhuma']), '',
  '## Eventos com falha', '',
  '| Recebido | Submission ID | Acao | Motivo | Movimentacao | Valor | Doc.Pago |',
  '|---|---|---|---|---|---:|---|',
  ...(report.failures.length ? report.failures.map(event => `| ${event.receivedAt} | ${event.submissionId || '-'} | ${event.action || '-'} | ${(event.error || event.reason || '-').replace(/\|/g, '/')} | ${event.movimentacao.replace(/\|/g, '/')} | ${event.amount.toFixed(2)} | ${event.docPago || '-'} |`) : ['| - | - | - | Nenhuma | - | 0.00 | - |']), '',
].join('\n'));
const columns = ['eventId', 'receivedAt', 'submissionId', 'action', 'status', 'reason', 'error', 'movimentacao', 'dueDate', 'amount', 'docPago'];
writeFileSync(csvPath, `${columns.join(',')}\n${report.failures.map(event => columns.map(column => csvEscape(event[column])).join(',')).join('\n')}\n`);

console.log(JSON.stringify({ jsonPath, mdPath, csvPath, counts: report.counts, failuresByReason: byReason }, null, 2));
