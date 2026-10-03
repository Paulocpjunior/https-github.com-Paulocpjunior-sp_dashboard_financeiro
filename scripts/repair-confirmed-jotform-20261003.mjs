// One-time, allowlisted repair. Dry-run by default; never creates/deletes documents.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extractContasPagar, extractContasReceber, parseValor } = require('../cloud-run/jotform-webhook/index.js');
assert.ok(process.argv.slice(2).every(a => a === '--apply'), 'Unknown argument');
const apply = process.argv.includes('--apply');
const project = 'gen-lang-client-0888019226';
const ids = ['6629699207919695841', '6629773467917781938', '6654604995326788504', '6653893575322147008'];
const replacement = '6667496060314434150';
const baseline = JSON.parse(readFileSync('migration-backups/firestore-data-backup-20261003T105904Z.json', 'utf8'));
assert.equal(baseline.projectId, project);
const baselineDocs = baseline.collections.find(c => c.name === 'transactions').documents;
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const service = JSON.parse(execFileSync('gcloud', ['run', 'services', 'describe', 'jotform-webhook', '--region=southamerica-east1', `--project=${project}`, '--format=json'], { encoding: 'utf8' }));
const key = service.spec.template.spec.containers[0].env.find(e => e.name === 'JOTFORM_API_KEY')?.value;
assert.ok(key, 'Jotform credentials unavailable');
const root = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function request(url, options) {
  const r = await fetch(url, options);
  assert.ok(r.ok, `Request failed (${r.status})`);
  return r.json();
}
const docs = {}, submissions = {}, raw = {};
for (const id of [...ids, replacement]) {
  docs[id] = await request(`${root}/transactions/trx-jf-${id}`, { headers: auth });
  const result = await request(`https://api.jotform.com/submission/${id}`, { headers: { APIKEY: key } });
  assert.equal(result.responseCode, 200);
  submissions[id] = result.content;
  assert.equal(String(result.content.id), id);
  raw[id] = Object.fromEntries(Object.entries(result.content.answers).map(([qid, a]) => [`q${qid}_${a.name}`, a.answer]));
}
const value = (id, name) => {
  const f = docs[id].fields[name] || {};
  return f.stringValue ?? f.doubleValue ?? (f.integerValue !== undefined ? Number(f.integerValue) : f.booleanValue);
};
for (const id of ids) {
  assert.equal(value(id, 'submissionId'), id);
  assert.notEqual(value(id, 'isExcluded'), true);
  assert.equal(docs[id].updateTime, baselineDocs.find(d => d.id === `trx-jf-${id}`)?.updateTime, `Changed since reviewed snapshot: ${id}`);
}
const now = new Date().toISOString();
const patches = {};
for (const [id, amount, paid, due] of [[ids[0], 269.9, 'SIM', '2026-09-01'], [ids[1], 1633.66, 'NÃO', '2026-09-25']]) {
  assert.equal(submissions[id].status, 'ACTIVE');
  assert.match(String(raw[id].q4_tipoDe), /Contas a Pagar/);
  const cp = extractContasPagar(raw[id]);
  assert.equal(cp.valorNum, amount);
  assert.equal(cp.docPago, paid);
  assert.equal(cp.dueDateISO, due);
  assert.equal(cp.dataLancISO, '2026-08-19');
  if (paid === 'SIM') assert.equal(cp.dataPgto, '19/08/2026');
  assert.ok(cp.movimentacao && cp.identificacaoUnica && cp.obs);
  assert.equal(value(id, 'movement'), 'Entrada');
  assert.equal(Number(value(id, 'valorOriginal')), 0);
  patches[id] = {
    movement: 'Saída', type: 'Saída de Caixa / Contas a Pagar',
    status: paid === 'SIM' ? 'Pago' : 'Pendente', pago: paid === 'SIM' ? 'Pago' : 'Não',
    client: cp.movimentacao, description: cp.movimentacao,
    date: cp.dataLancISO, dueDate: cp.dueDateISO,
    paymentDate: paid === 'SIM' ? '2026-08-19' : '', dataPagamento: paid === 'SIM' ? cp.dataPgto : '',
    valorOriginal: amount, valuePaid: amount, valueReceived: 0,
    valorPago: paid === 'SIM' ? String(cp.valorRef) : '',
    totalCobranca: 0, honorarios: 0, valorExtra: 0, extras: 0,
    observacaoAPagar: cp.obs, identificacaoUnica: cp.identificacaoUnica,
    identificacaoUnicaAlt: cp.identificacaoUnicaAlt, updatedAt: now,
  };
}
assert.equal(submissions[ids[2]].status, 'DELETED');
assert.equal(submissions[replacement].status, 'ACTIVE');
const old = extractContasReceber(raw[ids[2]]), paid = extractContasReceber(raw[replacement]);
assert.equal(old.cnpj, paid.cnpj);
assert.ok(old.cnpj);
assert.equal(old.dueDateISO, paid.dueDateISO);
assert.equal(old.honorarios, 650);
assert.equal(paid.honorarios, 650);
assert.equal(paid.docPago, 'SIM');
assert.equal(value(replacement, 'status'), 'Pago');
assert.equal(Number(value(replacement, 'valueReceived')), 650);
assert.notEqual(value(replacement, 'isExcluded'), true);
assert.equal(value(ids[2], 'status'), 'Pendente');
patches[ids[2]] = { isExcluded: true, excludedAt: now, exclusionReason: `source-deleted:jotform; paid-counterpart:${replacement}`, updatedAt: now };
assert.equal(submissions[ids[3]].status, 'ACTIVE');
const extra = extractContasReceber(raw[ids[3]]);
assert.equal(extra.hasHonorarios, true);
assert.equal(extra.honorarios, 0);
assert.equal(extra.extras, 1180);
assert.equal(parseValor(raw[ids[3]].q279_totalCobranca279), 1180);
assert.equal(Number(value(ids[3], 'honorarios')), 1180);
patches[ids[3]] = { honorarios: 0, updatedAt: now };
const encode = v => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v } : { stringValue: v };
const writes = ids.map(id => ({ update: { name: docs[id].name, fields: Object.fromEntries(Object.entries(patches[id]).map(([k, v]) => [k, encode(v)])) }, updateMask: { fieldPaths: Object.keys(patches[id]) }, currentDocument: { updateTime: docs[id].updateTime } }));
mkdirSync('migration-backups', { recursive: true });
const path = `migration-backups/confirmed-jotform-repair-${now.replace(/[:.]/g, '-')}-${apply ? 'apply' : 'preview'}.json`;
// Full before-images and source proof written BEFORE the atomic masked commit.
writeFileSync(path, JSON.stringify({ generatedAt: now, apply, docs, submissions, patches, writes }, null, 2), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', ids, backup: path }));
if (apply) {
  // Also precondition the paid counterpart, without modifying it.
  const result = await request(`${root}:commit`, { method: 'POST', headers: auth, body: JSON.stringify({ writes: [...writes, { verify: docs[replacement].name, currentDocument: { updateTime: docs[replacement].updateTime } }] }) });
  writeFileSync(path.replace('.json', '-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  for (const id of ids) {
    docs[id] = await request(`${root}/transactions/trx-jf-${id}`, { headers: auth });
    for (const [field, expected] of Object.entries(patches[id])) assert.equal(value(id, field), expected, `Verification failed: ${id}/${field}`);
  }
  console.log('Four records repaired and verified. No documents created or deleted.');
}
