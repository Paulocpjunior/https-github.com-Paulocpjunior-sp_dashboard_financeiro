#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const REPORT_DIR = 'migration-backups';
const DEFAULT_COLLECTION = 'transactions';
const DEFAULT_MAX_EXAMPLES = 50;
const REQUIRED_FIELDS = ['date', 'dueDate', 'type', 'status', 'movement', 'valuePaid', 'valueReceived'];
const MONEY_FIELDS = ['valuePaid', 'valueReceived', 'honorarios', 'valorExtra', 'totalCobranca'];

const usage = `
Usage:
  node scripts/quarantine-invalid-transactions.mjs [options]

Options:
  --input <path>        Firestore backup JSON to inspect. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>          JSON report path. Default: migration-backups/transaction-quarantine-plan-<timestamp>.json
  --project <id>        Firebase project id for --apply. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>   Collection name inside the backup. Default: ${DEFAULT_COLLECTION}
  --limit <n>           Limit number of documents inspected.
  --max-examples <n>    Max examples stored per reason. Default: ${DEFAULT_MAX_EXAMPLES}
  --apply               Apply planned isExcluded quarantine fields to Firestore. Without this flag the script is dry-run only.
  --help                Show this help.

This script does not delete documents or invent money values. It only plans a logical quarantine
for records that the app can already hide through isExcluded:
- zero-value Entrada/Saida transactions that have no financial amount to recover
- corrupt/empty stubs missing most required transaction fields
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collection: DEFAULT_COLLECTION,
    limit: 0,
    maxExamples: DEFAULT_MAX_EXAMPLES,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--limit') args.limit = Number(argv[++index]);
    else if (arg === '--max-examples') args.maxExamples = Number(argv[++index]);
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage.trim());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 0) throw new Error('--limit must be a non-negative number.');
  if (!Number.isFinite(args.maxExamples) || args.maxExamples < 0) {
    throw new Error('--max-examples must be a non-negative number.');
  }

  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const clean = (value) => String(value ?? '').trim();
const normalizeKey = (value) => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const findLatestBackup = () => {
  if (!existsSync(REPORT_DIR)) return '';

  return readdirSync(REPORT_DIR)
    .filter((name) => /^firestore-data-backup-.*\.json$/i.test(name))
    .map((name) => {
      const path = resolve(REPORT_DIR, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path || '';
};

const loadDocuments = (backupPath, collectionName) => {
  const payload = JSON.parse(readFileSync(backupPath, 'utf8'));
  const collection = Array.isArray(payload.collections)
    ? payload.collections.find((item) => item.name === collectionName)
    : null;

  if (collection?.documents) return collection.documents;
  if (payload[collectionName]?.documents) return payload[collectionName].documents;
  if (Array.isArray(payload[collectionName])) return payload[collectionName];
  if (Array.isArray(payload)) return payload;

  throw new Error(`Collection "${collectionName}" was not found in ${backupPath}.`);
};

const parseMoney = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'string' && clean(value)) return Number(value.replace(/\./g, '').replace(',', '.').trim());
  if (value === undefined || value === null || value === '') return 0;
  return Number.NaN;
};

const canonicalMovement = (value) => {
  const normalized = normalizeKey(value);
  if (normalized === 'entrada' || normalized === 'receita' || normalized === 'credito') return 'Entrada';
  if (normalized === 'saida' || normalized === 'despesa' || normalized === 'debito') return 'Saida';
  return '';
};

const allMoneyFieldsAreZero = (data) => MONEY_FIELDS.every((field) => parseMoney(data[field]) === 0);

const getMissingRequiredFields = (data) => REQUIRED_FIELDS.filter((field) => clean(data[field]) === '');

const classifyCandidate = (document) => {
  const data = document.data || {};
  if (data.isExcluded === true) return null;

  const missingRequiredFields = getMissingRequiredFields(data);
  const dedupe = clean(data._dedupe);
  const isKnownStub = /corrupt|empty-stub|legacy-v4-empty/i.test(dedupe);
  const isMostlyMissing = missingRequiredFields.length >= 5;

  if (isKnownStub || isMostlyMissing) {
    return {
      reason: isKnownStub ? 'known-empty-or-corrupt-stub' : 'missing-most-required-fields',
      details: {
        dedupe,
        missingRequiredFields,
        status: data.status || '',
        paymentDate: data.paymentDate || '',
      },
    };
  }

  const movement = canonicalMovement(data.movement);
  const valuePaid = parseMoney(data.valuePaid);
  const valueReceived = parseMoney(data.valueReceived);
  const totalCobranca = parseMoney(data.totalCobranca);

  if (!allMoneyFieldsAreZero(data)) return null;

  if (movement === 'Entrada' && valueReceived === 0 && totalCobranca === 0) {
    return {
      reason: 'zero-value-entrada',
      details: {
        movement: data.movement || '',
        status: data.status || '',
        date: data.date || '',
        dueDate: data.dueDate || '',
        paymentDate: data.paymentDate || '',
      },
    };
  }

  if (movement === 'Saida' && valuePaid === 0) {
    return {
      reason: 'zero-value-saida',
      details: {
        movement: data.movement || '',
        status: data.status || '',
        date: data.date || '',
        dueDate: data.dueDate || '',
        paymentDate: data.paymentDate || '',
      },
    };
  }

  return null;
};

const firestoreValue = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, firestoreValue(nested)])),
      },
    };
  }
  return { stringValue: String(value) };
};

const getAccessToken = () => {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN.trim();
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
};

const firestoreDocumentUrl = (projectId, documentPath) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(DEFAULT_DATABASE)}/documents/${documentPath}`;

