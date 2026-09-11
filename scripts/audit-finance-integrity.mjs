#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPORT_DIR = 'migration-backups';
const DEFAULT_COLLECTION = 'transactions';
const DEFAULT_MAX_EXAMPLES = 40;

const usage = `
Usage:
  node scripts/audit-finance-integrity.mjs [options]

Options:
  --input <path>        Firestore backup JSON to audit. Default: latest migration-backups/firestore-data-backup-*.json
  --out <path>          JSON report path. Default: migration-backups/finance-integrity-audit-<timestamp>.json
  --collection <name>   Collection name inside the backup. Default: ${DEFAULT_COLLECTION}
  --max-examples <n>    Max examples stored per finding code. Default: ${DEFAULT_MAX_EXAMPLES}
  --include-excluded    Include records marked isExcluded=true. Default: skip them because the app hides them.
  --due-from <date>     Audit only records with dueDate >= date.
  --due-to <date>       Audit only records with dueDate <= date.
  --fail-on <severity>  Exit 1 when findings exist at or above severity: low, medium, high, critical.
  --help                Show this help.

This script is read-only. It audits financial integrity issues that usually precede duplicated or stale dashboard rows.
`;

const severityOrder = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const findingDescriptions = {
  DUPLICATE_SUBMISSION_ID: 'The same Jotform submissionId is active in more than one Firestore document.',
  PAID_AND_OPEN_DUPLICATE: 'Same client/document, due date and amount have both paid and open active records.',
  EXACT_ACTIVE_DUPLICATE: 'Same client/document, due date, amount and business detail appear in more than one active document.',
  OPEN_WITH_PAYMENT_EVIDENCE: 'Open record has payment evidence such as payment date, paid flag or paid amount.',
  PAID_WITHOUT_PAYMENT_EVIDENCE: 'Paid record has no payment date and no paid amount evidence.',
  ENTRADA_WITHOUT_RECEIVABLE_TOTAL: 'Receivable record has no receivable amount.',
  SAIDA_WITHOUT_PAYABLE_TOTAL: 'Payable record has no payable amount.',
  CLIENT_NUMBER_CONFLICT: 'Same CPF/CNPJ appears with more than one N.Cliente.',
  MISSING_CLIENT_NUMBER: 'Receivable record has CPF/CNPJ but no N.Cliente.',
  TOTAL_COBRANCA_MISMATCH: 'totalCobranca differs from honorarios + valorExtra.',
  STATUS_ALIAS: 'Status uses an alias instead of the canonical value.',
  DIRECTION_VALUE_CONFLICT: 'Record has both payable and receivable amounts filled.',
};

