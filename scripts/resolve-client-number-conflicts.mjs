#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const REPORT_DIR = 'migration-backups';
const DEFAULT_COLLECTION = 'transactions';
const DEFAULT_REGISTRY_COLLECTION = 'clientRegistry';
const DEFAULT_MAX_EXAMPLES = 80;
const SOURCE_FIELDS = ['nCliente', 'clientNumber', 'codigoCliente'];

const usage = `
Usage:
  node scripts/resolve-client-number-conflicts.mjs [options]

Options:
  --input <path>                 Firestore backup JSON to inspect. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>                   JSON report path. Default: migration-backups/client-number-conflict-resolution-<timestamp>.json
  --project <id>                 Firebase project id for --apply. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>            Transactions collection inside the backup. Default: ${DEFAULT_COLLECTION}
  --registry-collection <name>   Registry collection to patch when applying. Default: ${DEFAULT_REGISTRY_COLLECTION}
  --include-name-only            Allow safe resolutions for name-only groups. Default: CPF/CNPJ groups only.
  --max-examples <n>             Max examples stored in the report. Default: ${DEFAULT_MAX_EXAMPLES}
  --apply                        Apply safe resolutions to Firestore. Without this flag the script is dry-run only.
  --help                         Show this help.

This script resolves only objective N.Cliente conflicts:
- a single nCliente source wins when competing numbers do not have nCliente evidence;
- trailing-zero pairs such as 138 versus 1380, with strong count evidence;
- one dominant number with at least 90% of the evidence.
`;

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collection: DEFAULT_COLLECTION,
    registryCollection: DEFAULT_REGISTRY_COLLECTION,
    includeNameOnly: false,
    maxExamples: DEFAULT_MAX_EXAMPLES,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--registry-collection') args.registryCollection = argv[++index];
    else if (arg === '--include-name-only') args.includeNameOnly = true;
    else if (arg === '--max-examples') args.maxExamples = Number(argv[++index]);
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage.trim());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(args.maxExamples) || args.maxExamples < 0) throw new Error('--max-examples must be a non-negative number.');
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
  return digits ? digits.replace(/^0+(?=\d)/, '') || '0' : text;
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

const registryDocId = (identity) => {
  if (identity.cpfCnpjDigits) return `doc-${identity.cpfCnpjDigits}`;
  return `name-${hashText(identity.key)}`;
};

const incrementMap = (map, key, amount = 1) => {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
};

const getRawClientNumberCandidates = (data) => {
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
  ...identity,
  id: registryDocId(identity),
  clientNames: new Map(),
  candidates: new Map(),
  documents: [],
});

const addCandidate = (group, candidate, doc) => {
  if (!group.candidates.has(candidate.normalized)) {
    group.candidates.set(candidate.normalized, {
      normalized: candidate.normalized,
      labels: new Map(),
      fields: new Map(),
      docs: new Map(),
    });
  }

  const bucket = group.candidates.get(candidate.normalized);
  incrementMap(bucket.labels, candidate.raw);
  incrementMap(bucket.fields, candidate.field);
  bucket.docs.set(doc.id, doc);
};

const buildGroups = (documents, report, includeExcluded) => {
  const groups = new Map();

  for (const doc of documents) {
    const data = doc.data || {};
    if (!includeExcluded && data.isExcluded === true) {
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

    const candidates = getRawClientNumberCandidates(data);
    if (candidates.length === 0) {
      report.counts.missingClientNumberSkipped += 1;
      continue;
    }

    if (!groups.has(identity.key)) groups.set(identity.key, createGroup(identity));
    const group = groups.get(identity.key);
    incrementMap(group.clientNames, getClientName(data));
    group.documents.push(doc);
    for (const candidate of candidates) addCandidate(group, candidate, doc);
  }

  return [...groups.values()].filter((group) => group.candidates.size > 1);
};

const candidateSummary = (candidate) => ({
  normalized: candidate.normalized,
  sourceCount: candidate.docs.size,
  labels: Object.fromEntries([...candidate.labels.entries()].sort()),
  fields: Object.fromEntries([...candidate.fields.entries()].sort()),
  nClienteSources: candidate.fields.get('nCliente') || 0,
  sampleDocIds: [...candidate.docs.keys()].slice(0, 12),
});

const bestLabel = (candidate) => {
  const labels = [...candidate.labels.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0], 'pt-BR', { numeric: true });
  });
  return labels[0]?.[0] || candidate.normalized;
};

const bestClient = (group) => {
  const names = [...group.clientNames.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return right[0].length - left[0].length;
  });
  return names[0]?.[0] || group.normalizedName || group.key;
};

