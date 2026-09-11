#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const REPORT_DIR = 'migration-backups';
const DEFAULT_COLLECTION = 'transactions';
const DEFAULT_REGISTRY_COLLECTION = 'clientRegistry';
const DEFAULT_MAX_EXAMPLES = 40;
const SOURCE_FIELDS = ['nCliente', 'clientNumber', 'codigoCliente'];

const usage = `
Usage:
  node scripts/build-client-registry.mjs [options]

Options:
  --input <path>                 Firestore backup JSON to inspect. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>                   JSON report path. Default: migration-backups/client-registry-plan-<timestamp>.json
  --project <id>                 Firebase project id. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>            Transactions collection inside the backup. Default: ${DEFAULT_COLLECTION}
  --registry-collection <name>   Registry collection to write when applying. Default: ${DEFAULT_REGISTRY_COLLECTION}
  --max-examples <n>             Max examples stored in the report. Default: ${DEFAULT_MAX_EXAMPLES}
  --include-excluded             Include records marked isExcluded=true. Default: skip them because the app hides them.
  --allow-name-backfill          Allow transaction backfill from name-only registry entries. Default: only CPF/CNPJ entries backfill transactions.
  --apply-registry               Write the generated client registry to Firestore.
  --apply-transactions           Backfill safe missing transaction clientNumber values from ready registry entries.
  --help                         Show this help.

Dry-run is the default. The script builds a client registry from Firestore data and separates ready mappings from conflicts.
Transaction updates are planned only when the official client number is unique. By default, only CPF/CNPJ-based entries backfill transactions.
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collection: DEFAULT_COLLECTION,
    registryCollection: DEFAULT_REGISTRY_COLLECTION,
    maxExamples: DEFAULT_MAX_EXAMPLES,
    includeExcluded: false,
    allowNameBackfill: false,
    applyRegistry: false,
    applyTransactions: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--registry-collection') args.registryCollection = argv[++index];
    else if (arg === '--max-examples') args.maxExamples = Number(argv[++index]);
    else if (arg === '--include-excluded') args.includeExcluded = true;
    else if (arg === '--allow-name-backfill') args.allowNameBackfill = true;
    else if (arg === '--apply-registry') args.applyRegistry = true;
    else if (arg === '--apply-transactions') args.applyTransactions = true;
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
  if (!args.registryCollection.trim()) throw new Error('--registry-collection cannot be empty.');

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

const normalizeClientNumber = (value) => {
  const text = clean(value);
  if (!text || text === '-') return '';
  const digits = cleanDigits(text);
  if (!digits) return text;
  return digits.replace(/^0+(?=\d)/, '') || '0';
};

const firstClean = (...values) => values.map(clean).find(Boolean) || '';
const hashText = (value, length = 16) => createHash('sha1').update(value).digest('hex').slice(0, length);

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

const canonicalMovement = (data) => {
  const movement = normalizeText(data.movement);
  const type = normalizeText(data.type);
  if (movement === 'entrada' || type.includes('entrada') || type.includes('receber')) return 'Entrada';
  if (movement === 'saida' || type.includes('saida') || type.includes('pagar')) return 'Saida';
  return '';
};

const getClientName = (data) => firstClean(data.client, data.description, data.observacaoReceber);
const getDocumentDigits = (data) => cleanDigits(data.cpfCnpj || data.cpfCNPJ || data.cnpj || data.cpf);

const getIdentity = (data) => {
  const cpfCnpjDigits = getDocumentDigits(data);
  if (cpfCnpjDigits) {
    return {
      key: `doc:${cpfCnpjDigits}`,
      keyType: cpfCnpjDigits.length === 11 ? 'cpf' : 'cnpj',
      cpfCnpjDigits,
      normalizedName: normalizeText(getClientName(data)),
    };
  }

  const normalizedName = normalizeText(getClientName(data));
  if (!normalizedName) return null;
  return {
    key: `name:${normalizedName}`,
    keyType: 'name',
    cpfCnpjDigits: '',
    normalizedName,
  };
};

const getRawClientNumbers = (data) => {
  const candidates = [];
  for (const field of SOURCE_FIELDS) {
    const raw = clean(data[field]);
    const normalized = normalizeClientNumber(raw);
    if (!normalized) continue;
    candidates.push({ field, raw, normalized });
  }
  return candidates;
};

const createGroup = (identity) => ({
  key: identity.key,
  keyType: identity.keyType,
  cpfCnpjDigits: identity.cpfCnpjDigits,
  normalizedName: identity.normalizedName,
  names: new Map(),
  clientNumbers: new Map(),
  sourceFields: new Map(),
  documents: [],
  firstDueDate: '',
  lastDueDate: '',
  latestUpdatedAt: '',
});

const incrementMap = (map, key, amount = 1) => {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
};

const addClientNumber = (group, candidate, docId) => {
  if (!group.clientNumbers.has(candidate.normalized)) {
    group.clientNumbers.set(candidate.normalized, {
      normalized: candidate.normalized,
      labels: new Map(),
      fields: new Map(),
      docIds: new Set(),
    });
  }

  const bucket = group.clientNumbers.get(candidate.normalized);
  incrementMap(bucket.labels, candidate.raw);
  incrementMap(bucket.fields, candidate.field);
  incrementMap(group.sourceFields, candidate.field);
  bucket.docIds.add(docId);
};

const pushDateRange = (group, data) => {
  const dueDate = clean(data.dueDate);
  if (dueDate) {
    if (!group.firstDueDate || dueDate < group.firstDueDate) group.firstDueDate = dueDate;
    if (!group.lastDueDate || dueDate > group.lastDueDate) group.lastDueDate = dueDate;
  }
  const updatedAt = clean(data.updatedAt);
  if (updatedAt && updatedAt > group.latestUpdatedAt) group.latestUpdatedAt = updatedAt;
};

const bestLabel = (labels) => {
  const ordered = [...labels.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    const leftDigits = cleanDigits(left[0]).length;
    const rightDigits = cleanDigits(right[0]).length;
    if (rightDigits !== leftDigits) return rightDigits - leftDigits;
    if (right[0].length !== left[0].length) return right[0].length - left[0].length;
    return left[0].localeCompare(right[0], 'pt-BR', { numeric: true });
  });
  return ordered[0]?.[0] || '';
};

const bestName = (names) => {
  const ordered = [...names.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return right[0].length - left[0].length;
  });
  return ordered[0]?.[0] || '';
};

const registryDocId = (entry) => {
  if (entry.cpfCnpjDigits) return `doc-${entry.cpfCnpjDigits}`;
  return `name-${hashText(entry.key)}`;
};

const summarizeDoc = (doc) => {
  const data = doc.data || {};
  return {
    id: doc.id,
    client: getClientName(data),
    cpfCnpj: data.cpfCnpj || data.cpfCNPJ || data.cnpj || data.cpf || '',
    clientNumber: firstClean(data.nCliente, data.clientNumber, data.codigoCliente),
    nCliente: data.nCliente || '',
    dueDate: data.dueDate || '',
    status: data.status || '',
    source: data.source || '',
  };
};

const buildRegistryEntries = (groups) => {
  const entries = [];

  for (const group of [...groups.values()].sort((left, right) => left.key.localeCompare(right.key))) {
    const numberBuckets = [...group.clientNumbers.values()];
    const status = numberBuckets.length === 0
      ? 'missing_client_number'
      : numberBuckets.length === 1
        ? 'ready'
        : 'conflict';
    const readyBucket = status === 'ready' ? numberBuckets[0] : null;
    const clientNumber = readyBucket ? bestLabel(readyBucket.labels) : '';
    const clientNumberNormalized = readyBucket?.normalized || '';
    const sourceDocIds = group.documents.map((doc) => doc.id);

    const entry = {
      id: '',
      key: group.key,
      keyType: group.keyType,
      cpfCnpjDigits: group.cpfCnpjDigits,
      client: bestName(group.names),
      clientNormalized: group.normalizedName,
      clientNumber,
      clientNumberNormalized,
      status,
      confidence: group.cpfCnpjDigits ? 'high' : 'medium',
      source: 'transactions',
      sourceCount: group.documents.length,
      sourceFields: Object.fromEntries([...group.sourceFields.entries()].sort()),
      clientNumbers: numberBuckets.map((bucket) => ({
        normalized: bucket.normalized,
        labels: Object.fromEntries([...bucket.labels.entries()].sort()),
        fields: Object.fromEntries([...bucket.fields.entries()].sort()),
        sourceCount: bucket.docIds.size,
      })),
      firstDueDate: group.firstDueDate,
      lastDueDate: group.lastDueDate,
      latestTransactionUpdatedAt: group.latestUpdatedAt,
      sampleSourceDocIds: sourceDocIds.slice(0, 50),
      createdFromBackupAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    entry.id = registryDocId(entry);
    entries.push(entry);
  }

  return entries;
};

const buildGroups = (documents, report, args) => {
  const groups = new Map();
  const sourceDocs = [];

  for (const doc of documents) {
    const data = doc.data || {};
    if (!args.includeExcluded && data.isExcluded === true) {
      report.counts.excludedSkipped += 1;
      continue;
    }

    if (canonicalMovement(data) !== 'Entrada') {
      report.counts.nonReceivableSkipped += 1;
      continue;
    }

    const identity = getIdentity(data);
    if (!identity) {
      report.counts.missingIdentitySkipped += 1;
      continue;
    }

    if (!groups.has(identity.key)) groups.set(identity.key, createGroup(identity));
    const group = groups.get(identity.key);
    const clientName = getClientName(data);
    incrementMap(group.names, clientName);
    group.documents.push(doc);
    sourceDocs.push({ doc, identity });
    pushDateRange(group, data);

    for (const candidate of getRawClientNumbers(data)) addClientNumber(group, candidate, doc.id);
  }

  return { groups, sourceDocs };
};

const buildTransactionUpdates = (sourceDocs, registryByKey, args) => {
  const updates = [];

  for (const { doc, identity } of sourceDocs) {
    const entry = registryByKey.get(identity.key);
    if (!entry || entry.status !== 'ready' || !entry.clientNumber) continue;
    if (entry.confidence !== 'high' && !args.allowNameBackfill) continue;

    const data = doc.data || {};
    const currentRaw = firstClean(data.clientNumber, data.nCliente, data.codigoCliente);
    const currentNormalized = normalizeClientNumber(currentRaw);
    if (currentNormalized === entry.clientNumberNormalized) continue;

    if (currentNormalized) {
      updates.push({
        id: doc.id,
        action: 'manual_review',
        reason: 'existing_client_number_differs_from_registry',
        currentClientNumber: currentRaw,
        plannedClientNumber: entry.clientNumber,
        registryId: entry.id,
        registryKey: entry.key,
        client: getClientName(data),
        cpfCnpj: data.cpfCnpj || '',
        dueDate: data.dueDate || '',
      });
      continue;
    }

    updates.push({
      id: doc.id,
      action: 'patch_client_number',
      reason: 'missing_client_number_with_ready_registry',
      currentClientNumber: currentRaw,
      plannedClientNumber: entry.clientNumber,
      registryId: entry.id,
      registryKey: entry.key,
      client: getClientName(data),
      cpfCnpj: data.cpfCnpj || '',
      dueDate: data.dueDate || '',
    });
  }

  return updates;
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

const createReport = ({ args, inputPath, outPath, documentCount }) => ({
  generatedAt: new Date().toISOString(),
  mode: args.applyRegistry || args.applyTransactions ? 'apply' : 'dry-run',
  inputPath,
  outPath,
  projectId: args.projectId,
  collection: args.collection,
  registryCollection: args.registryCollection,
  includeExcluded: args.includeExcluded,
  allowNameBackfill: args.allowNameBackfill,
  counts: {
    documentsInBackup: documentCount,
    excludedSkipped: 0,
    nonReceivableSkipped: 0,
    missingIdentitySkipped: 0,
    registryGroups: 0,
    registryReady: 0,
    registryConflicts: 0,
    registryMissingClientNumber: 0,
    highConfidenceRegistry: 0,
    mediumConfidenceRegistry: 0,
    transactionUpdatesPlanned: 0,
    transactionUpdatesSafe: 0,
    transactionUpdatesManualReview: 0,
    appliedRegistryDocuments: 0,
    appliedTransactionDocuments: 0,
    failedRegistryDocuments: 0,
    failedTransactionDocuments: 0,
  },
  examples: {
    conflicts: [],
    missingClientNumber: [],
    safeTransactionUpdates: [],
    manualReviewTransactionUpdates: [],
  },
  failures: [],
  notes: [],
});

const addExample = (list, item, maxExamples) => {
  if (list.length < maxExamples) list.push(item);
};

const attachRegistryToReport = (report, entries, transactionUpdates, args) => {
  report.counts.registryGroups = entries.length;
  report.counts.registryReady = entries.filter((entry) => entry.status === 'ready').length;
  report.counts.registryConflicts = entries.filter((entry) => entry.status === 'conflict').length;
  report.counts.registryMissingClientNumber = entries.filter((entry) => entry.status === 'missing_client_number').length;
  report.counts.highConfidenceRegistry = entries.filter((entry) => entry.confidence === 'high').length;
  report.counts.mediumConfidenceRegistry = entries.filter((entry) => entry.confidence === 'medium').length;
  report.counts.transactionUpdatesPlanned = transactionUpdates.length;
  report.counts.transactionUpdatesSafe = transactionUpdates.filter((item) => item.action === 'patch_client_number').length;
  report.counts.transactionUpdatesManualReview = transactionUpdates.filter((item) => item.action === 'manual_review').length;

  for (const entry of entries) {
    if (entry.status === 'conflict') {
      addExample(report.examples.conflicts, {
        id: entry.id,
        key: entry.key,
        client: entry.client,
        cpfCnpjDigits: entry.cpfCnpjDigits,
        clientNumbers: entry.clientNumbers,
        sampleSourceDocIds: entry.sampleSourceDocIds.slice(0, 10),
      }, args.maxExamples);
    }
    if (entry.status === 'missing_client_number') {
      addExample(report.examples.missingClientNumber, {
        id: entry.id,
        key: entry.key,
        client: entry.client,
        cpfCnpjDigits: entry.cpfCnpjDigits,
        sourceCount: entry.sourceCount,
        sampleSourceDocIds: entry.sampleSourceDocIds.slice(0, 10),
      }, args.maxExamples);
    }
  }

  for (const update of transactionUpdates) {
    if (update.action === 'patch_client_number') {
      addExample(report.examples.safeTransactionUpdates, update, args.maxExamples);
    } else {
      addExample(report.examples.manualReviewTransactionUpdates, update, args.maxExamples);
    }
  }

  if (!args.applyRegistry && !args.applyTransactions) {
    report.notes.push('Dry-run only. No Firebase documents were changed.');
  }
  if (report.counts.registryConflicts > 0) {
    report.notes.push('Conflicting registry entries were not used for transaction backfill.');
  }
  if (report.counts.transactionUpdatesManualReview > 0) {
    report.notes.push('Some transactions already have a different N.Cliente and require manual review before patching.');
  }
};

const buildMarkdown = (report) => {
  const lines = [
    '# Client Registry Plan',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    `Transactions collection: ${report.collection}`,
    `Registry collection: ${report.registryCollection}`,
    '',
    '## Counts',
    '',
    `- Documents in backup: ${report.counts.documentsInBackup}`,
    `- Excluded skipped: ${report.counts.excludedSkipped}`,
    `- Non-receivable skipped: ${report.counts.nonReceivableSkipped}`,
    `- Missing identity skipped: ${report.counts.missingIdentitySkipped}`,
    `- Registry groups: ${report.counts.registryGroups}`,
    `- Ready registry entries: ${report.counts.registryReady}`,
    `- Registry conflicts: ${report.counts.registryConflicts}`,
    `- Registry entries missing N.Cliente: ${report.counts.registryMissingClientNumber}`,
    `- Safe transaction updates planned: ${report.counts.transactionUpdatesSafe}`,
    `- Manual-review transaction updates: ${report.counts.transactionUpdatesManualReview}`,
    `- Applied registry documents: ${report.counts.appliedRegistryDocuments}`,
    `- Applied transaction documents: ${report.counts.appliedTransactionDocuments}`,
    `- Failed registry documents: ${report.counts.failedRegistryDocuments}`,
    `- Failed transaction documents: ${report.counts.failedTransactionDocuments}`,
    '',
    '## Conflict Examples',
    '',
  ];

  if (report.examples.conflicts.length === 0) {
    lines.push('- No conflicts found.');
  } else {
    for (const item of report.examples.conflicts.slice(0, 15)) {
      lines.push(`- ${item.id}: ${item.client || item.key} -> ${item.clientNumbers.map((number) => number.normalized).join(', ')}`);
    }
  }

  lines.push('', '## Missing N.Cliente Examples', '');
  if (report.examples.missingClientNumber.length === 0) {
    lines.push('- No missing N.Cliente registry groups.');
  } else {
    for (const item of report.examples.missingClientNumber.slice(0, 15)) {
      lines.push(`- ${item.id}: ${item.client || item.key} (${item.sourceCount} sources)`);
    }
  }

  lines.push('', '## Safe Backfill Examples', '');
  if (report.examples.safeTransactionUpdates.length === 0) {
    lines.push('- No safe transaction backfills planned.');
  } else {
    for (const item of report.examples.safeTransactionUpdates.slice(0, 15)) {
      lines.push(`- ${item.id}: ${item.client || item.registryKey} -> ${item.plannedClientNumber}`);
    }
  }

  lines.push('', '## Notes', '');
  for (const note of report.notes) lines.push(`- ${note}`);

  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of report.failures.slice(0, 25)) {
      lines.push(`- ${failure.id || failure.path}: ${failure.error}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

