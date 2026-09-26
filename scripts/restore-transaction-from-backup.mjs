#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const getArg = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

const backupPath = getArg('--backup');
const docId = getArg('--doc-id');
const expectedSubmissionId = getArg('--expected-current-submission-id');
const confirmationDocId = getArg('--confirm-doc-id');
const apply = args.includes('--apply');
const projectId = getArg('--project') || 'gen-lang-client-0888019226';

if (!backupPath || !docId || !expectedSubmissionId) {
  throw new Error('Use --backup, --doc-id e --expected-current-submission-id. Adicione --apply --confirm-doc-id <mesmo-doc-id> para gravar.');
}

if (apply && confirmationDocId !== docId) {
  throw new Error(`Aplicacao bloqueada: confirme o documento exato com --confirm-doc-id ${docId}.`);
}

const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const collection = (backup.collections || []).find(item => item.name === 'transactions');
const source = collection && (collection.documents || []).find(item => item.id === docId);
if (!source) throw new Error(`Documento ${docId} nao encontrado no backup`);

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/transactions/${encodeURIComponent(docId)}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const currentResponse = await fetch(baseUrl, { headers });
if (!currentResponse.ok) throw new Error(`Falha ao ler documento atual: ${await currentResponse.text()}`);
const current = await currentResponse.json();
const currentSubmissionId = current.fields && current.fields.submissionId && current.fields.submissionId.stringValue;
if (currentSubmissionId !== expectedSubmissionId) {
  throw new Error(`Precondicao falhou: submissionId atual=${currentSubmissionId || '-'} esperado=${expectedSubmissionId}`);
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  docId,
  currentSubmissionId,
  restoreSubmissionId: source.data.submissionId,
  currentUpdateTime: current.updateTime,
  backupGeneratedAt: backup.generatedAt,
}, null, 2));

if (!apply) process.exit(0);

const toField = value => {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toField) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, toField(nestedValue)])) } };
  }
  return { stringValue: String(value ?? '') };
};
const fields = Object.fromEntries(Object.entries(source.data).map(([key, value]) => [key, toField(value)]));
const url = new URL(baseUrl);
url.searchParams.set('currentDocument.updateTime', current.updateTime);
const patchResponse = await fetch(url, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ fields }),
});
if (!patchResponse.ok) throw new Error(`Restore falhou: ${await patchResponse.text()}`);
const restored = await patchResponse.json();
console.log(JSON.stringify({ ok: true, docId, updateTime: restored.updateTime }, null, 2));
