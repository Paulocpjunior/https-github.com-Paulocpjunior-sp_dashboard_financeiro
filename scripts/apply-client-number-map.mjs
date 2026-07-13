#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const DEFAULT_COLLECTION = 'transactions';
const DEFAULT_REGISTRY_COLLECTION = 'clientRegistry';
const REPORT_DIR = 'migration-backups';

const usage = `
Usage:
  node scripts/apply-client-number-map.mjs [options]

Options:
  --input <path>                 Firestore backup JSON to inspect. Default: latest migration-backups/firestore-data-backup-*.json
  --map <path>                   JSON or CSV map with cpfCnpj, client and clientNumber columns.
  --out <path>                   JSON report path. Default: migration-backups/client-number-map-plan-<timestamp>.json
  --project <id>                 Firebase project id for --apply. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>            Transactions collection. Default: ${DEFAULT_COLLECTION}
  --registry-collection <name>   Client registry collection. Default: ${DEFAULT_REGISTRY_COLLECTION}
  --due-from <date>              Consider only transactions with dueDate >= date.
  --due-to <date>                Consider only transactions with dueDate <= date.
  --apply                        Apply planned transaction and registry patches to Firestore. Dry-run by default.
  --help                         Show this help.

Without --map, this script writes a CSV template next to the JSON report for missing N.Cliente rows.
With --map, it patches only rows whose CPF/CNPJ or exact normalized name matches a provided official N.Cliente.
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    mapPath: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collection: DEFAULT_COLLECTION,
    registryCollection: DEFAULT_REGISTRY_COLLECTION,
    dueFrom: '',
    dueTo: '',
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--map') args.mapPath = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--registry-collection') args.registryCollection = argv[++index];
    else if (arg === '--due-from') args.dueFrom = String(argv[++index] || '').trim();
    else if (arg === '--due-to') args.dueTo = String(argv[++index] || '').trim();
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
const cleanDigits = (value) => clean(value).replace(/\D/g, '');
const normalizeText = (value) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const normalizeClientNumber = (value) => {
  const raw = clean(value);
  const digits = cleanDigits(raw);
  return digits ? digits.replace(/^0+(?=\d)/, '') : raw;
};

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

const loadCollection = (backup, collectionName) => {
  if (Array.isArray(backup.collections)) {
    const collection = backup.collections.find((item) => item.name === collectionName);
    if (collection?.documents) return collection.documents;
  }
  if (backup[collectionName]?.documents) return backup[collectionName].documents;
  if (Array.isArray(backup[collectionName])) return backup[collectionName];
  return [];
};

const parseMoney = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const parsed = Number(value.replace(/[R$\s]/gi, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const canonicalMovement = (data) => {
  const movement = normalizeText(data.movement);
  const type = normalizeText(data.type);
  if (movement === 'entrada' || type.includes('entrada') || type.includes('receber')) return 'Entrada';
  if (movement === 'saida' || type.includes('saida') || type.includes('pagar')) return 'Saida';
  if (parseMoney(data.valueReceived) > 0 && parseMoney(data.valuePaid) === 0) return 'Entrada';
  if (parseMoney(data.valuePaid) > 0 && parseMoney(data.valueReceived) === 0) return 'Saida';
  return '';
};

const isInDateRange = (data, args) => {
  const dueDate = clean(data.dueDate);
  if (args.dueFrom && dueDate < args.dueFrom) return false;
  if (args.dueTo && dueDate > args.dueTo) return false;
  return true;
};

const getClientNumber = (data) => clean(data.clientNumber ?? data.nCliente ?? data.codigoCliente);
const getDocDigits = (data) => cleanDigits(data.cpfCnpj || data.cpfCNPJ || data.cnpj || data.cpf || data.cpfCnpjDigits);
const getClientName = (data) => clean(data.client || data.description);

const clientRegistryDocId = (entry) => {
  if (entry.id) return entry.id;
  const key = clean(entry.key);
  if (key.startsWith('doc:')) return `doc-${key.slice(4)}`;
  return `name-${Buffer.from(key).toString('hex').slice(0, 16)}`;
};

const splitCsvLine = (line) => {
  const delimiter = line.includes(';') ? ';' : ',';
  const cells = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(clean);
};

const loadMapRows = (mapPath) => {
  if (!mapPath) return [];
  const fullPath = resolve(mapPath);
  if (!existsSync(fullPath)) throw new Error(`Map file not found: ${fullPath}`);
  const content = readFileSync(fullPath, 'utf8');
  if (extname(fullPath).toLowerCase() === '.json') {
    const parsed = JSON.parse(content);
    const rows = Array.isArray(parsed) ? parsed : Object.values(parsed);
    return rows.map((row) => ({
      cpfCnpj: clean(row.cpfCnpj ?? row.cnpj ?? row.cpf ?? row.document),
      client: clean(row.client ?? row.cliente ?? row.name),
      clientNumber: clean(row.clientNumber ?? row.nCliente ?? row.codigoCliente),
    }));
  }

  const lines = content.split(/\r?\n/).filter((line) => clean(line));
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((item) => normalizeText(item));
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
  const cpfIndex = indexOf('cpf cnpj', 'cpfcnpj', 'cnpj', 'cpf', 'documento');
  const clientIndex = indexOf('cliente', 'client', 'empresa', 'nome empresa');
  const numberIndex = indexOf('n cliente', 'ncliente', 'clientnumber', 'codigo cliente', 'cod cliente');
  if (numberIndex < 0) throw new Error('Map CSV must include a clientNumber/N.Cliente column.');

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return {
      cpfCnpj: cpfIndex >= 0 ? cells[cpfIndex] : '',
      client: clientIndex >= 0 ? cells[clientIndex] : '',
      clientNumber: cells[numberIndex],
    };
  });
};

const buildMapIndexes = (rows) => {
  const byDocument = new Map();
  const byName = new Map();
  const invalidRows = [];

  for (const [index, row] of rows.entries()) {
    const clientNumber = clean(row.clientNumber);
    const document = cleanDigits(row.cpfCnpj);
    const name = normalizeText(row.client);
    if (!clientNumber || (!document && !name)) {
      invalidRows.push({ index: index + 1, row, reason: 'missing clientNumber or identity' });
      continue;
    }
    const mapped = {
      cpfCnpj: document,
      client: clean(row.client),
      clientNormalized: name,
      clientNumber,
      clientNumberNormalized: normalizeClientNumber(clientNumber),
    };
    if (document) byDocument.set(document, mapped);
    if (name) byName.set(name, mapped);
  }

  return { byDocument, byName, invalidRows };
};

const findMapping = (data, indexes) => {
  const document = getDocDigits(data);
  if (document && indexes.byDocument.has(document)) return indexes.byDocument.get(document);
  const name = normalizeText(getClientName(data) || data.client);
  if (name && indexes.byName.has(name)) return indexes.byName.get(name);
  return null;
};

const findMissingCandidates = (transactions, registryEntries, args) => {
  const candidatesByKey = new Map();
  const candidatesByName = new Map();

  for (const doc of transactions) {
    const data = doc.data || {};
    if (data.isExcluded === true) continue;
    if (!isInDateRange(data, args)) continue;
    if (canonicalMovement(data) !== 'Entrada') continue;
    if (getClientNumber(data)) continue;
    const document = getDocDigits(data);
    if (!document) continue;
    const key = `doc:${document}`;
    if (!candidatesByKey.has(key)) {
      candidatesByKey.set(key, {
        key,
        cpfCnpjDigits: document,
        client: getClientName(data),
        clientNormalized: normalizeText(getClientName(data)),
        transactionIds: [],
        registryIds: [],
      });
    }
    const candidate = candidatesByKey.get(key);
    candidate.transactionIds.push(doc.id);
    if (candidate.clientNormalized) candidatesByName.set(candidate.clientNormalized, candidate);
  }

  for (const doc of registryEntries) {
    const data = doc.data || {};
    if (clean(data.status) !== 'missing_client_number') continue;
    const document = getDocDigits(data);
    const normalizedName = normalizeText(getClientName(data));
    const key = document ? `doc:${document}` : clean(data.key);
    if (!key && !normalizedName) continue;

    const existingByName = normalizedName ? candidatesByName.get(normalizedName) : null;
    if (args.dueFrom || args.dueTo) {
      if (!existingByName && (!key || !candidatesByKey.has(key))) continue;
    }

    const targetKey = existingByName?.key || key;
    if (!targetKey) continue;
    if (!candidatesByKey.has(targetKey)) {
      candidatesByKey.set(targetKey, {
        key: targetKey,
        cpfCnpjDigits: document,
        client: getClientName(data),
        clientNormalized: normalizedName,
        transactionIds: [],
        registryIds: [],
      });
    }
    const candidate = candidatesByKey.get(targetKey);
    if (!candidate.cpfCnpjDigits && document) candidate.cpfCnpjDigits = document;
    if (!candidate.client && getClientName(data)) candidate.client = getClientName(data);
    candidate.registryIds.push(doc.id);
    if (candidate.clientNormalized) candidatesByName.set(candidate.clientNormalized, candidate);
  }

  return [...candidatesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
};

const buildPlan = (transactions, registryEntries, indexes, args) => {
  const transactionUpdates = [];
  const registryUpdates = [];
  const skipped = [];

  for (const doc of transactions) {
    const data = doc.data || {};
    if (data.isExcluded === true) continue;
    if (!isInDateRange(data, args)) continue;
    if (canonicalMovement(data) !== 'Entrada') continue;
    const existing = getClientNumber(data);
    const mapping = findMapping(data, indexes);
    if (!mapping) continue;
    if (existing && normalizeClientNumber(existing) !== mapping.clientNumberNormalized) {
      skipped.push({ id: doc.id, kind: 'transaction', reason: 'existing_different_client_number', existing, planned: mapping.clientNumber });
      continue;
    }
    if (existing) continue;
    transactionUpdates.push({
      id: doc.id,
      path: doc.path || '',
      client: getClientName(data),
      cpfCnpjDigits: getDocDigits(data),
      plannedClientNumber: mapping.clientNumber,
      plannedClientNumberNormalized: mapping.clientNumberNormalized,
      reason: 'manual_official_client_number_map',
    });
  }

  for (const doc of registryEntries) {
    const data = doc.data || {};
    const mapping = findMapping(data, indexes);
    if (!mapping) continue;
    const existing = getClientNumber(data);
    if (existing && normalizeClientNumber(existing) !== mapping.clientNumberNormalized) {
      skipped.push({ id: doc.id, kind: 'registry', reason: 'existing_different_client_number', existing, planned: mapping.clientNumber });
      continue;
    }
    if (existing && data.status === 'ready') continue;
    registryUpdates.push({
      id: clientRegistryDocId({ id: doc.id, key: data.key }),
      path: doc.path || '',
      key: data.key || '',
      keyType: data.keyType || '',
      client: data.client || mapping.client,
      cpfCnpjDigits: getDocDigits(data) || mapping.cpfCnpj,
      plannedClientNumber: mapping.clientNumber,
      plannedClientNumberNormalized: mapping.clientNumberNormalized,
      reason: 'manual_official_client_number_map',
    });
  }

  return { transactionUpdates, registryUpdates, skipped };
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

const csvEscape = (value) => `"${clean(value).replace(/"/g, '""')}"`;

