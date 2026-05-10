#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const REPORT_DIR = 'migration-backups';
const DEFAULT_COLLECTION = 'transactions';
const DEFAULT_MAX_EXAMPLES = 50;
const DEFAULT_ONLY = ['updatedAt', 'dates', 'status', 'movement', 'money', 'totals'];
const OPTIONAL_GROUPS = ['paymentDates', 'directions', 'business', 'recommended', 'totalComponents'];

const usage = `
Usage:
  node scripts/normalize-transactions-data.mjs [options]

Options:
  --input <path>        Firestore backup JSON to inspect. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>          JSON report path. Default: migration-backups/transaction-normalization-plan-<timestamp>.json
  --project <id>        Firebase project id for --apply. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>   Collection name inside the backup. Default: ${DEFAULT_COLLECTION}
  --only <list>         Comma-separated groups: updatedAt,dates,status,movement,money,totals,paymentDates,directions,business,recommended,totalComponents. Default: ${DEFAULT_ONLY.join(',')}
  --limit <n>           Limit number of documents processed. Useful for staged apply.
  --max-examples <n>    Max examples stored per field. Default: ${DEFAULT_MAX_EXAMPLES}
  --include-excluded    Include records marked isExcluded=true. Default: skip them because the app hides them.
  --apply               Apply planned changes to Firestore. Without this flag the script is dry-run only.
  --help                Show this help.

The script only performs safe normalization:
- missing/invalid updatedAt -> Firestore document updateTime/createTime
- parseable date fields -> YYYY-MM-DD
- supported status aliases -> Pago/Pendente/Agendado
- supported movement aliases -> Entrada/Saida
- parseable money text in numeric fields -> number
- missing receivable/payable totals when existing money fields provide a safe derived total
- status/paymentDate consistency when --only paymentDates is used
- duplicated bidirectional values when --only directions is used
- missing business fields from existing local fields, or explicit "não informado" placeholders
- missing recommended fields with explicit "não informado" placeholders
- small receivable component mismatches when totalCobranca safely matches valueReceived
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collection: DEFAULT_COLLECTION,
    only: [...DEFAULT_ONLY],
    limit: 0,
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
    else if (arg === '--only') args.only = String(argv[++index] || '').split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--limit') args.limit = Number(argv[++index]);
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

  const allowedGroups = new Set([...DEFAULT_ONLY, ...OPTIONAL_GROUPS]);
  for (const group of args.only) {
    if (!allowedGroups.has(group)) {
      throw new Error(`Unknown --only group: ${group}. Allowed: ${[...DEFAULT_ONLY, ...OPTIONAL_GROUPS].join(', ')}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 0) throw new Error('--limit must be a non-negative number.');
  if (!Number.isFinite(args.maxExamples) || args.maxExamples < 0) throw new Error('--max-examples must be a non-negative number.');

  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const clean = (value) => String(value ?? '').trim();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
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

const isValidIsoTimestamp = (value) => {
  const text = clean(value);
  if (!text) return false;
  return Number.isFinite(Date.parse(text));
};

