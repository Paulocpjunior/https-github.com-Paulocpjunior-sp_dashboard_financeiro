const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertExistingIdentity } = require('./identity-guard');
const row = values => ({ document: { fields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { stringValue: v }])) } });
const incoming = { kind: 'pagar', submissionId: 'demo-1', identificacaoUnica: 'TEST-001' };
for (const values of [
  { movement: 'Entrada' }, { type: 'Recebimento Wix / Cartao' },
  { type: 'Entrada de Caixa / Contas a Receber' },
  { submissionId: 'other' }, { submissionID: 'other' },
  { identificacaoUnica: 'TEST-002' },
]) {
  let writes = 0;
  assert.throws(() => { assertExistingIdentity([row(values)], incoming); writes++; }, /IDENTITY_CONFLICT/);
  assert.equal(writes, 0);
}
assert.throws(() => assertExistingIdentity([row({ movement: 'Saída' })], { kind: 'receber' }), /IDENTITY_CONFLICT/);
assert.throws(() => assertExistingIdentity([row({ movement: 'Saída' }), row({ movement: 'Entrada' })], incoming), /IDENTITY_CONFLICT/);
assert.doesNotThrow(() => assertExistingIdentity([row({ movement: 'Saída', submissionId: 'demo-1', identificacaoUnica: 'TEST-001' })], incoming));
assert.doesNotThrow(() => assertExistingIdentity([row({ movement: 'Saída' })], incoming));
assert.doesNotThrow(() => assertExistingIdentity([row({ movement: 'Entrada' })], { kind: 'receber' }));
assert.doesNotThrow(() => assertExistingIdentity([row({ identificacaoUnica: ' test-001 ' })], incoming));
assert.throws(() => assertExistingIdentity([], {}), /IDENTITY_KIND_REQUIRED/);
const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const start = source.indexOf('if (existingArr && existingArr.length > 0)');
assert.ok(start > 0);
const guard = source.indexOf('assertExistingIdentity(existingArr', start);
const sorting = source.indexOf('sortRowsForCanonicalUpdate(existingArr', start);
assert.ok(guard > start && guard < sorting, 'Guard must run before canonical selection and duplicate writes');
console.log('identity guard tests: ok');