const buildTemplateCsv = (candidates) => {
  const rows = [
    ['cpfCnpj', 'client', 'clientNumber', 'transactionIds', 'registryIds'],
    ...candidates.map((item) => [
      item.cpfCnpjDigits,
      item.client,
      '',
      item.transactionIds.join(','),
      item.registryIds.join(','),
    ]),
  ];
  return rows.map((row) => row.map(csvEscape).join(';')).join('\n') + '\n';
};

const buildMarkdown = (report) => {
  const lines = [
    '# Client Number Map Plan',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    `Map: ${report.mapPath || '-'}`,
    `Transactions inspected: ${report.counts.transactions}`,
    `Registry inspected: ${report.counts.registryEntries}`,
    `Missing candidates: ${report.counts.missingCandidates}`,
    `Planned transaction updates: ${report.counts.plannedTransactionUpdates}`,
    `Planned registry updates: ${report.counts.plannedRegistryUpdates}`,
    `Applied transaction updates: ${report.counts.appliedTransactionUpdates}`,
    `Applied registry updates: ${report.counts.appliedRegistryUpdates}`,
    `Failures: ${report.counts.failures}`,
    '',
    '## Missing Candidates',
    '',
  ];

  if (report.missingCandidates.length === 0) lines.push('- No missing N.Cliente candidates found.');
  for (const item of report.missingCandidates.slice(0, 20)) {
    lines.push(`- ${item.cpfCnpjDigits || item.key}: ${item.client} (${item.transactionIds.length} transactions, ${item.registryIds.length} registry docs)`);
  }

  lines.push('', '## Planned Updates', '');
  if (report.transactionUpdates.length === 0 && report.registryUpdates.length === 0) {
    lines.push('- No updates planned.');
  } else {
    for (const item of report.transactionUpdates.slice(0, 20)) {
      lines.push(`- transaction/${item.id}: ${item.client} -> ${item.plannedClientNumber}`);
    }
    for (const item of report.registryUpdates.slice(0, 20)) {
      lines.push(`- clientRegistry/${item.id}: ${item.client} -> ${item.plannedClientNumber}`);
    }
  }

  if (report.skipped.length > 0) {
    lines.push('', '## Skipped', '');
    for (const item of report.skipped.slice(0, 20)) {
      lines.push(`- ${item.kind}/${item.id}: ${item.reason}`);
    }
  }

  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of report.failures.slice(0, 20)) {
      lines.push(`- ${failure.kind}/${failure.id}: ${failure.error}`);
    }
  }

  lines.push(
    '',
    '## Safety',
    '',
    report.mode === 'dry-run'
      ? 'Dry-run only. No Firebase documents were changed.'
      : 'Apply mode was used. Only clientNumber fields and registry readiness fields were patched.',
  );

  return `${lines.join('\n')}\n`;
};