const isValidIsoDate = (value) => {
  const text = clean(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const normalizeDate = (value) => {
  const text = clean(value).split(' ')[0];
  if (!text) return '';

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const normalized = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    return isValidIsoDate(normalized) ? normalized : '';
  }

  const br = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    const normalized = `${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    return isValidIsoDate(normalized) ? normalized : '';
  }

  return '';
};

const normalizeStatus = (value) => {
  const normalized = normalizeKey(value);
  if (!normalized) return '';
  if (normalized === 'pago') return 'Pago';
  if (normalized === 'pendente') return 'Pendente';
  if (normalized === 'agendado') return 'Agendado';
  if (['paga', 'sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(normalized)) return 'Pago';
  if (['nao', 'n', 'aberto', 'em aberto'].includes(normalized)) return 'Pendente';
  if (normalized === 'programado') return 'Agendado';
  return '';
};

const normalizeMovement = (value) => {
  const normalized = normalizeKey(value);
  if (!normalized) return '';
  if (normalized === 'entrada' || normalized === 'receita' || normalized === 'credito') return 'Entrada';
  if (normalized === 'saida' || normalized === 'despesa' || normalized === 'debito') return 'Sa\u00edda';
  return '';
};

const parseMoneyText = (value) => {
  if (typeof value === 'number') return { valid: Number.isFinite(value), value, changed: false };
  if (typeof value !== 'string' || !clean(value)) return { valid: true, value, changed: false };

  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return { valid: false, value, changed: false };

  return { valid: true, value: parsed, changed: parsed !== value };
};

const parseMoneyValue = (value) => {
  const parsed = parseMoneyText(value);
  if (!parsed.valid) return Number.NaN;
  if (parsed.value === undefined || parsed.value === null || parsed.value === '') return 0;
  return Number(parsed.value);
};

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const canonicalMovementKey = (value) => {
  const normalized = normalizeKey(value);
  if (normalized === 'entrada' || normalized === 'receita' || normalized === 'credito') return 'Entrada';
  if (normalized === 'saida' || normalized === 'despesa' || normalized === 'debito') return 'Saida';
  return '';
};

const firstClean = (...values) => values.map(clean).find(Boolean) || '';

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
  only: args.only,
  limit: args.limit,
  counts: {
    transactions: transactionCount,
    documentsInspected: 0,
    excludedSkipped: 0,
    documentsWithChanges: 0,
    fieldChanges: 0,
    appliedDocuments: 0,
    failedDocuments: 0,
  },
  changesByField: {},
  examplesByField: {},
  failures: [],
  notes: [],
});

const addExample = (report, field, example, maxExamples) => {
  if (!report.examplesByField[field]) report.examplesByField[field] = [];
  if (report.examplesByField[field].length < maxExamples) report.examplesByField[field].push(example);
};

const addChange = (changes, field, from, to) => {
  if (from === to) return;
  changes[field] = { from, to };
};

const buildChangesForDocument = (document, only) => {
  const data = document.data || {};
  const changes = {};
  const onlySet = new Set(only);

  if (onlySet.has('updatedAt')) {
    const fallbackUpdatedAt = clean(document.updateTime) || clean(document.createTime);
    if (fallbackUpdatedAt && (!data.updatedAt || !isValidIsoTimestamp(data.updatedAt))) {
      addChange(changes, 'updatedAt', data.updatedAt, fallbackUpdatedAt);
    }
  }

  if (onlySet.has('dates')) {
    for (const field of ['date', 'dueDate', 'paymentDate']) {
      if (!data[field] || isValidIsoDate(data[field])) continue;
      const normalized = normalizeDate(data[field]);
      if (normalized) addChange(changes, field, data[field], normalized);
    }
  }

  if (onlySet.has('status') && data.status) {
    const normalized = normalizeStatus(data.status);
    if (normalized) addChange(changes, 'status', data.status, normalized);
  }

  if (onlySet.has('movement') && data.movement) {
    const normalized = normalizeMovement(data.movement);
    if (normalized) addChange(changes, 'movement', data.movement, normalized);
  }

  if (onlySet.has('money')) {
    for (const field of ['valuePaid', 'valueReceived', 'honorarios', 'valorExtra', 'totalCobranca']) {
      const parsed = parseMoneyText(data[field]);
      if (parsed.valid && parsed.changed) addChange(changes, field, data[field], parsed.value);
    }
  }

  if (onlySet.has('totals')) {
    const movement = canonicalMovementKey(data.movement);
    const valuePaid = parseMoneyValue(data.valuePaid);
    const valueReceived = parseMoneyValue(data.valueReceived);
    const totalCobranca = parseMoneyValue(data.totalCobranca);
    const honorarios = parseMoneyValue(data.honorarios);
    const valorExtra = parseMoneyValue(data.valorExtra);

    if ([valuePaid, valueReceived, totalCobranca, honorarios, valorExtra].every(Number.isFinite)) {
      const expectedTotal = roundMoney(honorarios + valorExtra);
      if (movement === 'Entrada' && valueReceived === 0 && totalCobranca === 0 && expectedTotal > 0) {
        addChange(changes, 'totalCobranca', data.totalCobranca, expectedTotal);
      }
      if (movement === 'Entrada' && totalCobranca < 0 && expectedTotal > 0) {
        addChange(changes, 'totalCobranca', data.totalCobranca, expectedTotal);
      }
      if (
        movement === 'Entrada'
        && valueReceived > 0
        && totalCobranca > 0
        && expectedTotal > 0
        && Math.abs(roundMoney(valueReceived) - expectedTotal) <= 0.01
        && Math.abs(roundMoney(totalCobranca) - expectedTotal) > 0.01
      ) {
        addChange(changes, 'totalCobranca', data.totalCobranca, expectedTotal);
      }
      if (movement === 'Saida' && valuePaid === 0 && valueReceived === 0) {
        const payableFallback = totalCobranca > 0 ? totalCobranca : expectedTotal;
        if (payableFallback > 0) addChange(changes, 'valuePaid', data.valuePaid, payableFallback);
      }
    }
  }

  if (onlySet.has('totalComponents')) {
    const movement = canonicalMovementKey(data.movement);
    const normalizedStatus = normalizeStatus(data.status);
    const valueReceived = parseMoneyValue(data.valueReceived);
    const totalCobranca = parseMoneyValue(data.totalCobranca);
    const honorarios = parseMoneyValue(data.honorarios);
    const valorExtra = parseMoneyValue(data.valorExtra);

    if ([valueReceived, totalCobranca, honorarios, valorExtra].every(Number.isFinite)) {
      const expectedTotal = roundMoney(honorarios + valorExtra);
      const difference = roundMoney(totalCobranca - expectedTotal);
      const receivedMatchesTotal = Math.abs(roundMoney(valueReceived) - roundMoney(totalCobranca)) <= 0.01;
      const smallDifference = Math.abs(difference) <= 5;

      if (
        movement === 'Entrada'
        && normalizedStatus === 'Pago'
        && receivedMatchesTotal
        && totalCobranca > 0
        && expectedTotal > 0
        && Math.abs(difference) > 0.01
        && smallDifference
      ) {
        if (difference < 0 && valorExtra === 0) {
          addChange(changes, 'honorarios', data.honorarios, totalCobranca);
        } else {
          const adjustedExtra = roundMoney(totalCobranca - honorarios);
          if (adjustedExtra >= 0) addChange(changes, 'valorExtra', data.valorExtra, adjustedExtra);
        }
      }
    }
  }

  if (onlySet.has('paymentDates')) {
    const normalizedStatus = normalizeStatus(data.status);
    if (normalizedStatus === 'Pago' && !clean(data.paymentDate)) {
      const normalizedPaymentDate = isValidIsoDate(data.date) ? data.date : normalizeDate(data.date);
      if (normalizedPaymentDate) addChange(changes, 'paymentDate', data.paymentDate, normalizedPaymentDate);
    }

    if ((normalizedStatus === 'Pendente' || normalizedStatus === 'Agendado') && clean(data.paymentDate)) {
      addChange(changes, 'paymentDate', data.paymentDate, '');
    }
  }

  if (onlySet.has('directions')) {
    const movement = canonicalMovementKey(data.movement);
    const valuePaid = parseMoneyValue(data.valuePaid);
    const valueReceived = parseMoneyValue(data.valueReceived);

    if (Number.isFinite(valuePaid) && Number.isFinite(valueReceived) && valuePaid > 0 && valueReceived > 0) {
      if (movement === 'Entrada') addChange(changes, 'valuePaid', data.valuePaid, 0);
      if (movement === 'Saida') addChange(changes, 'valueReceived', data.valueReceived, 0);
    }
  }

  if (onlySet.has('business')) {
    const movement = canonicalMovementKey(data.movement);

    if (!clean(data.client)) {
      const fallbackClient = movement === 'Saida'
        ? firstClean(data.observacaoAPagar, data.description, data.paidBy, 'Favorecido não informado')
        : firstClean(data.description, 'Cliente não informado');
      addChange(changes, 'client', data.client, fallbackClient);
    }

    if (!clean(data.bankAccount)) {
      addChange(changes, 'bankAccount', data.bankAccount, 'Conta não informada');
    }
  }

  if (onlySet.has('recommended')) {
    if (!clean(data.paidBy)) {
      addChange(changes, 'paidBy', data.paidBy, 'Não informado');
    }
  }

  return changes;
};

const buildMarkdown = (report) => {
  const lines = [
    '# Transaction Normalization Plan',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    `Collection: ${report.collection}`,
    `Transactions in backup: ${report.counts.transactions}`,
    `Documents inspected: ${report.counts.documentsInspected}`,
    `Excluded skipped: ${report.counts.excludedSkipped}`,
    `Documents with planned changes: ${report.counts.documentsWithChanges}`,
    `Field changes: ${report.counts.fieldChanges}`,
    `Applied documents: ${report.counts.appliedDocuments}`,
    `Failed documents: ${report.counts.failedDocuments}`,
    '',
    '## Changes By Field',
    '',
  ];

  const fields = Object.entries(report.changesByField).sort((left, right) => right[1] - left[1]);
  if (fields.length === 0) lines.push('No changes planned.');
  for (const [field, count] of fields) lines.push(`- ${field}: ${count}`);

  lines.push('', '## Examples', '');
  for (const [field, examples] of Object.entries(report.examplesByField)) {
    lines.push(`### ${field}`, '');
    for (const example of examples.slice(0, 10)) {
      lines.push(`- ${example.id}: ${JSON.stringify(example.from)} -> ${JSON.stringify(example.to)}`);
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
      : 'Apply mode was used. Review appliedDocuments and failures before continuing.',
  );

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

  const outPath = resolve(args.out || `${REPORT_DIR}/transaction-normalization-plan-${timestampForFile()}.json`);
  const documents = loadDocuments(inputPath, args.collection);
  const report = createReport({ inputPath, outPath, args, transactionCount: documents.length });
  const token = args.apply ? getAccessToken() : '';
  const limit = args.limit > 0 ? args.limit : documents.length;

  for (const document of documents.slice(0, limit)) {
    report.counts.documentsInspected += 1;

    if (!args.includeExcluded && document.data?.isExcluded === true) {
      report.counts.excludedSkipped += 1;
      continue;
    }

    const changes = buildChangesForDocument(document, args.only);
    const fields = Object.keys(changes);
    if (fields.length === 0) continue;

    report.counts.documentsWithChanges += 1;
    report.counts.fieldChanges += fields.length;

    for (const field of fields) {
      report.changesByField[field] = (report.changesByField[field] || 0) + 1;
      addExample(report, field, {
        id: document.id,
        path: document.path || '',
        from: changes[field].from,
        to: changes[field].to,
      }, args.maxExamples);
    }

    if (args.apply) {
      try {
        const updateFields = Object.fromEntries(fields.map((field) => [field, changes[field].to]));
        const documentPath = `${args.collection}/${encodeURIComponent(document.id)}`;
        await patchDocumentFields(args.projectId, documentPath, token, updateFields);
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

  if (!args.apply) report.notes.push('Dry-run only. Re-run with --apply to write planned changes to Firestore.');
  if (args.limit > 0) report.notes.push(`Processed first ${args.limit} documents only.`);

  writeReport(report);

  console.log(`Transaction normalization ${report.mode} complete`);
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${outPath.replace(/\.json$/i, '.md')}`);
  console.log(`Documents inspected: ${report.counts.documentsInspected}`);
  console.log(`Excluded skipped: ${report.counts.excludedSkipped}`);
  console.log(`Documents with changes: ${report.counts.documentsWithChanges}`);
  console.log(`Field changes: ${report.counts.fieldChanges}`);
  console.log(`Applied documents: ${report.counts.appliedDocuments}`);
  console.log(`Failed documents: ${report.counts.failedDocuments}`);

  if (args.apply && report.counts.failedDocuments > 0) process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