const patchDocumentFields = async (projectId, documentPath, token, fields) => {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) params.append('updateMask.fieldPaths', fieldPath);

  const response = await fetch(`${firestoreDocumentUrl(projectId, documentPath)}?${params.toString()}`, {
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
    throw new Error(`Firestore patch failed (${response.status}) for ${documentPath}: ${body.slice(0, 500)}`);
  }
};

const createReport = ({ inputPath, outPath, args, transactionCount }) => ({
  generatedAt: new Date().toISOString(),
  mode: args.apply ? 'apply' : 'dry-run',
  inputPath,
  outPath,
  projectId: args.projectId,
  collection: args.collection,
  limit: args.limit,
  counts: {
    transactions: transactionCount,
    documentsInspected: 0,
    candidateDocuments: 0,
    alreadyExcludedDocuments: 0,
    appliedDocuments: 0,
    failedDocuments: 0,
  },
  candidatesByReason: {},
  candidates: [],
  examplesByReason: {},
  failures: [],
  notes: [],
});

const addExample = (report, reason, example, maxExamples) => {
  if (!report.examplesByReason[reason]) report.examplesByReason[reason] = [];
  if (report.examplesByReason[reason].length < maxExamples) report.examplesByReason[reason].push(example);
};

const buildMarkdown = (report) => {
  const lines = [
    '# Transaction Quarantine Plan',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    `Collection: ${report.collection}`,
    `Transactions in backup: ${report.counts.transactions}`,
    `Documents inspected: ${report.counts.documentsInspected}`,
    `Candidate documents: ${report.counts.candidateDocuments}`,
    `Already excluded documents skipped: ${report.counts.alreadyExcludedDocuments}`,
    `Applied documents: ${report.counts.appliedDocuments}`,
    `Failed documents: ${report.counts.failedDocuments}`,
    '',
    '## Candidates By Reason',
    '',
  ];

  const reasons = Object.entries(report.candidatesByReason).sort((left, right) => right[1] - left[1]);
  if (reasons.length === 0) lines.push('No quarantine candidates found.');
  for (const [reason, count] of reasons) lines.push(`- ${reason}: ${count}`);

  lines.push('', '## Examples', '');
  for (const [reason, examples] of Object.entries(report.examplesByReason)) {
    lines.push(`### ${reason}`, '');
    for (const example of examples.slice(0, 10)) {
      lines.push(`- ${example.id}: ${JSON.stringify(example.details)}`);
    }
    lines.push('');
  }

  if (report.failures.length > 0) {
    lines.push('## Failures', '');
    for (const failure of report.failures.slice(0, 25)) lines.push(`- ${failure.id}: ${failure.error}`);
  }

  lines.push(
    '',
    '## Safety',
    '',
    report.mode === 'dry-run'
      ? 'Dry-run only. No Firebase documents were changed.'
      : 'Apply mode was used. Documents were logically excluded with isExcluded=true; none were deleted.',
  );

  if (report.notes.length > 0) {
    lines.push('', '## Notes', '');
    for (const note of report.notes) lines.push(`- ${note}`);
  }

  return `${lines.join('\n')}\n`;
};

