#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const DEFAULT_COLLECTION = 'transactions';
const REPORT_DIR = 'migration-backups';

const usage = `
Usage:
  node scripts/fix-total-cobranca-mismatches.mjs [options]

Options:
  --input <path>        Firestore backup JSON. Default: latest migration-backups/firestore-data-backup-*.json
  --audit <path>        Finance integrity audit JSON. Default: latest finance-integrity-audit-*.json
  --out <path>          Plan JSON path. Default: migration-backups/total-cobranca-fix-plan-<timestamp>.json
  --project <id>        Firebase project id for --apply. Default: ${DEFAULT_PROJECT_ID}
  --apply               Apply planned field patches to Firestore. Without this flag the script is dry-run only.
  --help                Show this help.

This script fixes only TOTAL_COBRANCA_MISMATCH rows from the audit. It preserves the billed total
for legacy rows, and only recalculates totalCobranca for Jotform rows where honorarios + extras are
the canonical source.
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    audit: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--audit') args.audit = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage.trim());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const clean = (value) => String(value ?? '').trim();
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const findLatest = (pattern) => {
  if (!existsSync(REPORT_DIR)) return '';
  return readdirSync(REPORT_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const path = resolve(REPORT_DIR, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path || '';
};

const loadDocuments = (backupPath) => {
  const payload = JSON.parse(readFileSync(backupPath, 'utf8'));
  const collection = Array.isArray(payload.collections)
    ? payload.collections.find((item) => item.name === DEFAULT_COLLECTION)
    : null;
  if (!collection?.documents) throw new Error(`Collection "${DEFAULT_COLLECTION}" not found in ${backupPath}.`);
  return collection.documents;
};

const parseMoney = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;
  const normalized = text.replace(/[R$\s]/gi, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firestoreValue = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
};

const getAccessToken = () => {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN.trim();
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
};

const patchDocumentFields = async (projectId, docId, token, fields) => {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) params.append('updateMask.fieldPaths', fieldPath);
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(DEFAULT_DATABASE)}/documents/${DEFAULT_COLLECTION}/${encodeURIComponent(docId)}?${params.toString()}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)])),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore patch failed (${response.status}) for ${docId}: ${body.slice(0, 500)}`);
  }
};

const planForDocument = (doc) => {
  const data = doc.data || {};
  const honorarios = parseMoney(data.honorarios);
  const valorExtra = parseMoney(data.valorExtra ?? data.extras);
  const totalCobranca = parseMoney(data.totalCobranca);
  const valorOriginal = parseMoney(data.valorOriginal);
  const expected = roundMoney(honorarios + valorExtra);
  const diff = roundMoney(totalCobranca - expected);
  const updates = {};
  const source = clean(data.source).toLowerCase();

  if (!Number.isFinite(totalCobranca) || totalCobranca <= 0 || Math.abs(diff) <= 0.01) {
    return { updates, reason: 'no_action' };
  }

  if (source === 'jotform' && expected > 0 && totalCobranca < expected) {
    updates.totalCobranca = expected;
    if (valorOriginal === 0 || Math.abs(valorOriginal - totalCobranca) <= 0.01) {
      updates.valorOriginal = expected;
    }
    return { updates, reason: 'jotform_total_from_components' };
  }

  if (honorarios > 0 && totalCobranca >= honorarios) {
    updates.valorExtra = roundMoney(totalCobranca - honorarios);
    return { updates, reason: 'legacy_preserve_total_adjust_extra' };
  }

  if (honorarios === 0 && valorExtra > 0 && totalCobranca >= valorExtra && Math.abs(diff) <= 5) {
    updates.valorExtra = totalCobranca;
    return { updates, reason: 'legacy_preserve_total_adjust_extra' };
  }

  if (valorExtra > 0 && totalCobranca >= valorExtra) {
    updates.honorarios = roundMoney(totalCobranca - valorExtra);
    return { updates, reason: 'legacy_preserve_total_adjust_honorarios' };
  }

  return { updates, reason: 'unsafe_no_plan' };
};

