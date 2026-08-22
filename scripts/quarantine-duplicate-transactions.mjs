#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const DEFAULT_COLLECTION = 'transactions';
const REPORT_DIR = 'migration-backups';
const DEFAULT_MAX_EXAMPLES = 50;

const usage = `
Usage:
  node scripts/quarantine-duplicate-transactions.mjs [options]

Options:
  --input <path>        Firestore backup JSON to inspect. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>          JSON report path. Default: migration-backups/transaction-duplicate-quarantine-plan-<timestamp>.json
  --project <id>        Firebase project id for --apply. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>   Collection name inside the backup. Default: ${DEFAULT_COLLECTION}
  --due-from <date>     Inspect only records with dueDate >= date.
  --due-to <date>       Inspect only records with dueDate <= date.
  --max-examples <n>    Max examples stored in the report. Default: ${DEFAULT_MAX_EXAMPLES}
  --include-open        Also quarantine open-only exact duplicate groups. Paid/open shadow duplicates are checked by default.
  --apply               Apply planned isExcluded quarantine fields to Firestore. Without this flag the script is dry-run only.
  --help                Show this help.

This script does not delete documents. It marks stale copies with isExcluded=true after grouping by
direction, client/document, due date, amount and business detail. It also detects paid/open shadow
duplicates caused by payment updates imported as a new receivable row. For payables, the business
detail includes observacaoAPagar so same-value employee reimbursements are not treated as duplicates.
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collection: DEFAULT_COLLECTION,
    dueFrom: '',
    dueTo: '',
    maxExamples: DEFAULT_MAX_EXAMPLES,
    includeOpen: false,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--due-from') args.dueFrom = String(argv[++index] || '').trim();
    else if (arg === '--due-to') args.dueTo = String(argv[++index] || '').trim();
    else if (arg === '--max-examples') args.maxExamples = Number(argv[++index]);
    else if (arg === '--include-open') args.includeOpen = true;
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
const cleanDigits = (value) => clean(value).replace(/\D/g, '');
const normalizeText = (value) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const normalizeYear = (value) => {
  const year = clean(value);
  if (year.length === 2) return `20${year}`;
  return year;
};
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const isPositive = (value) => Number.isFinite(value) && Math.abs(value) >= 0.01;

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
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;
  const normalized = text
    .replace(/[R$\s]/gi, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstPositive = (values) => {
  for (const value of values) {
    const parsed = roundMoney(parseMoney(value));
    if (isPositive(parsed)) return parsed;
  }
  return 0;
};

const canonicalStatus = (value) => {
  const normalized = normalizeText(value);
  if (normalized === 'pago') return 'Pago';
  if (normalized === 'pendente') return 'Pendente';
  if (normalized === 'agendado') return 'Agendado';
  if (['paga', 'sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(normalized)) return 'Pago';
  if (['nao', 'n', 'aberto', 'em aberto'].includes(normalized)) return 'Pendente';
  if (normalized === 'programado') return 'Agendado';
  return normalized ? clean(value) : 'Pendente';
};

const canonicalMovement = (data) => {
  const movement = normalizeText(data.movement);
  const type = normalizeText(data.type);
  if (movement === 'entrada' || type.includes('entrada') || type.includes('receber')) return 'Entrada';
  if (movement === 'saida' || type.includes('saida') || type.includes('pagar')) return 'Saida';
  if (isPositive(parseMoney(data.valueReceived)) && !isPositive(parseMoney(data.valuePaid))) return 'Entrada';
  if (isPositive(parseMoney(data.valuePaid)) && !isPositive(parseMoney(data.valueReceived))) return 'Saida';
  return '';
};

const getClientKey = (data) => {
  const document = cleanDigits(data.cpfCnpj || data.cpfCNPJ || data.cnpj || data.cpf);
  if (document) return `doc:${document}`;
  const client = normalizeText(data.client || data.description || data.observacaoAPagar);
  return client ? `name:${client}` : '';
};

const getBusinessDetailCandidates = (data, direction) => {
  if (direction === 'Saida') {
    return [
      data.observacaoAPagar,
      data.observacao,
      data.observacaoPagar,
      data.documentNumber,
      data.numeroDocumento,
    ];
  }

  return [
    data.observacaoReceber,
    data.observacao,
    data.cobrancaExtra,
    data.parcela,
    data.documentNumber,
    data.numeroDocumento,
  ];
};

const normalizeBusinessDetail = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';

  const competenceMatch = normalized.match(/\b(?:competencia|comp|hon|honorario|honorarios)\s+(\d{1,2})\s+(\d{2,4})\b/);
  if (competenceMatch) {
    const monthNumber = Number(competenceMatch[1]);
    if (monthNumber < 1 || monthNumber > 12) return normalized;
    const month = String(monthNumber).padStart(2, '0');
    const year = normalizeYear(competenceMatch[2]);
    return `competencia:${year}-${month}`;
  }

  return normalized;
};

const getBusinessDetailValue = (data, direction) => {
  const clientText = normalizeText(data.client || data.description);

  for (const candidate of getBusinessDetailCandidates(data, direction)) {
    const normalized = normalizeText(candidate);
    if (normalized && normalized !== clientText) return normalizeBusinessDetail(candidate);
  }

  return '';
};

const getDuplicateDetailKey = (data, direction) => {
  const detail = getBusinessDetailValue(data, direction);
  return detail ? `detail:${detail}` : 'detail:none';
};

const getAmount = (data, direction) => {
  const honorarios = parseMoney(data.honorarios);
  const extra = parseMoney(data.valorExtra ?? data.extras);
  const componentsTotal = roundMoney(honorarios + extra);
  if (direction === 'Entrada') {
    return firstPositive([
      data.totalCobranca,
      data.valorOriginal,
      data.valueReceived,
      componentsTotal,
      data.valuePaid,
    ]);
  }
  if (direction === 'Saida') {
    return firstPositive([
      data.valuePaid,
      data.valorOriginal,
      data.totalCobranca,
      componentsTotal,
      data.valueReceived,
    ]);
  }
  return firstPositive([data.totalCobranca, data.valorOriginal, data.valuePaid, data.valueReceived, componentsTotal]);
};

const buildDuplicateKey = (doc) => {
  const data = doc.data || {};
  const direction = canonicalMovement(data);
  const clientKey = getClientKey(data);
  const dueDate = clean(data.dueDate);
  const amount = getAmount(data, direction);
  if (!direction || !clientKey || !dueDate || !isPositive(amount)) return '';
  return [direction, clientKey, dueDate, amount.toFixed(2), getDuplicateDetailKey(data, direction)].join('|');
};

const buildBaseDuplicateKey = (doc) => {
  const data = doc.data || {};
  const direction = canonicalMovement(data);
  const clientKey = getClientKey(data);
  const dueDate = clean(data.dueDate);
  const amount = getAmount(data, direction);
  if (!direction || !clientKey || !dueDate || !isPositive(amount)) return '';
  return [direction, clientKey, dueDate, amount.toFixed(2)].join('|');
};

const hasCompatibleBusinessDetail = (left, right) => {
  const leftDirection = canonicalMovement(left.data || {});
  const rightDirection = canonicalMovement(right.data || {});
  if (leftDirection !== rightDirection) return false;

  const leftDetail = getBusinessDetailValue(left.data || {}, leftDirection);
  const rightDetail = getBusinessDetailValue(right.data || {}, rightDirection);
  return !leftDetail || !rightDetail || leftDetail === rightDetail;
};

const isInDateRange = (doc, args) => {
  const dueDate = clean(doc.data?.dueDate);
  if (args.dueFrom && dueDate < args.dueFrom) return false;
  if (args.dueTo && dueDate > args.dueTo) return false;
  return true;
};

const countFilled = (data) => [
  data.paymentDate,
  data.submissionId,
  data.cpfCnpj,
  data.clientNumber,
  data.observacaoAPagar,
  data.observacao,
  data.updatedAt,
].filter((value) => clean(value)).length;

const sortForKeeper = (left, right) => {
  const leftData = left.data || {};
  const rightData = right.data || {};
  const leftStatus = canonicalStatus(leftData.status);
  const rightStatus = canonicalStatus(rightData.status);
  if (leftStatus !== rightStatus) {
    if (leftStatus === 'Pago') return -1;
    if (rightStatus === 'Pago') return 1;
  }

  const scoreDiff = countFilled(rightData) - countFilled(leftData);
  if (scoreDiff !== 0) return scoreDiff;

  const leftUpdated = Date.parse(leftData.updatedAt || left.updateTime || '') || 0;
  const rightUpdated = Date.parse(rightData.updatedAt || right.updateTime || '') || 0;
  if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;

  return clean(left.id).localeCompare(clean(right.id));
};

const summarizeDoc = (doc) => {
  const data = doc.data || {};
  return {
    id: doc.id,
    source: data.source || '',
    submissionId: data.submissionId || '',
    type: data.type || '',
    movement: data.movement || '',
    status: data.status || '',
    date: data.date || '',
    dueDate: data.dueDate || '',
    paymentDate: data.paymentDate || '',
    client: data.client || '',
    description: data.description || '',
    observacaoAPagar: data.observacaoAPagar || '',
    cpfCnpj: data.cpfCnpj || '',
    clientNumber: data.clientNumber || '',
    valuePaid: parseMoney(data.valuePaid),
    valueReceived: parseMoney(data.valueReceived),
    valorOriginal: parseMoney(data.valorOriginal),
    totalCobranca: parseMoney(data.totalCobranca),
    updatedAt: data.updatedAt || doc.updateTime || '',
  };
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
  filters: {
    dueFrom: args.dueFrom,
    dueTo: args.dueTo,
    includeOpen: args.includeOpen,
  },
  counts: {
    transactions: transactionCount,
    documentsInspected: 0,
    duplicateGroups: 0,
    skippedOpenGroups: 0,
    plannedExclusions: 0,
    appliedDocuments: 0,
    failedDocuments: 0,
  },
  groups: [],
  examples: [],
  failures: [],
  notes: [],
});

const buildMarkdown = (report) => {
  const lines = [
    '# Duplicate Transaction Quarantine Plan',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    `Collection: ${report.collection}`,
    `Transactions in backup: ${report.counts.transactions}`,
    `Documents inspected: ${report.counts.documentsInspected}`,
    `Duplicate groups planned: ${report.counts.duplicateGroups}`,
    `Skipped open-only groups: ${report.counts.skippedOpenGroups}`,
    `Planned exclusions: ${report.counts.plannedExclusions}`,
    `Applied documents: ${report.counts.appliedDocuments}`,
    `Failed documents: ${report.counts.failedDocuments}`,
    '',
    '## Examples',
    '',
  ];

  if (report.examples.length === 0) lines.push('No duplicate quarantine candidates found.');
  for (const group of report.examples) {
    lines.push(`- ${group.duplicateKey}: keep ${group.keepId}; exclude ${group.excludeIds.join(', ')}`);
  }

  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
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

  const outPath = resolve(args.out || `${REPORT_DIR}/transaction-duplicate-quarantine-plan-${timestampForFile()}.json`);
  const documents = loadDocuments(inputPath, args.collection);
  const report = createReport({ inputPath, outPath, args, transactionCount: documents.length });
  const token = args.apply ? getAccessToken() : '';
  const quarantineStamp = report.generatedAt;
  const groupsByKey = new Map();

  for (const document of documents) {
    report.counts.documentsInspected += 1;
    if (document.data?.isExcluded === true) continue;
    if (!isInDateRange(document, args)) continue;
    const duplicateKey = buildDuplicateKey(document);
    if (!duplicateKey) continue;
    if (!groupsByKey.has(duplicateKey)) groupsByKey.set(duplicateKey, []);
    groupsByKey.get(duplicateKey).push(document);
  }

  for (const [duplicateKey, group] of groupsByKey.entries()) {
    if (group.length <= 1) continue;

    const paidCount = group.filter((doc) => canonicalStatus(doc.data?.status) === 'Pago').length;
    const allPaid = paidCount === group.length;
    if (!allPaid && !args.includeOpen) {
      if (paidCount === 0) report.counts.skippedOpenGroups += 1;
      continue;
    }

    const sorted = [...group].sort(sortForKeeper);
    const keeper = sorted[0];
    const excludeDocs = sorted.slice(1);
    const plannedGroup = {
      duplicateKey,
      keepId: keeper.id,
    excludeIds: excludeDocs.map((doc) => doc.id),
    reason: 'duplicate:exact-active',
    paidCount,
    openCount: group.length - paidCount,
    documents: sorted.map(summarizeDoc),
  };

    report.counts.duplicateGroups += 1;
    report.counts.plannedExclusions += excludeDocs.length;
    report.groups.push(plannedGroup);
    if (report.examples.length < args.maxExamples) report.examples.push(plannedGroup);

    if (args.apply) {
      for (const document of excludeDocs) {
        try {
          const fields = {
            isExcluded: true,
            exclusionReason: 'duplicate:exact-active',
            excludedAt: quarantineStamp,
            updatedAt: quarantineStamp,
            duplicateOf: keeper.id,
          };
          const documentPath = `${args.collection}/${encodeURIComponent(document.id)}`;
          await patchDocumentFields(args.projectId, documentPath, token, fields);
          report.counts.appliedDocuments += 1;
        } catch (error) {
          report.counts.failedDocuments += 1;
          report.failures.push({
            id: document.id,
            error: error.message || String(error),
          });
        }
      }
    }
  }

  const plannedExcludeIds = new Set(report.groups.flatMap((group) => group.excludeIds));
  const groupsByBaseKey = new Map();

  for (const document of documents) {
    if (document.data?.isExcluded === true || plannedExcludeIds.has(document.id)) continue;
    if (!isInDateRange(document, args)) continue;
    const duplicateKey = buildBaseDuplicateKey(document);
    if (!duplicateKey) continue;
    if (!groupsByBaseKey.has(duplicateKey)) groupsByBaseKey.set(duplicateKey, []);
    groupsByBaseKey.get(duplicateKey).push(document);
  }

  for (const [duplicateKey, group] of groupsByBaseKey.entries()) {
    if (group.length <= 1) continue;

    const paidDocs = group.filter((doc) => canonicalStatus(doc.data?.status) === 'Pago');
    const openDocs = group.filter((doc) => canonicalStatus(doc.data?.status) !== 'Pago');
    if (paidDocs.length === 0 || openDocs.length === 0) continue;

    const compatibleOpenDocs = openDocs.filter((openDoc) => paidDocs.some((paidDoc) => hasCompatibleBusinessDetail(openDoc, paidDoc)));
    if (compatibleOpenDocs.length === 0) continue;

    const sortedPaidDocs = [...paidDocs].sort(sortForKeeper);
    const keeper = sortedPaidDocs[0];
    const documentsInGroup = [...paidDocs, ...compatibleOpenDocs].sort(sortForKeeper);
    const plannedGroup = {
      duplicateKey,
      keepId: keeper.id,
      excludeIds: compatibleOpenDocs.map((doc) => doc.id),
      reason: 'duplicate:paid-shadow',
      paidCount: paidDocs.length,
      openCount: compatibleOpenDocs.length,
      documents: documentsInGroup.map(summarizeDoc),
    };

    report.counts.duplicateGroups += 1;
    report.counts.plannedExclusions += compatibleOpenDocs.length;
    report.groups.push(plannedGroup);
    if (report.examples.length < args.maxExamples) report.examples.push(plannedGroup);

    if (args.apply) {
      for (const document of compatibleOpenDocs) {
        try {
          const fields = {
            isExcluded: true,
            exclusionReason: 'duplicate:paid-shadow',
            excludedAt: quarantineStamp,
            updatedAt: quarantineStamp,
            duplicateOf: keeper.id,
          };
          const documentPath = `${args.collection}/${encodeURIComponent(document.id)}`;
          await patchDocumentFields(args.projectId, documentPath, token, fields);
          report.counts.appliedDocuments += 1;
        } catch (error) {
          report.counts.failedDocuments += 1;
          report.failures.push({
            id: document.id,
            error: error.message || String(error),
          });
        }
      }
    }
  }

  if (!args.apply) report.notes.push('Dry-run only. Re-run with --apply to write planned quarantine fields to Firestore.');
  if (!args.includeOpen) report.notes.push('Open-only duplicate groups are skipped by default. Paid/open shadow duplicates with compatible details are still planned.');
  writeReport(report);

  console.log(`Duplicate transaction quarantine ${report.mode} complete`);
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${outPath.replace(/\.json$/i, '.md')}`);
  console.log(`Documents inspected: ${report.counts.documentsInspected}`);
  console.log(`Duplicate groups planned: ${report.counts.duplicateGroups}`);
  console.log(`Skipped open-only groups: ${report.counts.skippedOpenGroups}`);
  console.log(`Planned exclusions: ${report.counts.plannedExclusions}`);
  console.log(`Applied documents: ${report.counts.appliedDocuments}`);
  console.log(`Failed documents: ${report.counts.failedDocuments}`);

  if (args.apply && report.counts.failedDocuments > 0) process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
