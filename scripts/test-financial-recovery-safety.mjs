import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const reconcile = read('scripts/reconcile-wix-invoice-issue-dates.mjs');
const restore = read('scripts/restore-transaction-from-backup.mjs');

assert.match(reconcile, /--confirm-count=/, 'A reconciliacao Wix deve exigir a confirmacao da quantidade planejada.');
assert.doesNotMatch(reconcile, /\/opt\/homebrew\/bin\/gcloud/, 'O gcloud nao pode depender de um caminho local fixo.');
assert.match(restore, /--confirm-doc-id/, 'A restauracao deve exigir a confirmacao do documento exato.');
assert.match(restore, /arrayValue/, 'A restauracao deve preservar arrays do Firestore.');
assert.match(restore, /mapValue/, 'A restauracao deve preservar mapas do Firestore.');

console.log('OK: scripts de recuperacao exigem confirmacao explicita e preservam tipos compostos.');
