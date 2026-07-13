#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const DEFAULT_COLLECTION = 'transactions';
const REPORT_DIR = 'migration-backups';
const DEFAULT_MAX_EXAMPLES = 100;
const ENTRADA_TYPE = 'Entrada de Caixa / Contas a Receber';

const usage = `
Usage:
  node scripts/fix-wix-invoice-direction.mjs [options]

Options:
  --input <path>        Firestore backup JSON to inspect. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>          JSON report path. Default: migration-backups/wix-invoice-direction-fix-<timestamp>.json
  --project <id>        Firebase project id for --apply. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>   Collection name inside the backup. Default: ${DEFAULT_COLLECTION}
  --max-examples <n>    Max examples stored in the report. Default: ${DEFAULT_MAX_EXAMPLES}
  --include-excluded    Include records marked isExcluded=true. Default: skip them because the app hides them.
  --apply               Apply planned field patches to Firestore. Without this flag the script is dry-run only.
  --help                Show this help.

This script fixes only Wix invoice direction fields. Wix invoices are always
Entrada de Caixa. It does not delete records and does not modify non-Wix docs.
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collection: DEFAULT_COLLECTION,
    maxExamples: DEFAULT_MAX_EXAMPLES,
    includeExcluded: false,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--max-examples') args.maxExamples = Number(argv[++index]);
    else if (arg === '--include-excluded') args.includeExcluded = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage.trim());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(args.maxExamples) || args.maxExamples < 0) {
    throw new Error('--max-examples must be a non-negative number.');
  }

  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const clean = (value) => String(value ?? '').trim();
const normalizeKey = (value) => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

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

const parseMoneyValue = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;

  let raw = clean(value).replace(/[^\d,.-]/g, '');
  if (!raw) return 0;

  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',')) {
    raw = raw.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, '');
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstPositive = (values) => values.find((value) => Number.isFinite(value) && value > 0) || 0;

const isPaidStatus = (status) => ['pago', 'paga', 'recebido', 'quitado', 'liquidado', 'sim', 'ok', 's']
  .includes(normalizeKey(status));

const isWixInvoice = (id, data) => {
  const source = normalizeKey(data.source);
  const description = normalizeKey(data.description);
  const client = normalizeKey(data.client);
  const invoiceNumber = normalizeKey(data.wixInvoiceNumber);
  const entityId = normalizeKey(data.wixEntityId);

  return (
    source === 'wix' ||
    normalizeKey(id).startsWith('wix-inv-') ||
    Boolean(invoiceNumber) ||
    Boolean(entityId) ||
    description.includes('fatura wix') ||
    client.includes('fatura wix')
  );
};

const isWixInvoiceLike = (id, data) => {
  const description = normalizeKey(data.description);
  const client = normalizeKey(data.client);

  return (
    normalizeKey(id).startsWith('wix-inv-') ||
    Boolean(normalizeKey(data.wixInvoiceNumber)) ||
    description.includes('fatura wix') ||
    client.includes('fatura wix')
  );
};

const getOriginalAmount = (data) => firstPositive([
  parseMoneyValue(data.valorOriginal),
  parseMoneyValue(data.totalCobranca),
  parseMoneyValue(data.valueReceived),
  parseMoneyValue(data.valuePaid),
  parseMoneyValue(data.honorarios) + parseMoneyValue(data.valorExtra),
]);

const shouldBePatched = (id, data) => {
  const invoiceLike = isWixInvoiceLike(id, data);
  const type = normalizeKey(data.type);

  if (parseMoneyValue(data.valuePaid) > 0) return true;
  if (normalizeKey(data.movement) !== 'entrada') return true;
  if (invoiceLike && !type.includes('entrada') && !type.includes('receber')) return true;
  if (invoiceLike && normalizeKey(data.source) !== 'wix') return true;

  const amount = getOriginalAmount(data);
  if (invoiceLike && amount > 0 && parseMoneyValue(data.valorOriginal) <= 0) return true;
  if (invoiceLike && isPaidStatus(data.status) && amount > 0 && parseMoneyValue(data.valueReceived) <= 0) return true;

  return false;
};

const buildPatch = (id, data) => {
  const amount = getOriginalAmount(data);
  const invoiceLike = isWixInvoiceLike(id, data);
  const type = normalizeKey(data.type);
  const patch = {
    source: 'wix',
    movement: 'Entrada',
    valuePaid: 0,
    updatedAt: new Date().toISOString(),
  };

  if (invoiceLike || type.includes('saida') || type.includes('pagar')) patch.type = ENTRADA_TYPE;
  if (invoiceLike && amount > 0 && parseMoneyValue(data.valorOriginal) <= 0) patch.valorOriginal = amount;
  if (invoiceLike && isPaidStatus(data.status) && amount > 0 && parseMoneyValue(data.valueReceived) <= 0) {
    patch.valueReceived = amount;
  }
  if (!clean(data.description) && clean(data.wixInvoiceNumber)) {
    patch.description = `Fatura Wix #${clean(data.wixInvoiceNumber)}`;
  }

  return patch;
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

