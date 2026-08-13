import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ID = 'gen-lang-client-0888019226';
const APPLY = process.argv.includes('--apply');
const COLLECTION_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/transactions`;

// Evidencia: telas Wix fornecidas em 13/08/2026. A data efetiva da baixa nao
// aparece nas telas; por isso este reparo nao inventa nem altera paymentDate.
const REPAIRS = [
  {
    id: 'wix-inv-0004174',
    invoiceNumber: '0004174',
    clientIncludes: 'REALITY COM',
    beforeAmounts: [7870],
    amount: 7870,
  },
  {
    id: 'wix-inv-0004175',
    invoiceNumber: '0004175',
    clientIncludes: 'KROYA',
    beforeAmounts: [6600, 3300],
    amount: 3300,
  },
  {
    id: 'wix-inv-0004180',
    invoiceNumber: '0004180',
    clientIncludes: 'CASA DA CRIANCA',
    beforeAmounts: [7800],
    amount: 7800,
  },
];

function token() {
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('nullValue' in value) return null;
  return null;
}

function decodeDocument(payload) {
  return Object.fromEntries(
    Object.entries(payload.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
}

async function readDocument(accessToken, id) {
  const response = await fetch(`${COLLECTION_URL}/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`GET ${id} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return decodeDocument(await response.json());
}

function validateTarget(repair, current) {
  const failures = [];
  if (current.id !== repair.id) failures.push(`id=${current.id}`);
  if (String(current.source || '').toLowerCase() !== 'wix') failures.push(`source=${current.source}`);
  if (current.wixInvoiceNumber !== repair.invoiceNumber) failures.push(`wixInvoiceNumber=${current.wixInvoiceNumber}`);
  if (!String(current.client || '').toUpperCase().includes(repair.clientIncludes)) failures.push(`client=${current.client}`);
  if (!repair.beforeAmounts.includes(Number(current.valorOriginal))) failures.push(`valorOriginal=${current.valorOriginal}`);
  if (failures.length) throw new Error(`Precondition failed for ${repair.id}: ${failures.join(', ')}`);
}

async function patchDocument(accessToken, repair) {
  const updatedAt = new Date().toISOString();
  const fields = {
    status: { stringValue: 'Paga' },
    valorOriginal: { doubleValue: repair.amount },
    valueReceived: { doubleValue: repair.amount },
    valuePaid: { doubleValue: 0 },
    updatedAt: { stringValue: updatedAt },
  };
  const masks = Object.keys(fields).map((field) => `updateMask.fieldPaths=${field}`).join('&');
  const response = await fetch(`${COLLECTION_URL}/${repair.id}?${masks}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`PATCH ${repair.id} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
}

const accessToken = token();
const results = [];

for (const repair of REPAIRS) {
  const before = await readDocument(accessToken, repair.id);
  validateTarget(repair, before);
  const alreadyCorrect = before.status === 'Paga'
    && Number(before.valorOriginal) === repair.amount
    && Number(before.valueReceived) === repair.amount
    && Number(before.valuePaid) === 0;

  if (APPLY && !alreadyCorrect) await patchDocument(accessToken, repair);
  const after = APPLY ? await readDocument(accessToken, repair.id) : before;

  if (APPLY) {
    const verified = after.status === 'Paga'
      && Number(after.valorOriginal) === repair.amount
      && Number(after.valueReceived) === repair.amount
      && Number(after.valuePaid) === 0;
    if (!verified) throw new Error(`Postcondition failed for ${repair.id}`);
  }

  results.push({
    id: repair.id,
    action: alreadyCorrect ? 'already-correct' : (APPLY ? 'updated' : 'would-update'),
    before: {
      status: before.status,
      valorOriginal: before.valorOriginal,
      valueReceived: before.valueReceived,
      valuePaid: before.valuePaid,
      paymentDate: before.paymentDate || '',
    },
    after: {
      status: APPLY ? after.status : 'Paga',
      valorOriginal: APPLY ? after.valorOriginal : repair.amount,
      valueReceived: APPLY ? after.valueReceived : repair.amount,
      valuePaid: APPLY ? after.valuePaid : 0,
      paymentDate: after.paymentDate || '',
    },
  });
}

const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z');
const reportDir = resolve('migration-backups');
mkdirSync(reportDir, { recursive: true });
const reportPath = resolve(reportDir, `wix-invoice-payment-repair-${stamp}.json`);
writeFileSync(reportPath, `${JSON.stringify({ projectId: PROJECT_ID, mode: APPLY ? 'apply' : 'dry-run', results }, null, 2)}\n`);

console.log(`Wix invoice repair ${APPLY ? 'apply' : 'dry-run'} complete`);
console.log(`Report: ${reportPath}`);
for (const result of results) console.log(`${result.id}: ${result.action}`);