const buildMarkdown = (report) => {
  const lines = [
    '# Total Cobranca Fix Plan',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    `Audit: ${report.auditPath}`,
    `Candidates: ${report.counts.candidates}`,
    `Planned documents: ${report.counts.plannedDocuments}`,
    `Planned field updates: ${report.counts.plannedFieldUpdates}`,
    `Applied documents: ${report.counts.appliedDocuments}`,
    `Failed documents: ${report.counts.failedDocuments}`,
    '',
    '## Planned Updates',
    '',
  ];

  if (report.planned.length === 0) lines.push('No safe updates planned.');
  for (const item of report.planned) {
    lines.push(`- ${item.id}: ${item.client} (${item.reason})`);
    for (const [field, value] of Object.entries(item.updates)) {
      lines.push(`  - ${field}: ${JSON.stringify(item.before[field])} -> ${JSON.stringify(value)}`);
    }
  }

  if (report.skipped.length > 0) {
    lines.push('', '## Skipped', '');
    for (const item of report.skipped) lines.push(`- ${item.id}: ${item.reason}`);
  }

  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of report.failures) lines.push(`- ${failure.id}: ${failure.error}`);
  }

  lines.push(
    '',
    '## Safety',
    '',
    report.mode === 'dry-run'
      ? 'Dry-run only. No Firebase documents were changed.'
      : 'Apply mode was used. Only planned financial component/total fields were patched.',
  );

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatest(/^firestore-data-backup-.*\.json$/i));
  const auditPath = resolve(args.audit || findLatest(/^finance-integrity-audit-.*\.json$/i));
  const outPath = resolve(args.out || `${REPORT_DIR}/total-cobranca-fix-plan-${timestampForFile()}.json`);

  if (!inputPath || !existsSync(inputPath)) throw new Error('No Firestore backup found.');
  if (!auditPath || !existsSync(auditPath)) throw new Error('No finance integrity audit found.');

  const docs = loadDocuments(inputPath);
  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
  const examples = audit.findingsByCode?.TOTAL_COBRANCA_MISMATCH?.examples || [];
  const ids = examples.map((example) => example.subject?.id).filter(Boolean);
  const token = args.apply ? getAccessToken() : '';
  const stamp = new Date().toISOString();

  const report = {
    generatedAt: stamp,
    mode: args.apply ? 'apply' : 'dry-run',
    inputPath,
    auditPath,
    outPath,
    counts: {
      candidates: ids.length,
      plannedDocuments: 0,
      plannedFieldUpdates: 0,
      appliedDocuments: 0,
      failedDocuments: 0,
    },
    planned: [],
    skipped: [],
    failures: [],
  };

  for (const id of ids) {
    const doc = docsById.get(id);
    if (!doc) {
      report.skipped.push({ id, reason: 'not_found_in_backup' });
      continue;
    }
    const { updates, reason } = planForDocument(doc);
    const updateFields = { ...updates, updatedAt: stamp };
    if (Object.keys(updates).length === 0) {
      report.skipped.push({ id, reason });
      continue;
    }

    const data = doc.data || {};
    const item = {
      id,
      client: data.client || data.description || '',
      dueDate: data.dueDate || '',
      status: data.status || '',
      reason,
      before: {
        honorarios: data.honorarios,
        valorExtra: data.valorExtra,
        extras: data.extras,
        totalCobranca: data.totalCobranca,
        valorOriginal: data.valorOriginal,
      },
      updates,
    };
    report.planned.push(item);
    report.counts.plannedDocuments += 1;
    report.counts.plannedFieldUpdates += Object.keys(updates).length;

    if (args.apply) {
      try {
        await patchDocumentFields(args.projectId, id, token, updateFields);
        report.counts.appliedDocuments += 1;
      } catch (error) {
        report.counts.failedDocuments += 1;
        report.failures.push({ id, error: error.message || String(error) });
      }
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(outPath.replace(/\.json$/i, '.md'), buildMarkdown(report));

  console.log(`Total cobranca fix ${report.mode} complete`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${outPath.replace(/\.json$/i, '.md')}`);
  console.log(`Candidates: ${report.counts.candidates}`);
  console.log(`Planned documents: ${report.counts.plannedDocuments}`);
  console.log(`Applied documents: ${report.counts.appliedDocuments}`);
  console.log(`Failed documents: ${report.counts.failedDocuments}`);

  if (args.apply && report.counts.failedDocuments > 0) process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
