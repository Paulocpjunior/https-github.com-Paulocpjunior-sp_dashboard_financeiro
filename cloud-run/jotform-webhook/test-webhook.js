const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  WEBHOOK_VERSION,
  extractContasPagar,
  extractContasReceber,
  buildContasReceberFields,
  isContasReceberPayload,
  jotformDateToEpoch,
  toBrDate,
} = require('./index');

const pending = extractContasPagar({
  q44_movimentacao44: '35- Salários - SP',
  q291_docpago: 'NÃO',
  q56_valorRefvalor56: 'R$ 449,98',
  q15_dataLancamento: { day: '3', month: '8', year: '2026' },
  q313_dataA: { day: '5', month: '8', year: '2026' },
  q284_identificacaoUnica: 'SP-CX46267',
});

assert.equal(WEBHOOK_VERSION, '6.15-identity-conflict-guard');
assert.equal(pending.docPago, 'NÃO');
assert.equal(pending.valorNum, 449.98);
assert.equal(pending.dataLancISO, '2026-08-03');
assert.equal(pending.dueDateISO, '2026-08-05');
assert.equal(pending.identificacaoUnica, 'SP-CX46267');
assert.ok(jotformDateToEpoch('2026-08-03 10:33:18') > 0);

const paidWithJotformDateObjects = extractContasPagar({
  q44_movimentacao44: '26- Certificados Digitais',
  q291_docpago: 'SIM',
  q56_valorRefvalor56: 'R$ 209,00',
  q15_dataLancamento: { day: '25', month: '09', year: '2026' },
  q313_dataA: { day: '28', month: '09', year: '2026' },
  q129_dataBaixa: { day: '25', month: '09', year: '2026' },
  q284_identificacaoUnica: 'SP-CX47447',
});
assert.equal(paidWithJotformDateObjects.docPago, 'SIM');
assert.equal(paidWithJotformDateObjects.dataLancISO, '2026-09-25');
assert.equal(paidWithJotformDateObjects.dueDateISO, '2026-09-28');
assert.equal(paidWithJotformDateObjects.dataPgto, '25/09/2026');
assert.equal(toBrDate({ day: '25', month: '09', year: '2026' }), '2026-09-25');
assert.equal(isContasReceberPayload({
  q4_tipoDe: 'Saída de Caixa / Contas a Pagar',
  q314_docpago314: 'NÃO',
  q44_movimentacao44: '26- Certificados Digitais',
}), false);
assert.equal(isContasReceberPayload({
  q4_tipoDe: 'Entrada de Caixa / Contas a Receber',
  q314_docpago314: 'SIM',
}), true);
assert.equal(isContasReceberPayload({
  q4_tipoDe: { answer: 'Saída de Caixa / Contas a Pagar' },
  q44_movimentacao44: '26- Certificados Digitais',
}), false);
assert.equal(isContasReceberPayload({
  q4_tipoDe: ['Entrada de Caixa', 'Contas a Receber'],
}), true);

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
for (const explicitZero of ['R$ 0,00', 0, '0']) {
  const cr = extractContasReceber({ q200_honorarios: explicitZero, q201_valorExtras: '1180,00' });
  assert.equal(cr.hasHonorarios, true);
  const fields = buildContasReceberFields(cr, 'test-zero');
  assert.equal(Number(fields.honorarios.doubleValue ?? fields.honorarios.integerValue), 0);
}
const withoutHonorarios = extractContasReceber({ q201_valorExtras: '1180,00' });
assert.equal(withoutHonorarios.hasHonorarios, false);
assert.equal(Object.hasOwn(buildContasReceberFields(withoutHonorarios, 'test-absent'), 'honorarios'), false);
for (const invalid of ['', null, 'indefinido', 'R$ -10,00']) {
  const cr = extractContasReceber({ q200_honorarios: invalid });
  assert.equal(Object.hasOwn(buildContasReceberFields(cr, 'test-invalid'), 'honorarios'), false);
}
const positive = extractContasReceber({ q200_honorarios: 'R$ 230,50' });
assert.equal(positive.honorarios, 230.5);
assert.ok(Object.hasOwn(buildContasReceberFields(positive, 'test-positive'), 'honorarios'));
assert.ok(!source.includes('Fallback Pagar RELAXADO match'));
assert.ok(source.includes("if (cp.docPago === 'SIM')"));
assert.ok(source.includes("app.post('/reconcile-jotform'"));
assert.ok(source.includes("fetchOrdered('created_at')"));
assert.ok(source.includes("fetchOrdered('updated_at')"));
assert.ok(source.includes('function payloadText(value)'));

console.log('webhook regression tests: ok');
require('./test-identity-guard');