const parseArgs = (argv) => {
  const args = {
    input: '',
    out: '',
    collection: DEFAULT_COLLECTION,
    maxExamples: DEFAULT_MAX_EXAMPLES,
    includeExcluded: false,
    failOn: '',
    dueFrom: '',
    dueTo: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--max-examples') args.maxExamples = Number(argv[++index]);
    else if (arg === '--include-excluded') args.includeExcluded = true;
    else if (arg === '--fail-on') args.failOn = String(argv[++index] || '').toLowerCase();
    else if (arg === '--due-from') args.dueFrom = String(argv[++index] || '').trim();
    else if (arg === '--due-to') args.dueTo = String(argv[++index] || '').trim();
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
const normalizeText = (value) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const cleanDigits = (value) => clean(value).replace(/\D/g, '');
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
  if (normalized === 'pago') return { canonical: 'Pago', alias: false };
  if (normalized === 'pendente') return { canonical: 'Pendente', alias: false };
  if (normalized === 'agendado') return { canonical: 'Agendado', alias: false };
  if (['paga', 'sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(normalized)) {
    return { canonical: 'Pago', alias: true };
  }
  if (['nao', 'n', 'aberto', 'em aberto'].includes(normalized)) {
    return { canonical: 'Pendente', alias: true };
  }
  if (normalized === 'programado') return { canonical: 'Agendado', alias: true };
  return { canonical: normalized ? clean(value) : 'Pendente', alias: false };
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

const getClientNumber = (data) => {
  const value = clean(data.clientNumber ?? data.nCliente ?? data.codigoCliente);
  return value && value !== '-' ? value : '';
};

const normalizeClientNumberForCompare = (value) => {
  const raw = getClientNumber(value);
  if (!raw) return '';
  const digits = cleanDigits(raw);
  if (!digits) return raw;
  return digits.replace(/^0+(?=\d)/, '') || '0';
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

const isEmployeeBenefitPayable = (data) => {
  if (canonicalMovement(data) !== 'Saida') return false;
  const category = normalizeText(`${data.client || ''} ${data.description || ''}`);
  const detail = normalizeText(data.observacaoAPagar || data.observacao || '');
  return category.includes('vale refeicao')
    || category.includes('vale transporte')
    || category.includes('domestica vt')
    || /^(vr|vt)\b/.test(detail);
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

const hasPaymentEvidence = (data, direction, mode = 'explicit') => {
  const statusFlags = [
    data.pago,
    data.docPago,
    data.docPagoReceber,
    data.docPagoPagar,
    data.documentoPago,
  ].map(normalizeText);
  const hasPaidFlag = statusFlags.some((value) => ['sim', 's', 'pago', 'paga', 'quitado'].includes(value));
  const hasPaymentDate = Boolean(clean(data.paymentDate || data.dataPagamento || data.dataBaixa || data.dataRecebimento));
  const explicitPaidAmount = firstPositive([data.valorPago, data.valorRecebido, data.paidAmount, data.amountPaid]);
  if (mode === 'explicit') return hasPaidFlag || hasPaymentDate || isPositive(explicitPaidAmount);

  const directionalAmount = direction === 'Entrada'
    ? firstPositive([data.valueReceived])
    : firstPositive([data.valuePaid]);
  return hasPaidFlag || hasPaymentDate || isPositive(explicitPaidAmount) || isPositive(directionalAmount);
};

const summarizeDoc = (doc, extra = {}) => {
  const data = doc.data || {};
  return {
    id: doc.id,
    type: data.type || '',
    movement: data.movement || '',
    status: data.status || '',
    date: data.date || '',
    dueDate: data.dueDate || '',
    paymentDate: data.paymentDate || '',
    client: data.client || '',
    description: data.description || '',
    cpfCnpj: data.cpfCnpj || '',
    clientNumber: getClientNumber(data),
    valuePaid: parseMoney(data.valuePaid),
    valueReceived: parseMoney(data.valueReceived),
    valorOriginal: parseMoney(data.valorOriginal),
    totalCobranca: parseMoney(data.totalCobranca),
    submissionId: data.submissionId || '',
    source: data.source || '',
    isExcluded: data.isExcluded === true,
    ...extra,
  };
};

const createReport = ({ inputPath, collectionName, includeExcluded, maxExamples, documentCount }) => ({
  generatedAt: new Date().toISOString(),
  inputPath,
  collection: collectionName,
  includeExcluded,
  counts: {
    documentsInBackup: documentCount,
    documentsAudited: 0,
    excludedSkipped: 0,
    dateRangeSkipped: 0,
    findings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  },
  findingsByCode: {},
  nextActions: [],
  limits: { maxExamplesPerCode: maxExamples },
});

const addFinding = (report, severity, code, message, subject, details = {}) => {
  report.counts.findings += 1;
  report.counts[severity] += 1;
  if (!report.findingsByCode[code]) {
    report.findingsByCode[code] = {
      severity,
      code,
      description: findingDescriptions[code] || message,
      count: 0,
      examples: [],
    };
  }
  const bucket = report.findingsByCode[code];
  bucket.count += 1;
  if (bucket.examples.length < report.limits.maxExamplesPerCode) {
    bucket.examples.push({ message, subject, details });
  }
};

const buildDuplicateKey = (doc) => {
  const data = doc.data || {};
  if (isEmployeeBenefitPayable(data)) return '';
  const direction = canonicalMovement(data);
  const clientKey = getClientKey(data);
  const dueDate = clean(data.dueDate);
  const amount = getAmount(data, direction);
  if (!direction || !clientKey || !dueDate || !isPositive(amount)) return '';
  return [direction, clientKey, dueDate, amount.toFixed(2), getDuplicateDetailKey(data, direction)].join('|');
};

const buildBaseDuplicateKey = (doc) => {
  const data = doc.data || {};
  if (isEmployeeBenefitPayable(data)) return '';
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

const buildMarkdown = (report) => {
  const lines = [
    '# Finance Integrity Audit',
    '',
    `Generated at: ${report.generatedAt}`,
    `Input: ${report.inputPath}`,
    `Collection: ${report.collection}`,
    `Documents in backup: ${report.counts.documentsInBackup}`,
    `Documents audited: ${report.counts.documentsAudited}`,
    `Excluded skipped: ${report.counts.excludedSkipped}`,
    `Date range skipped: ${report.counts.dateRangeSkipped}`,
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

  const buckets = Object.values(report.findingsByCode)
    .sort((left, right) => (severityOrder[right.severity] - severityOrder[left.severity]) || right.count - left.count);
  if (buckets.length === 0) {
    lines.push('- No integrity findings.');
  } else {
    for (const bucket of buckets) {
      lines.push(`- ${bucket.severity.toUpperCase()} ${bucket.code}: ${bucket.count} - ${bucket.description}`);
    }
  }

  lines.push('', '## Examples', '');
  for (const bucket of buckets) {
    lines.push(`### ${bucket.code}`, '');
    for (const example of bucket.examples.slice(0, 10)) {
      let subject = 'group';
      if (example.subject?.id) {
        subject = example.subject.id;
      } else if (Array.isArray(example.subject?.documents)) {
        subject = example.subject.documents.map((doc) => doc.id).filter(Boolean).join(', ');
      } else if (example.subject?.cpfCnpjDigits) {
        subject = example.subject.cpfCnpjDigits;
      }
      lines.push(`- ${subject}: ${example.message}`);
    }
    lines.push('');
  }

  lines.push('## Next Actions', '');
  for (const action of report.nextActions) {
    lines.push(`- ${action}`);
  }
  return `${lines.join('\n')}\n`;
};

const buildCsv = (report) => {
  const rows = [['severity', 'code', 'message', 'doc_ids', 'client', 'dueDate', 'amount', 'submissionId']];
  for (const bucket of Object.values(report.findingsByCode)) {
    for (const example of bucket.examples) {
      const subject = example.subject || {};
      const docs = Array.isArray(subject.documents) ? subject.documents : [subject];
      rows.push([
        bucket.severity,
        bucket.code,
        example.message,
        docs.map((doc) => doc.id).filter(Boolean).join(', '),
        docs.map((doc) => doc.client || doc.description || '').filter(Boolean)[0] || '',
        docs.map((doc) => doc.dueDate || '').filter(Boolean)[0] || '',
        clean(example.details?.amount ?? docs.map((doc) => doc.amount || doc.totalCobranca || doc.valorOriginal || '').find(Boolean) ?? ''),
        docs.map((doc) => doc.submissionId || '').filter(Boolean).join(', '),
      ]);
    }
  }
  return rows
    .map((row) => row.map((cell) => `"${clean(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n') + '\n';
};

const buildNextActions = (report) => {
  const codes = new Set(Object.keys(report.findingsByCode));
  const actions = [];
  if (codes.has('DUPLICATE_SUBMISSION_ID') || codes.has('PAID_AND_OPEN_DUPLICATE')) {
    actions.push('Review high-risk duplicate groups before month-end reports and exclude only the stale record after confirming Jotform history.');
  }
  if (codes.has('OPEN_WITH_PAYMENT_EVIDENCE')) {
    actions.push('Update open records with payment evidence to Pago or exclude the stale duplicate when a paid record already exists.');
  }
  if (codes.has('CLIENT_NUMBER_CONFLICT') || codes.has('MISSING_CLIENT_NUMBER')) {
    actions.push('Create or reconcile the official client registry in Firebase so N.Cliente always comes from cadastro, not display order.');
  }
  if (codes.has('STATUS_ALIAS') || codes.has('TOTAL_COBRANCA_MISMATCH') || codes.has('DIRECTION_VALUE_CONFLICT')) {
    actions.push('Run the transaction normalizer in dry-run mode and apply only reviewed safe batches.');
  }
  if (actions.length === 0) {
    actions.push('No blocking integrity issues found in active transactions.');
  }
  report.nextActions = actions;
};

const isInsideDueRange = (data, dueFrom, dueTo) => {
  const dueDate = clean(data.dueDate);
  if (!dueDate) return true;
  if (dueFrom && dueDate < dueFrom) return false;
  if (dueTo && dueDate > dueTo) return false;
  return true;
};

const auditDocuments = (report, documents, args) => {
  const activeDocs = [];
  const bySubmissionId = new Map();
  const byDuplicateKey = new Map();
  const byBaseDuplicateKey = new Map();
  const clientNumbersByDocument = new Map();

  for (const doc of documents) {
    const data = doc.data || {};
    if (!report.includeExcluded && data.isExcluded === true) {
      report.counts.excludedSkipped += 1;
      continue;
    }
    if (!isInsideDueRange(data, args.dueFrom, args.dueTo)) {
      report.counts.dateRangeSkipped += 1;
      continue;
    }
    report.counts.documentsAudited += 1;
    activeDocs.push(doc);

    const direction = canonicalMovement(data);
    const status = canonicalStatus(data.status);
    const amount = getAmount(data, direction);
    const valuePaid = parseMoney(data.valuePaid);
    const valueReceived = parseMoney(data.valueReceived);
    const totalCobranca = parseMoney(data.totalCobranca);
    const honorarios = parseMoney(data.honorarios);
    const valorExtra = parseMoney(data.valorExtra ?? data.extras);
    const explicitPaymentEvidence = hasPaymentEvidence(data, direction, 'explicit');
    const minimumPaymentEvidence = hasPaymentEvidence(data, direction, 'minimum');

    if (status.alias) {
      addFinding(report, 'medium', 'STATUS_ALIAS', 'Status should be saved in canonical form.', summarizeDoc(doc, {
        canonicalStatus: status.canonical,
      }));
    }

    if (status.canonical !== 'Pago' && explicitPaymentEvidence) {
      addFinding(report, 'high', 'OPEN_WITH_PAYMENT_EVIDENCE', 'Open record has evidence that it was paid/settled.', summarizeDoc(doc, {
        direction,
        amount,
      }));
    }

    if (status.canonical === 'Pago' && !minimumPaymentEvidence) {
      addFinding(report, 'medium', 'PAID_WITHOUT_PAYMENT_EVIDENCE', 'Paid record has no payment evidence fields.', summarizeDoc(doc, {
        direction,
        amount,
      }));
    }

    if (direction === 'Entrada' && !isPositive(firstPositive([totalCobranca, data.valorOriginal, valueReceived, honorarios + valorExtra]))) {
      addFinding(report, 'high', 'ENTRADA_WITHOUT_RECEIVABLE_TOTAL', 'Receivable has no total amount.', summarizeDoc(doc));
    }

    if (direction === 'Saida' && !isPositive(firstPositive([valuePaid, data.valorOriginal, totalCobranca, honorarios + valorExtra]))) {
      addFinding(report, 'high', 'SAIDA_WITHOUT_PAYABLE_TOTAL', 'Payable has no total amount.', summarizeDoc(doc));
    }

    if (isPositive(valuePaid) && isPositive(valueReceived)) {
      addFinding(report, 'medium', 'DIRECTION_VALUE_CONFLICT', 'Both payable and receivable values are positive.', summarizeDoc(doc));
    }

    if (isPositive(totalCobranca) && (isPositive(honorarios) || isPositive(valorExtra))) {
      const expected = roundMoney(honorarios + valorExtra);
      if (Math.abs(totalCobranca - expected) >= 0.01) {
        addFinding(report, 'low', 'TOTAL_COBRANCA_MISMATCH', 'totalCobranca differs from honorarios + valorExtra.', summarizeDoc(doc, {
          expectedTotal: expected,
        }));
      }
    }

    const submissionId = clean(data.submissionId);
    if (submissionId) {
      if (!bySubmissionId.has(submissionId)) bySubmissionId.set(submissionId, []);
      bySubmissionId.get(submissionId).push(doc);
    }

    const duplicateKey = buildDuplicateKey(doc);
    if (duplicateKey) {
      if (!byDuplicateKey.has(duplicateKey)) byDuplicateKey.set(duplicateKey, []);
      byDuplicateKey.get(duplicateKey).push(doc);
    }
    const baseDuplicateKey = buildBaseDuplicateKey(doc);
    if (baseDuplicateKey) {
      if (!byBaseDuplicateKey.has(baseDuplicateKey)) byBaseDuplicateKey.set(baseDuplicateKey, []);
      byBaseDuplicateKey.get(baseDuplicateKey).push(doc);
    }

    const documentKey = cleanDigits(data.cpfCnpj || data.cpfCNPJ || data.cnpj || data.cpf);
    const clientNumber = getClientNumber(data);
    const clientNumberKey = normalizeClientNumberForCompare(data);
    if (documentKey && clientNumber) {
      if (!clientNumbersByDocument.has(documentKey)) clientNumbersByDocument.set(documentKey, new Map());
      const numbers = clientNumbersByDocument.get(documentKey);
      if (!numbers.has(clientNumberKey)) numbers.set(clientNumberKey, { labels: new Set(), documents: [] });
      const bucket = numbers.get(clientNumberKey);
      bucket.labels.add(clientNumber);
      bucket.documents.push(doc);
    }
    if (direction === 'Entrada' && documentKey && !clientNumber) {
      addFinding(report, 'medium', 'MISSING_CLIENT_NUMBER', 'Receivable has CPF/CNPJ but no N.Cliente.', summarizeDoc(doc));
    }
  }

  for (const [submissionId, group] of bySubmissionId.entries()) {
    if (group.length <= 1) continue;
    addFinding(report, 'high', 'DUPLICATE_SUBMISSION_ID', `submissionId ${submissionId} appears in ${group.length} active documents.`, {
      submissionId,
      documents: group.map((doc) => summarizeDoc(doc)),
    });
  }

  const reportedDuplicateDocIds = new Set();

  for (const [duplicateKey, group] of byDuplicateKey.entries()) {
    if (group.length <= 1) continue;
    const paid = group.filter((doc) => canonicalStatus(doc.data?.status).canonical === 'Pago');
    const open = group.filter((doc) => canonicalStatus(doc.data?.status).canonical !== 'Pago');
    const severity = paid.length > 0 && open.length > 0 ? 'high' : 'medium';
    const code = severity === 'high' ? 'PAID_AND_OPEN_DUPLICATE' : 'EXACT_ACTIVE_DUPLICATE';
    const amount = duplicateKey.split('|').at(-2);
    addFinding(report, severity, code, `${group.length} active records share client/document, due date and amount.`, {
      duplicateKey,
      amount,
      paidCount: paid.length,
      openCount: open.length,
      documents: group.map((doc) => summarizeDoc(doc)),
    });
    for (const doc of group) reportedDuplicateDocIds.add(doc.id);
  }

  for (const [duplicateKey, group] of byBaseDuplicateKey.entries()) {
    if (group.length <= 1) continue;

    const paid = group.filter((doc) => canonicalStatus(doc.data?.status).canonical === 'Pago');
    const open = group.filter((doc) => canonicalStatus(doc.data?.status).canonical !== 'Pago');
    if (paid.length === 0 || open.length === 0) continue;

    const compatibleOpen = open.filter((openDoc) => (
      !reportedDuplicateDocIds.has(openDoc.id)
      && paid.some((paidDoc) => hasCompatibleBusinessDetail(openDoc, paidDoc))
    ));
    if (compatibleOpen.length === 0) continue;

    const documents = [...paid, ...compatibleOpen];
    addFinding(report, 'high', 'PAID_AND_OPEN_DUPLICATE', `${documents.length} active records share client/document, due date and amount with compatible payment details.`, {
      duplicateKey,
      amount: duplicateKey.split('|').at(-1),
      paidCount: paid.length,
      openCount: compatibleOpen.length,
      documents: documents.map((doc) => summarizeDoc(doc)),
    });
    for (const doc of documents) reportedDuplicateDocIds.add(doc.id);
  }

  for (const [documentKey, numbers] of clientNumbersByDocument.entries()) {
    if (numbers.size <= 1) continue;
    addFinding(report, 'medium', 'CLIENT_NUMBER_CONFLICT', `CPF/CNPJ ${documentKey} has multiple N.Cliente values.`, {
      cpfCnpjDigits: documentKey,
      clientNumbers: Array.from(numbers.values()).flatMap((bucket) => Array.from(bucket.labels)),
      documents: Array.from(numbers.values()).flatMap((bucket) => bucket.documents).slice(0, 12).map((doc) => summarizeDoc(doc)),
    });
  }

  return activeDocs;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input || findLatestBackup());
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error('No Firestore backup found. Run npm run backup:firestore or pass --input <path>.');
  }

  const documents = loadDocuments(inputPath, args.collection);
  const outPath = resolve(args.out || `${REPORT_DIR}/finance-integrity-audit-${timestampForFile()}.json`);
  const markdownPath = outPath.replace(/\.json$/i, '.md');
  const csvPath = outPath.replace(/\.json$/i, '.csv');
  mkdirSync(dirname(outPath), { recursive: true });

  const report = createReport({
    inputPath,
    collectionName: args.collection,
    includeExcluded: args.includeExcluded,
    maxExamples: args.maxExamples,
    documentCount: documents.length,
  });

  report.filters = {
    dueFrom: args.dueFrom,
    dueTo: args.dueTo,
  };

  auditDocuments(report, documents, args);
  buildNextActions(report);

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, buildMarkdown(report));
  writeFileSync(csvPath, buildCsv(report));

  console.log('Finance integrity audit complete');
  console.log(`Input: ${inputPath}`);
  console.log(`JSON report: ${outPath}`);
  console.log(`Markdown report: ${markdownPath}`);
  console.log(`CSV report: ${csvPath}`);
  console.log(`Documents audited: ${report.counts.documentsAudited}`);
  console.log(`Excluded skipped: ${report.counts.excludedSkipped}`);
  console.log(`Findings: ${report.counts.findings}`);
  console.log(`Critical: ${report.counts.critical}`);
  console.log(`High: ${report.counts.high}`);
  console.log(`Medium: ${report.counts.medium}`);
  console.log(`Low: ${report.counts.low}`);

  if (args.failOn) {
    const threshold = severityOrder[args.failOn];
    const shouldFail = Object.entries(severityOrder)
      .some(([severity, weight]) => weight >= threshold && report.counts[severity] > 0);
    if (shouldFail) process.exitCode = 1;
  }
};

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