const chooseWinner = (group, includeNameOnly) => {
  if (group.keyType === 'name' && !includeNameOnly) {
    return { safe: false, rule: 'name_only_requires_flag', winner: null };
  }

  const candidates = [...group.candidates.values()]
    .map((candidate) => ({
      ...candidate,
      count: candidate.docs.size,
      nClienteSources: candidate.fields.get('nCliente') || 0,
    }))
    .sort((left, right) => right.count - left.count);

  if (candidates.length === 2) {
    const candidateWithNCliente = candidates.filter((candidate) => candidate.nClienteSources > 0);
    if (
      candidateWithNCliente.length === 1
      && candidateWithNCliente[0].count >= Math.max(...candidates.filter((candidate) => candidate !== candidateWithNCliente[0]).map((candidate) => candidate.count))
    ) {
      return { safe: true, rule: 'only_ncliente_source', winner: candidateWithNCliente[0] };
    }

    const shorter = candidates.find((candidate) => candidates.some((other) => other.normalized === `${candidate.normalized}0`));
    const longer = shorter ? candidates.find((candidate) => candidate.normalized === `${shorter.normalized}0`) : null;
    if (shorter && longer) {
      if (shorter.nClienteSources > 0 && longer.nClienteSources === 0) {
        return { safe: true, rule: 'trailing_zero_ncliente', winner: shorter };
      }
      if (shorter.count >= 5 && shorter.count >= longer.count * 3) {
        return { safe: true, rule: 'trailing_zero_count_3x', winner: shorter };
      }
      if (shorter.count >= 5 && longer.count <= 1) {
        return { safe: true, rule: 'trailing_zero_minor_single', winner: shorter };
      }
    }
  }

  const total = candidates.reduce((sum, candidate) => sum + candidate.count, 0);
  if (candidates[0]?.count >= 10 && candidates[0].count / total >= 0.9) {
    return { safe: true, rule: 'dominant_90_percent', winner: candidates[0] };
  }

  return { safe: false, rule: 'manual_review', winner: null };
};