const writeReport = (report, outPath) => {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(outPath.replace(/\.json$/i, '.md'), buildMarkdown(report));
  writeFileSync(outPath.replace(/\.json$/i, '.template.csv'), buildTemplateCsv(report.missingCandidates));
};

const applyUpdates = async (report, args, token) => {
  const stamp = new Date().toISOString();

  for (const update of report.transactionUpdates) {
    try {
      await patchDocumentFields(args.projectId, `${args.collection}/${encodeURIComponent(update.id)}`, token, {
        clientNumber: update.plannedClientNumber,
        clientNumberSource: 'manual-official-map',
        clientNumberUpdatedAt: stamp,
        updatedAt: stamp,
      });
      report.counts.appliedTransactionUpdates += 1;
    } catch (error) {
      report.counts.failures += 1;
      report.failures.push({ kind: 'transaction', id: update.id, error: error.message || String(error) });
    }
  }

  for (const update of report.registryUpdates) {
    try {
      await patchDocumentFields(args.projectId, `${args.registryCollection}/${encodeURIComponent(update.id)}`, token, {
        clientNumber: update.plannedClientNumber,
        clientNumberNormalized: update.plannedClientNumberNormalized,
        status: 'ready',
        confidence: update.cpfCnpjDigits ? 'high' : 'medium',
        manualClientNumberSource: 'manual-official-map',
        manualClientNumberUpdatedAt: stamp,
        updatedAt: stamp,
      });
      report.counts.appliedRegistryUpdates += 1;
    } catch (error) {
      report.counts.failures += 1;
      report.failures.push({ kind: 'registry', id: update.id, error: error.message || String(error) });
    }
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatestBackup());
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error('No Firestore backup found. Run npm run backup:firestore or pass --input <path>.');
  }

  const outPath = resolve(args.out || `${REPORT_DIR}/client-number-map-plan-${timestampForFile()}.json`);
  const backup = JSON.parse(readFileSync(inputPath, 'utf8'));
  const transactions = loadCollection(backup, args.collection);
  const registryEntries = loadCollection(backup, args.registryCollection);
  const mapRows = loadMapRows(args.mapPath);
  const indexes = buildMapIndexes(mapRows);
  const missingCandidates = findMissingCandidates(transactions, registryEntries, args);
  const plan = buildPlan(transactions, registryEntries, indexes, args);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    inputPath,
    mapPath: args.mapPath ? resolve(args.mapPath) : '',
    projectId: args.projectId,
    collection: args.collection,
    registryCollection: args.registryCollection,
    filters: {
      dueFrom: args.dueFrom,
      dueTo: args.dueTo,
    },
    counts: {
      transactions: transactions.length,
      registryEntries: registryEntries.length,
      mapRows: mapRows.length,
      invalidMapRows: indexes.invalidRows.length,
      missingCandidates: missingCandidates.length,
      plannedTransactionUpdates: plan.transactionUpdates.length,
      plannedRegistryUpdates: plan.registryUpdates.length,
      appliedTransactionUpdates: 0,
      appliedRegistryUpdates: 0,
      failures: 0,
    },
    invalidMapRows: indexes.invalidRows,
    missingCandidates,
    transactionUpdates: plan.transactionUpdates,
    registryUpdates: plan.registryUpdates,
    skipped: plan.skipped,
    failures: [],
  };

  if (args.apply) {
    const token = getAccessToken();
    await applyUpdates(report, args, token);
  }

  writeReport(report, outPath);

  console.log(`Client number map ${report.mode} complete`);
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${outPath.replace(/\.json$/i, '.md')}`);
  console.log(`Template CSV: ${outPath.replace(/\.json$/i, '.template.csv')}`);
  console.log(`Missing candidates: ${report.counts.missingCandidates}`);
  console.log(`Planned transaction updates: ${report.counts.plannedTransactionUpdates}`);
  console.log(`Planned registry updates: ${report.counts.plannedRegistryUpdates}`);
  console.log(`Applied transaction updates: ${report.counts.appliedTransactionUpdates}`);
  console.log(`Applied registry updates: ${report.counts.appliedRegistryUpdates}`);
  console.log(`Failures: ${report.counts.failures}`);

  if (args.apply && report.counts.failures > 0) process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