const buildMarkdown = (report) => {
  const lines = [
    '# Wix Invoice Direction Fix',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    '',
    '## Counts',
    '',
    `- Wix docs inspected: ${report.counts.wixDocuments}`,
    `- Planned patches: ${report.counts.plannedPatches}`,
    `- Applied patches: ${report.counts.appliedPatches}`,
    `- Failed patches: ${report.counts.failedPatches}`,
    '',
    '## Notes',
    '',
    ...report.notes.map((note) => `- ${note}`),
  ];

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatestBackup());
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error('No Firestore backup found. Run npm run backup:firestore first or pass --input.');
  }

  const stamp = timestampForFile();
  const outPath = resolve(args.out || `${REPORT_DIR}/wix-invoice-direction-fix-${stamp}.json`);
  const markdownPath = outPath.replace(/\.json$/i, '.md');
  mkdirSync(dirname(outPath), { recursive: true });

  const documents = loadDocuments(inputPath, args.collection);
  const planned = [];
  let wixDocuments = 0;

  for (const document of documents) {
    const id = clean(document.id);
    const data = document.data || document;
    if (!id) continue;
    if (!args.includeExcluded && data.isExcluded === true) continue;
    if (!isWixInvoice(id, data)) continue;

    wixDocuments += 1;
    if (!shouldBePatched(id, data)) continue;

    planned.push({
      id,
      path: document.path || `${args.collection}/${id}`,
      documentPath: `${args.collection}/${encodeURIComponent(id)}`,
      client: clean(data.client),
      description: clean(data.description),
      wixInvoiceNumber: clean(data.wixInvoiceNumber),
      before: {
        movement: data.movement,
        type: data.type,
        status: data.status,
        valorOriginal: data.valorOriginal,
        valueReceived: data.valueReceived,
        valuePaid: data.valuePaid,
        source: data.source,
      },
      patch: buildPatch(id, data),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    inputPath,
    outPath,
    projectId: args.projectId,
    collection: args.collection,
    counts: {
      documentsInspected: documents.length,
      wixDocuments,
      plannedPatches: planned.length,
      appliedPatches: 0,
      failedPatches: 0,
    },
    examples: planned.slice(0, args.maxExamples),
    failures: [],
    notes: [
      'Wix invoices are forced to Entrada de Caixa / Contas a Receber.',
      'valuePaid is cleared for Wix invoices so they cannot appear as Saida.',
      'No non-Wix document is changed by this script.',
    ],
  };

  if (!args.apply) {
    report.notes.push('Dry-run only. Re-run with --apply to write planned patches to Firestore.');
  }

  const token = args.apply ? getAccessToken() : '';
  if (args.apply) {
    for (const item of planned) {
      try {
        await patchDocumentFields(args.projectId, item.documentPath, token, item.patch);
        report.counts.appliedPatches += 1;
      } catch (error) {
        report.counts.failedPatches += 1;
        report.failures.push({
          id: item.id,
          path: item.documentPath,
          message: error.message || String(error),
        });
      }
    }
  }

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, buildMarkdown(report));

  console.log(`Wix invoice direction ${args.apply ? 'apply' : 'dry-run'} complete`);
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${markdownPath}`);
  console.log(`Wix docs inspected: ${report.counts.wixDocuments}`);
  console.log(`Planned patches: ${report.counts.plannedPatches}`);
  if (args.apply) {
    console.log(`Applied patches: ${report.counts.appliedPatches}`);
    console.log(`Failed patches: ${report.counts.failedPatches}`);
  }

  if (args.apply && report.counts.failedPatches > 0) process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
