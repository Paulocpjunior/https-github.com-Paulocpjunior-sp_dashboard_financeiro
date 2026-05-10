#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPORT_DIR = 'migration-backups';
const DEFAULT_COLLECTION = 'transactions';
const DEFAULT_MAX_EXAMPLES = 25;

const usage = `
Usage:
  node scripts/audit-transactions-data.mjs [options]

Options:
  --input <path>        Firestore backup JSON to audit. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>          JSON report path. Default: migration-backups/transaction-data-audit-<timestamp>.json
  --collection <name>   Collection name inside the backup. Default: ${DEFAULT_COLLECTION}
  --max-examples <n>    Max examples stored per finding code. Default: ${DEFAULT_MAX_EXAMPLES}
  --fail-on <severity>  Exit 1 when findings exist at or above severity: low, medium, high, critical.
  --help                Show this help.

This script reads a local Firestore backup and does not modify Firebase.
`;

const severityOrder = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const codeDescriptions = {
  MISSING_REQUIRED_FIELD: 'Required transaction field is missing or empty.',
  MISSING_BUSINESS_FIELD: 'Business classification field is missing or empty.',
  MISSING_RECOMMENDED_FIELD: 'Recommended transaction field is missing or empty.',
  ID_FIELD_MISMATCH: 'Document id differs from data.id.',
  DUPLICATE_DATA_ID: 'Multiple documents share the same data.id.',
  INVALID_DATE: 'Date field is not a valid ISO date.',
  DATE_NOT_NORMALIZED: 'Date field is valid only after normalization and should be saved as YYYY-MM-DD.',
  INVALID_TIMESTAMP: 'Timestamp field is not a valid ISO timestamp.',
  MISSING_UPDATED_AT: 'updatedAt is missing, which weakens lightweight refresh detection.',
  UNKNOWN_STATUS: 'Status is not one of the supported canonical values.',
  STATUS_ALIAS: 'Status uses a legacy alias and should be normalized.',
  UNKNOWN_MOVEMENT: 'Movement is not Entrada or Saida.',
  MOVEMENT_ALIAS: 'Movement uses a legacy spelling and should be normalized.',
  TYPE_MOVEMENT_MISMATCH: 'Type indicates one movement direction but movement has another.',
  NON_NUMERIC_VALUE: 'Money field is not numeric.',
  VALUE_AS_STRING: 'Money field is stored as text instead of a number.',
  NEGATIVE_VALUE: 'Money field has a negative value.',
  EMPTY_VALUES: 'Both valuePaid and valueReceived are zero.',
  BOTH_DIRECTIONS_VALUES: 'Both valuePaid and valueReceived are positive.',
  ENTRADA_WITHOUT_RECEIVABLE_VALUE: 'Entrada transaction has no receivable amount.',
  SAIDA_WITHOUT_PAYABLE_VALUE: 'Saida transaction has no payable amount.',
  PAID_WITHOUT_PAYMENT_DATE: 'Paid transaction has no paymentDate.',
  OPEN_WITH_PAYMENT_DATE: 'Open transaction has paymentDate filled.',
  TOTAL_COBRANCA_MISMATCH: 'totalCobranca differs from honorarios + valorExtra.',
};

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    collection: DEFAULT_COLLECTION,
    maxExamples: DEFAULT_MAX_EXAMPLES,
    failOn: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--max-examples') args.maxExamples = Number(argv[++index]);
    else if (arg === '--fail-on') args.failOn = String(argv[++index] || '').toLowerCase();
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

  if (args.failOn && !severityOrder[args.failOn]) {
    throw new Error('--fail-on must be one of: low, medium, high, critical.');
  }

  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const clean = (value) => String(value ?? '').trim();