const writeReport = (report) => {
  mkdirSync(dirname(report.outPath), { recursive: true });
  writeFileSync(report.outPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(report.outPath.replace(/\.json$/i, '.md'), buildMarkdown(report));
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatestBackup());
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error('No Firestore backup found. Run npm run backup:firestore or pass --input <path>.');
  }

  const outPath = resolve(args.out || `${REPORT_DIR}/transaction-quarantine-plan-${timestampForFile()}.json`);
  const documents = loadDocuments(inputPath, args.collection);
  const report = createReport({ inputPath, outPath, args, transactionCount: documents.length });
  const token = args.apply ? getAccessToken() : '';
  const limit = args.limit > 0 ? args.limit : documents.length;
  const quarantineStamp = report.generatedAt;

  for (const document of documents.slice(0, limit)) {
    report.counts.documentsInspected += 1;

    if (document.data?.isExcluded === true) {
      report.counts.alreadyExcludedDocuments += 1;
      continue;
    }

    const candidate = classifyCandidate(document);
    if (!candidate) continue;

    report.counts.candidateDocuments += 1;
    report.candidatesByReason[candidate.reason] = (report.candidatesByReason[candidate.reason] || 0) + 1;
    report.candidates.push({
      id: document.id,
      path: document.path || '',
      reason: candidate.reason,
      details: candidate.details,
    });
    addExample(report, candidate.reason, {
      id: document.id,
      path: document.path || '',
      details: candidate.details,
    }, args.maxExamples);

    if (args.apply) {
      try {
        const fields = {
          isExcluded: true,
          exclusionReason: `data-quality:${candidate.reason}`,
          excludedAt: quarantineStamp,
          updatedAt: quarantineStamp,
        };
        const documentPath = `${args.collection}/${encodeURIComponent(document.id)}`;
        await patchDocumentFields(args.projectId, documentPath, token, fields);
        report.counts.appliedDocuments += 1;
      } catch (error) {
        report.counts.failedDocuments += 1;
        report.failures.push({
          id: document.id,
          path: document.path || '',
          error: error.message || String(error),
        });
      }
    }
  }

  if (!args.apply) report.notes.push('Dry-run only. Re-run with --apply to write planned quarantine fields to Firestore.');
  if (args.limit > 0) report.notes.push(`Processed first ${args.limit} documents only.`);

  writeReport(report);

  console.log(`Transaction quarantine ${report.mode} complete`);
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${outPath.replace(/\.json$/i, '.md')}`);
  console.log(`Documents inspected: ${report.counts.documentsInspected}`);
  console.log(`Candidate documents: ${report.counts.candidateDocuments}`);
  console.log(`Already excluded documents skipped: ${report.counts.alreadyExcludedDocuments}`);
  console.log(`Applied documents: ${report.counts.appliedDocuments}`);
  console.log(`Failed documents: ${report.counts.failedDocuments}`);

  if (args.apply && report.counts.failedDocuments > 0) process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