const buildPlan = (groups, args) => {
  const resolutions = [];
  const manualReview = [];

  for (const group of groups) {
    const decision = chooseWinner(group, args.includeNameOnly);
    const subject = {
      registryId: group.id,
      registryKey: group.key,
      keyType: group.keyType,
      cpfCnpjDigits: group.cpfCnpjDigits,
      client: bestClient(group),
      candidates: [...group.candidates.values()].map(candidateSummary),
      rule: decision.rule,
    };

    if (!decision.safe || !decision.winner) {
      manualReview.push(subject);
      continue;
    }

    const winnerNumber = decision.winner.normalized;
    const winnerLabel = bestLabel(decision.winner);
    const staleCandidates = [...group.candidates.values()].filter((candidate) => candidate.normalized !== winnerNumber);
    const transactionUpdates = [];
    for (const candidate of staleCandidates) {
      for (const [docId, doc] of candidate.docs.entries()) {
        transactionUpdates.push({
          id: docId,
          from: bestLabel(candidate),
          fromNormalized: candidate.normalized,
          to: winnerLabel,
          toNormalized: winnerNumber,
          client: getClientName(doc.data || {}),
          cpfCnpj: (doc.data || {}).cpfCnpj || '',
          dueDate: (doc.data || {}).dueDate || '',
        });
      }
    }

    resolutions.push({
      ...subject,
      winner: winnerLabel,
      winnerNormalized: winnerNumber,
      transactionUpdates,
    });
  }

  return { resolutions, manualReview };
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

const createReport = ({ args, inputPath, outPath, documentsCount }) => ({
  generatedAt: new Date().toISOString(),
  mode: args.apply ? 'apply' : 'dry-run',
  inputPath,
  outPath,
  projectId: args.projectId,
  collection: args.collection,
  registryCollection: args.registryCollection,
  includeNameOnly: args.includeNameOnly,
  counts: {
    documentsInBackup: documentsCount,
    excludedSkipped: 0,
    nonReceivableSkipped: 0,
    missingIdentitySkipped: 0,
    missingClientNumberSkipped: 0,
    conflictGroups: 0,
    safeResolutions: 0,
    manualReviewGroups: 0,
    transactionPatchesPlanned: 0,
    registryPatchesPlanned: 0,
    transactionPatchesApplied: 0,
    registryPatchesApplied: 0,
    failedPatches: 0,
  },
  resolutionsByRule: {},
  examples: {
    safeResolutions: [],
    manualReview: [],
  },
  failures: [],
  notes: [],
});

const addExample = (list, item, maxExamples) => {
  if (list.length < maxExamples) list.push(item);
};

const attachPlanToReport = (report, groups, plan, args) => {
  report.counts.conflictGroups = groups.length;
  report.counts.safeResolutions = plan.resolutions.length;
  report.counts.manualReviewGroups = plan.manualReview.length;
  report.counts.transactionPatchesPlanned = plan.resolutions.reduce((sum, resolution) => sum + resolution.transactionUpdates.length, 0);
  report.counts.registryPatchesPlanned = plan.resolutions.length;

  for (const resolution of plan.resolutions) {
    report.resolutionsByRule[resolution.rule] = (report.resolutionsByRule[resolution.rule] || 0) + 1;
    addExample(report.examples.safeResolutions, {
      registryId: resolution.registryId,
      client: resolution.client,
      keyType: resolution.keyType,
      rule: resolution.rule,
      winner: resolution.winner,
      patches: resolution.transactionUpdates.length,
      candidates: resolution.candidates.map((candidate) => ({
        normalized: candidate.normalized,
        sourceCount: candidate.sourceCount,
        nClienteSources: candidate.nClienteSources,
      })),
    }, args.maxExamples);
  }

  for (const item of plan.manualReview) {
    addExample(report.examples.manualReview, {
      registryId: item.registryId,
      client: item.client,
      keyType: item.keyType,
      rule: item.rule,
      candidates: item.candidates.map((candidate) => ({
        normalized: candidate.normalized,
        sourceCount: candidate.sourceCount,
        nClienteSources: candidate.nClienteSources,
      })),
    }, args.maxExamples);
  }

  if (!args.apply) report.notes.push('Dry-run only. No Firebase documents were changed.');
  if (!args.includeNameOnly) report.notes.push('Name-only conflict groups were left for manual review. Re-run with --include-name-only for conservative name-only rules.');
};

const buildRegistryPatch = (resolution) => ({
  status: 'ready',
  clientNumber: resolution.winner,
  clientNumberNormalized: resolution.winnerNormalized,
  conflictResolvedAt: new Date().toISOString(),
  conflictResolutionRule: resolution.rule,
  conflictResolutionSource: 'resolve-client-number-conflicts',
  updatedAt: new Date().toISOString(),
});

const applyPlan = async (report, plan, args) => {
  const token = getAccessToken();

  for (const resolution of plan.resolutions) {
    for (const update of resolution.transactionUpdates) {
      try {
        await patchDocumentFields(args.projectId, `${args.collection}/${encodeURIComponent(update.id)}`, token, {
          clientNumber: update.to,
          clientNumberSource: resolution.registryId,
          clientNumberConflictResolvedAt: new Date().toISOString(),
          clientNumberConflictResolutionRule: resolution.rule,
          updatedAt: new Date().toISOString(),
        });
        report.counts.transactionPatchesApplied += 1;
      } catch (error) {
        report.counts.failedPatches += 1;
        report.failures.push({
          id: update.id,
          path: `${args.collection}/${update.id}`,
          error: error.message || String(error),
        });
      }
    }

    try {
      await patchDocumentFields(args.projectId, `${args.registryCollection}/${encodeURIComponent(resolution.registryId)}`, token, buildRegistryPatch(resolution));
      report.counts.registryPatchesApplied += 1;
    } catch (error) {
      report.counts.failedPatches += 1;
      report.failures.push({
        id: resolution.registryId,
        path: `${args.registryCollection}/${resolution.registryId}`,
        error: error.message || String(error),
      });
    }
  }
};

const buildMarkdown = (report) => {
  const lines = [
    '# Client Number Conflict Resolution',
    '',
    `Generated at: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.inputPath}`,
    `Include name-only: ${report.includeNameOnly}`,
    '',
    '## Counts',
    '',
    `- Conflict groups: ${report.counts.conflictGroups}`,
    `- Safe resolutions: ${report.counts.safeResolutions}`,
    `- Manual-review groups: ${report.counts.manualReviewGroups}`,
    `- Transaction patches planned: ${report.counts.transactionPatchesPlanned}`,
    `- Registry patches planned: ${report.counts.registryPatchesPlanned}`,
    `- Transaction patches applied: ${report.counts.transactionPatchesApplied}`,
    `- Registry patches applied: ${report.counts.registryPatchesApplied}`,
    `- Failed patches: ${report.counts.failedPatches}`,
    '',
    '## Rules',
    '',
  ];

  const rules = Object.entries(report.resolutionsByRule).sort((left, right) => right[1] - left[1]);
  if (rules.length === 0) lines.push('- No automatic rules matched.');
  for (const [rule, count] of rules) lines.push(`- ${rule}: ${count}`);

  lines.push('', '## Safe Examples', '');
  if (report.examples.safeResolutions.length === 0) {
    lines.push('- No safe examples.');
  } else {
    for (const item of report.examples.safeResolutions.slice(0, 20)) {
      lines.push(`- ${item.registryId}: ${item.client} -> ${item.winner} (${item.rule}, ${item.patches} transaction patch(es))`);
    }
  }

  lines.push('', '## Manual Review Examples', '');
  if (report.examples.manualReview.length === 0) {
    lines.push('- No manual-review examples.');
  } else {
    for (const item of report.examples.manualReview.slice(0, 20)) {
      lines.push(`- ${item.registryId}: ${item.client} (${item.rule})`);
    }
  }

  lines.push('', '## Notes', '');
  for (const note of report.notes) lines.push(`- ${note}`);

  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of report.failures.slice(0, 25)) lines.push(`- ${failure.id}: ${failure.error}`);
  }

  return `${lines.join('\n')}\n`;
};