const buildCsv = (entries, transactionUpdates) => {
  const rows = [[
    'kind',
    'status',
    'id',
    'key',
    'client',
    'cpfCnpjDigits',
    'clientNumber',
    'confidence',
    'sourceCount',
    'action',
    'reason',
  ]];

  for (const entry of entries) {
    rows.push([
      'registry',
      entry.status,
      entry.id,
      entry.key,
      entry.client,
      entry.cpfCnpjDigits,
      entry.clientNumber,
      entry.confidence,
      entry.sourceCount,
      '',
      '',
    ]);
  }

  for (const update of transactionUpdates) {
    rows.push([
      'transaction',
      '',
      update.id,
      update.registryKey,
      update.client,
      cleanDigits(update.cpfCnpj),
      update.plannedClientNumber,
      '',
      '',
      update.action,
      update.reason,
    ]);
  }

  return rows
    .map((row) => row.map((cell) => `"${clean(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n') + '\n';
};

const writeReport = (report, entries, transactionUpdates) => {
  mkdirSync(dirname(report.outPath), { recursive: true });
  writeFileSync(report.outPath, `${JSON.stringify({
    ...report,
    registryEntries: entries,
    transactionUpdates,
  }, null, 2)}\n`);
  writeFileSync(report.outPath.replace(/\.json$/i, '.md'), buildMarkdown(report));
  writeFileSync(report.outPath.replace(/\.json$/i, '.csv'), buildCsv(entries, transactionUpdates));
};

const applyRegistry = async (entries, report, args, token) => {
  for (const entry of entries) {
    try {
      const documentPath = `${args.registryCollection}/${encodeURIComponent(entry.id)}`;
      await patchDocumentFields(args.projectId, documentPath, token, entry);
      report.counts.appliedRegistryDocuments += 1;
    } catch (error) {
      report.counts.failedRegistryDocuments += 1;
      report.failures.push({
        id: entry.id,
        path: `${args.registryCollection}/${entry.id}`,
        error: error.message || String(error),
      });
    }
  }
};

const applyTransactionUpdates = async (transactionUpdates, report, args, token) => {
  const safeUpdates = transactionUpdates.filter((item) => item.action === 'patch_client_number');

  for (const update of safeUpdates) {
    try {
      const documentPath = `${args.collection}/${encodeURIComponent(update.id)}`;
      await patchDocumentFields(args.projectId, documentPath, token, {
        clientNumber: update.plannedClientNumber,
        clientNumberSource: update.registryId,
        clientNumberUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      report.counts.appliedTransactionDocuments += 1;
    } catch (error) {
      report.counts.failedTransactionDocuments += 1;
      report.failures.push({
        id: update.id,
        path: `${args.collection}/${update.id}`,
        error: error.message || String(error),
      });
    }
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatestBackup());
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error('No Firestore backup found. Run npm run backup:firestore or pass --input <path>.');
  }

  const outPath = resolve(args.out || `${REPORT_DIR}/client-registry-plan-${timestampForFile()}.json`);
  const documents = loadDocuments(inputPath, args.collection);
  const report = createReport({ args, inputPath, outPath, documentCount: documents.length });
  const { groups, sourceDocs } = buildGroups(documents, report, args);
  const entries = buildRegistryEntries(groups);
  const registryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const transactionUpdates = buildTransactionUpdates(sourceDocs, registryByKey, args);

  attachRegistryToReport(report, entries, transactionUpdates, args);

  const token = (args.applyRegistry || args.applyTransactions) ? getAccessToken() : '';
  if (args.applyRegistry) await applyRegistry(entries, report, args, token);
  if (args.applyTransactions) await applyTransactionUpdates(transactionUpdates, report, args, token);

  writeReport(report, entries, transactionUpdates);

  console.log(`Client registry ${report.mode} complete`);
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${outPath.replace(/\.json$/i, '.md')}`);
  console.log(`CSV report: ${outPath.replace(/\.json$/i, '.csv')}`);
  console.log(`Registry groups: ${report.counts.registryGroups}`);
  console.log(`Ready: ${report.counts.registryReady}`);
  console.log(`Conflicts: ${report.counts.registryConflicts}`);
  console.log(`Missing N.Cliente: ${report.counts.registryMissingClientNumber}`);
  console.log(`Safe transaction updates: ${report.counts.transactionUpdatesSafe}`);
  console.log(`Manual-review transaction updates: ${report.counts.transactionUpdatesManualReview}`);
  console.log(`Applied registry documents: ${report.counts.appliedRegistryDocuments}`);
  console.log(`Applied transaction documents: ${report.counts.appliedTransactionDocuments}`);
  console.log(`Failures: ${report.failures.length}`);

  if (report.failures.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