const normalizeKey = (value) => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isEmpty = (value) => value === undefined || value === null || clean(value) === '';
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const findLatestBackup = () => {
  if (!existsSync(REPORT_DIR)) return '';

  const candidates = readdirSync(REPORT_DIR)
    .filter((name) => /^firestore-data-backup-.*\.json$/i.test(name))
    .map((name) => {
      const path = resolve(REPORT_DIR, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]?.path || '';
};

const loadTransactions = (backupPath, collectionName) => {
  const payload = JSON.parse(readFileSync(backupPath, 'utf8'));
  if (Array.isArray(payload)) return payload;

  const collection = Array.isArray(payload.collections)
    ? payload.collections.find((item) => item.name === collectionName)
    : null;

  if (collection?.documents) return collection.documents;
  if (payload[collectionName]?.documents) return payload[collectionName].documents;
  if (Array.isArray(payload[collectionName])) return payload[collectionName];

  throw new Error(`Collection "${collectionName}" was not found in ${backupPath}.`);
};

const parseMoney = (value) => {
  if (typeof value === 'number') {
    return { value, valid: Number.isFinite(value), storedAsString: false };
  }

  if (typeof value === 'string' && clean(value)) {
    const normalized = value.replace(/\./g, '').replace(',', '.').trim();
    const parsed = Number(normalized);
    return { value: parsed, valid: Number.isFinite(parsed), storedAsString: true };
  }

  if (value === undefined || value === null || value === '') {
    return { value: 0, valid: true, storedAsString: false, empty: true };
  }

  return { value: Number.NaN, valid: false, storedAsString: false };
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

const couldNormalizeToIsoDate = (value) => {
  const text = clean(value).split(' ')[0];
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return true;
  return false;
};

const isValidIsoTimestamp = (value) => {
  const text = clean(value);
  if (!text) return false;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp);
};

const canonicalStatus = (value) => {
  const normalized = normalizeKey(value);
  if (['pago'].includes(normalized)) return { canonical: 'Pago', alias: false };
  if (['pendente'].includes(normalized)) return { canonical: 'Pendente', alias: false };
  if (['agendado'].includes(normalized)) return { canonical: 'Agendado', alias: false };
  if (['sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(normalized)) return { canonical: 'Pago', alias: true };
  if (['nao', 'n', 'aberto', 'em aberto'].includes(normalized)) return { canonical: 'Pendente', alias: true };
  if (['programado'].includes(normalized)) return { canonical: 'Agendado', alias: true };
  return { canonical: '', alias: false };
};

const canonicalMovement = (value) => {
  const normalized = normalizeKey(value);
  if (normalized === 'entrada') return { canonical: 'Entrada', alias: clean(value) !== 'Entrada' };
  if (normalized === 'saida') return { canonical: 'Saida', alias: false };
  if (['receita', 'credito'].includes(normalized)) return { canonical: 'Entrada', alias: true };
  if (['despesa', 'debito'].includes(normalized)) return { canonical: 'Saida', alias: true };
  return { canonical: '', alias: false };
};

const expectedMovementFromType = (type) => {
  const normalized = normalizeKey(type);
  if (normalized.includes('entrada') || normalized.includes('receber')) return 'Entrada';
  if (normalized.includes('saida') || normalized.includes('pagar')) return 'Saida';
  return '';
};

const createReport = ({ inputPath, collectionName, maxExamples, transactionCount }) => ({
  generatedAt: new Date().toISOString(),
  inputPath,
  collection: collectionName,
  counts: {
    transactions: transactionCount,
    findings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  },
  findingsByCode: {},
  nextActions: [],
  limits: {
    maxExamplesPerCode: maxExamples,
  },
});

const addFinding = (report, severity, code, document, message, details = {}) => {
  report.counts.findings += 1;
  report.counts[severity] += 1;

  if (!report.findingsByCode[code]) {
    report.findingsByCode[code] = {
      severity,
      code,
      description: codeDescriptions[code] || message,
      count: 0,
      examples: [],
    };
  }

  const bucket = report.findingsByCode[code];
  bucket.count += 1;

  if (bucket.examples.length < report.limits.maxExamplesPerCode) {
    bucket.examples.push({
      id: document.id,
      path: document.path || '',
      message,
      details,
    });
  }
};

const buildNextActions = (report) => {
  const codes = new Set(Object.keys(report.findingsByCode));
  const actions = [];

  if (codes.has('INVALID_DATE') || codes.has('DATE_NOT_NORMALIZED')) {
    actions.push('Normalize transaction date fields to YYYY-MM-DD before relying on server-side date queries.');
  }
  if (codes.has('MISSING_REQUIRED_FIELD') || codes.has('MISSING_BUSINESS_FIELD')) {
    actions.push('Fill missing transaction fields, prioritizing dates, type, movement, status, and money values before display-only classifications.');
  }
  if (codes.has('UNKNOWN_STATUS') || codes.has('STATUS_ALIAS')) {
    actions.push('Normalize status values to Pago, Pendente, or Agendado.');
  }
  if (codes.has('UNKNOWN_MOVEMENT') || codes.has('TYPE_MOVEMENT_MISMATCH') || codes.has('MOVEMENT_ALIAS')) {
    actions.push('Normalize movement values and align them with the transaction type.');
  }
  if (codes.has('NON_NUMERIC_VALUE') || codes.has('VALUE_AS_STRING') || codes.has('NEGATIVE_VALUE')) {
    actions.push('Fix money fields so calculations use numeric non-negative values.');
  }
  if (codes.has('MISSING_UPDATED_AT')) {
    actions.push('Backfill updatedAt on legacy transactions before depending on lightweight refresh fingerprints for manual edits outside the app.');
  }
  if (codes.has('ID_FIELD_MISMATCH') || codes.has('DUPLICATE_DATA_ID')) {
    actions.push('Repair transaction ids before adding migration scripts that address documents by data.id.');
  }

  if (actions.length === 0) actions.push('No blocking transaction data quality issues were found in the audited backup.');
  return actions;
};

const auditDocument = (report, document, seenDataIds) => {
  const data = document.data || document;
  const docId = clean(document.id || data.id);
  const dataId = clean(data.id);
  const subject = { id: docId || dataId || '(missing id)', path: document.path || '' };

  const requiredFields = ['date', 'dueDate', 'type', 'status', 'movement', 'valuePaid', 'valueReceived'];
  for (const field of requiredFields) {
    if (isEmpty(data[field])) {
      addFinding(report, 'high', 'MISSING_REQUIRED_FIELD', subject, `${field} is missing.`, { field });
    }
  }

  for (const field of ['bankAccount', 'client']) {
    if (isEmpty(data[field])) {
      addFinding(report, 'medium', 'MISSING_BUSINESS_FIELD', subject, `${field} is missing.`, { field });
    }
  }

  for (const field of ['paidBy']) {
    if (isEmpty(data[field])) {
      addFinding(report, 'low', 'MISSING_RECOMMENDED_FIELD', subject, `${field} is missing.`, { field });
    }
  }

  if (docId && dataId && docId !== dataId) {
    addFinding(report, 'high', 'ID_FIELD_MISMATCH', subject, 'Document id differs from data.id.', {
      documentId: docId,
      dataId,
    });
  }

  if (dataId) {
    const previous = seenDataIds.get(dataId);
    if (previous && previous !== docId) {
      addFinding(report, 'high', 'DUPLICATE_DATA_ID', subject, 'data.id is duplicated across documents.', {
        dataId,
        firstDocumentId: previous,
        duplicateDocumentId: docId,
      });
    } else {
      seenDataIds.set(dataId, docId);
    }
  }

  for (const field of ['date', 'dueDate', 'paymentDate']) {
    if (isEmpty(data[field])) continue;
    if (isValidIsoDate(data[field])) continue;

    const code = couldNormalizeToIsoDate(data[field]) ? 'DATE_NOT_NORMALIZED' : 'INVALID_DATE';
    const severity = code === 'INVALID_DATE' ? 'high' : 'medium';
    addFinding(report, severity, code, subject, `${field} is not stored as YYYY-MM-DD.`, {
      field,
      value: data[field],
    });
  }

  if (isEmpty(data.updatedAt)) {
    addFinding(report, 'low', 'MISSING_UPDATED_AT', subject, 'updatedAt is missing.', {});
  } else if (!isValidIsoTimestamp(data.updatedAt)) {
    addFinding(report, 'medium', 'INVALID_TIMESTAMP', subject, 'updatedAt is not a valid timestamp.', {
      field: 'updatedAt',
      value: data.updatedAt,
    });
  }

  const status = canonicalStatus(data.status);
  if (!status.canonical && !isEmpty(data.status)) {
    addFinding(report, 'medium', 'UNKNOWN_STATUS', subject, 'Status is not supported.', {
      status: data.status,
    });
  } else if (status.alias) {
    addFinding(report, 'medium', 'STATUS_ALIAS', subject, 'Status should be normalized.', {
      status: data.status,
      canonical: status.canonical,
    });
  }

  const movement = canonicalMovement(data.movement);
  if (!movement.canonical && !isEmpty(data.movement)) {
    addFinding(report, 'high', 'UNKNOWN_MOVEMENT', subject, 'Movement is not supported.', {
      movement: data.movement,
    });
  } else if (movement.alias) {
    addFinding(report, 'medium', 'MOVEMENT_ALIAS', subject, 'Movement should be normalized.', {
      movement: data.movement,
      canonical: movement.canonical,
    });
  }

  const expectedMovement = expectedMovementFromType(data.type);
  if (expectedMovement && movement.canonical && expectedMovement !== movement.canonical) {
    addFinding(report, 'medium', 'TYPE_MOVEMENT_MISMATCH', subject, 'Type and movement disagree.', {
      type: data.type,
      movement: data.movement,
      expectedMovement,
    });
  }

  const money = {};
  for (const field of ['valuePaid', 'valueReceived', 'honorarios', 'valorExtra', 'totalCobranca']) {
    const parsed = parseMoney(data[field]);
    money[field] = parsed.value;

    if (!parsed.valid) {
      addFinding(report, 'high', 'NON_NUMERIC_VALUE', subject, `${field} is not numeric.`, {
        field,
        value: data[field],
      });
      continue;
    }

    if (parsed.storedAsString) {
      addFinding(report, 'medium', 'VALUE_AS_STRING', subject, `${field} is stored as text.`, {
        field,
        value: data[field],
      });
    }

    if (!parsed.empty && parsed.value < 0) {
      addFinding(report, 'medium', 'NEGATIVE_VALUE', subject, `${field} is negative.`, {
        field,
        value: parsed.value,
      });
    }
  }

  const valuePaid = money.valuePaid || 0;
  const valueReceived = money.valueReceived || 0;
  const totalCobranca = money.totalCobranca || 0;
  const honorarios = money.honorarios || 0;
  const valorExtra = money.valorExtra || 0;

  if (valuePaid === 0 && valueReceived === 0 && totalCobranca === 0) {
    addFinding(report, 'medium', 'EMPTY_VALUES', subject, 'Transaction has no payable or receivable value.', {});
  }

  if (valuePaid > 0 && valueReceived > 0) {
    addFinding(report, 'medium', 'BOTH_DIRECTIONS_VALUES', subject, 'Transaction has both paid and received values.', {
      valuePaid,
      valueReceived,
    });
  }

  if (movement.canonical === 'Entrada' && valueReceived === 0 && totalCobranca === 0) {
    addFinding(report, 'high', 'ENTRADA_WITHOUT_RECEIVABLE_VALUE', subject, 'Entrada has no receivable value.', {
      valueReceived,
      totalCobranca,
    });
  }

  if (movement.canonical === 'Saida' && valuePaid === 0) {
    addFinding(report, 'high', 'SAIDA_WITHOUT_PAYABLE_VALUE', subject, 'Saida has no payable value.', {
      valuePaid,
    });
  }

  if (status.canonical === 'Pago' && isEmpty(data.paymentDate)) {
    addFinding(report, 'medium', 'PAID_WITHOUT_PAYMENT_DATE', subject, 'Paid transaction has no paymentDate.', {});
  }

  if ((status.canonical === 'Pendente' || status.canonical === 'Agendado') && !isEmpty(data.paymentDate)) {
    addFinding(report, 'medium', 'OPEN_WITH_PAYMENT_DATE', subject, 'Open transaction has paymentDate filled.', {
      status: data.status,
      paymentDate: data.paymentDate,
    });
  }

  if (totalCobranca > 0) {
    const expectedTotal = roundMoney(honorarios + valorExtra);
    if (expectedTotal > 0 && Math.abs(roundMoney(totalCobranca) - expectedTotal) > 0.01) {
      addFinding(report, 'low', 'TOTAL_COBRANCA_MISMATCH', subject, 'totalCobranca differs from honorarios + valorExtra.', {
        totalCobranca,
        honorarios,
        valorExtra,
        expectedTotal,
      });
    }
  }
};

const buildMarkdown = (report) => {
  const sortedCodes = Object.values(report.findingsByCode)
    .sort((left, right) => {
      const severityDiff = severityOrder[right.severity] - severityOrder[left.severity];
      if (severityDiff !== 0) return severityDiff;
      return right.count - left.count;
    });

  const lines = [
    '# Transaction Data Audit',
    '',
    `Generated at: ${report.generatedAt}`,
    `Input: ${report.inputPath}`,
    `Collection: ${report.collection}`,
    `Transactions audited: ${report.counts.transactions}`,
    `Findings: ${report.counts.findings}`,
    '',
    '## Severity',
    '',
    `- Critical: ${report.counts.critical}`,
    `- High: ${report.counts.high}`,
    `- Medium: ${report.counts.medium}`,
    `- Low: ${report.counts.low}`,
    '',
    '## Finding Types',
    '',
  ];

  if (sortedCodes.length === 0) {
    lines.push('No findings.');
  } else {
    for (const finding of sortedCodes) {
      lines.push(`- ${finding.severity.toUpperCase()} ${finding.code}: ${finding.count} - ${finding.description}`);
    }
  }

  lines.push('', '## Examples', '');

  for (const finding of sortedCodes.slice(0, 12)) {
    lines.push(`### ${finding.code}`, '');
    for (const example of finding.examples.slice(0, 5)) {
      lines.push(`- ${example.id}: ${example.message}`);
    }
    lines.push('');
  }

  lines.push('## Next Actions', '');
  for (const action of report.nextActions) lines.push(`- ${action}`);

  return `${lines.join('\n')}\n`;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatestBackup());
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error('No Firestore backup found. Run npm run backup:firestore or pass --input <path>.');
  }

  const stamp = timestampForFile();
  const outPath = resolve(args.out || `${REPORT_DIR}/transaction-data-audit-${stamp}.json`);
  const markdownPath = outPath.replace(/\.json$/i, '.md');
  const documents = loadTransactions(inputPath, args.collection);
  const report = createReport({
    inputPath,
    collectionName: args.collection,
    maxExamples: args.maxExamples,
    transactionCount: documents.length,
  });
  const seenDataIds = new Map();

  for (const document of documents) auditDocument(report, document, seenDataIds);

  report.nextActions = buildNextActions(report);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, buildMarkdown(report));

  console.log('Transaction data audit complete');
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${markdownPath}`);
  console.log(`Transactions: ${report.counts.transactions}`);
  console.log(`Findings: ${report.counts.findings}`);
  console.log(`Critical: ${report.counts.critical}`);
  console.log(`High: ${report.counts.high}`);
  console.log(`Medium: ${report.counts.medium}`);
  console.log(`Low: ${report.counts.low}`);

  if (args.failOn) {
    const threshold = severityOrder[args.failOn];
    const shouldFail = Object.entries(severityOrder).some(([severity, rank]) => (
      rank >= threshold && report.counts[severity] > 0
    ));
    if (shouldFail) process.exit(1);
  }
};

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