const buildCsv = (plan) => {
  const rows = [[
    'kind',
    'registryId',
    'client',
    'keyType',
    'rule',
    'winner',
    'candidateNumbers',
    'transactionId',
    'from',
    'to',
    'dueDate',
  ]];

  for (const resolution of plan.resolutions) {
    rows.push([
      'resolution',
      resolution.registryId,
      resolution.client,
      resolution.keyType,
      resolution.rule,
      resolution.winner,
      resolution.candidates.map((candidate) => `${candidate.normalized}:${candidate.sourceCount}`).join(', '),
      '',
      '',
      '',
      '',
    ]);

    for (const update of resolution.transactionUpdates) {
      rows.push([
        'transaction_patch',
        resolution.registryId,
        update.client,
        resolution.keyType,
        resolution.rule,
        resolution.winner,
        '',
        update.id,
        update.from,
        update.to,
        update.dueDate,
      ]);
    }
  }

  for (const item of plan.manualReview) {
    rows.push([
      'manual_review',
      item.registryId,
      item.client,
      item.keyType,
      item.rule,
      '',
      item.candidates.map((candidate) => `${candidate.normalized}:${candidate.sourceCount}`).join(', '),
      '',
      '',
      '',
      '',
    ]);
  }

  return rows
    .map((row) => row.map((cell) => `"${clean(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n') + '\n';
};

const writeReport = (report, plan) => {
  mkdirSync(dirname(report.outPath), { recursive: true });
  writeFileSync(report.outPath, `${JSON.stringify({
    ...report,
    resolutions: plan.resolutions,
    manualReview: plan.manualReview,
  }, null, 2)}\n`);
  writeFileSync(report.outPath.replace(/\.json$/i, '.md'), buildMarkdown(report));
  writeFileSync(report.outPath.replace(/\.json$/i, '.csv'), buildCsv(plan));
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatestBackup());
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error('No Firestore backup found. Run npm run backup:firestore or pass --input <path>.');
  }

  const outPath = resolve(args.out || `${REPORT_DIR}/client-number-conflict-resolution-${timestampForFile()}.json`);
  const documents = loadDocuments(inputPath, args.collection);
  const report = createReport({ args, inputPath, outPath, documentsCount: documents.length });
  const groups = buildGroups(documents, report, false);
  const plan = buildPlan(groups, args);
  attachPlanToReport(report, groups, plan, args);

  if (args.apply) await applyPlan(report, plan, args);
  writeReport(report, plan);

  console.log(`Client number conflict resolution ${report.mode} complete`);
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${outPath.replace(/\.json$/i, '.md')}`);
  console.log(`CSV report: ${outPath.replace(/\.json$/i, '.csv')}`);
  console.log(`Conflict groups: ${report.counts.conflictGroups}`);
  console.log(`Safe resolutions: ${report.counts.safeResolutions}`);
  console.log(`Manual-review groups: ${report.counts.manualReviewGroups}`);
  console.log(`Transaction patches planned: ${report.counts.transactionPatchesPlanned}`);
  console.log(`Registry patches planned: ${report.counts.registryPatchesPlanned}`);
  console.log(`Transaction patches applied: ${report.counts.transactionPatchesApplied}`);
  console.log(`Registry patches applied: ${report.counts.registryPatchesApplied}`);
  console.log(`Failed patches: ${report.counts.failedPatches}`);

  if (report.counts.failedPatches > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
