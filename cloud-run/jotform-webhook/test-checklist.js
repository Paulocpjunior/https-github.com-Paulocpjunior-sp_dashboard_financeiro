const assert = require('node:assert/strict');
const { mapChecklist, loadChecklist, installChecklistRoute, FORM_ID } = require('./checklist');
const questions = { 1: { text: 'EMPRESA NOME ' }, 2: { text: 'Nosso Número' }, 3: { text: 'Honorários ' },
  4: { text: 'DATA CADASTRO ESCRITÓRIO' }, 5: { text: 'DATA SAIDA ESCRITÓRIO' },
  6: { text: 'DATA SAIDA ESCRITORIO' }, 7: { text: 'OBSERVAÇÃO:' } };
const row = (id, extra = {}) => ({ id: String(id), form_id: FORM_ID, status: 'ACTIVE', created_at: '2026-09-01 10:00:00', updated_at: null,
  answers: { 1: { answer: 'Empresa teste' }, 2: { answer: String(id) }, 3: { answer: 'R$ 1.250,50' },
    4: { answer: { day: '1', month: '9', year: '2026' } }, 7: { answer: 'Cobrar dia 10. Última cobrança em setembro.' }, ...extra } });

(async () => {
  const mapped = mapChecklist(questions, [row(1), row(2, { 5: { answer: '30/09/2026' }, 6: { answer: '31/10/2026' } })]);
  assert.equal(mapped.records[0].amount, 1250.50);
  assert.equal(mapped.records[0].entryDate, '2026-09-01');
  assert.equal(mapped.records[0].billingDay, null, 'texto livre não vira regra de cobrança');
  assert.equal(mapped.records[0].contractValidated, false);
  assert.equal(mapped.records[1].exitDate, null, 'datas divergentes não escolhem uma versão silenciosamente');
  assert.equal(mapped.observationsToReview, 2);
  const duplicate = mapChecklist(questions, [row(1), row(2, { 2: { answer: '1' } })]);
  assert.equal(duplicate.conflictRecords, 2);
  const invalid = mapChecklist(questions, [row(3, { 4: { answer: '31/09/2026' } })]);
  assert.ok(invalid.records[0].issues.some(i => i.includes('inválido')));
  const source = Array.from({ length: 1420 }, (_, i) => row(i+1));
  const fake = (changed = false, partial = false) => {
    let calls = 0;
    return async url => {
      const u = new URL(url); let content;
      if (u.pathname.endsWith('/questions')) content = questions;
      else if (u.pathname.endsWith('/submissions')) {
        const offset = Number(u.searchParams.get('offset')); calls++;
        content = source.slice(offset, offset + 200).map(r => ({ ...r }));
        if (changed && calls > 8 && offset === 0) content[0].updated_at = '2026-10-01 12:00:00';
        if (partial && offset >= 200) content = [];
      } else content = { title: 'Checklist', count: '1420' };
      return { ok: true, json: async () => ({ responseCode: 200, content }) };
    };
  };
  const complete = await loadChecklist({ apiKey: 'test-only', fetcher: fake() });
  assert.equal(complete.expected, 1420); assert.equal(complete.received, 1420);
  assert.equal(complete.canCloseMonth, false); assert.equal(complete.complete, true);
  await assert.rejects(loadChecklist({ apiKey: 'test-only', fetcher: fake(true) }), /CHANGED_OR_INCOMPLETE/);
  await assert.rejects(loadChecklist({ apiKey: 'test-only', fetcher: fake(false, true) }), /CHANGED_OR_INCOMPLETE/);
  await assert.rejects(loadChecklist({ apiKey: '' }), /CREDENTIAL_MISSING/);
  let handler; let called = false;
  installChecklistRoute({ post: (path, fn) => { handler = fn; } }, { auth: { GoogleAuth: class { constructor() { called = true; } } } }, 'test');
  const response = { statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ get: () => '', body: {} }, response);
  assert.equal(response.statusCode, 401); assert.equal(called, false);
  console.log('OK: checklist paginado, cobertura completa, mudança da fonte, dados inválidos, duplicados e leitura sem autenticação.');
})().catch(error => { console.error(error); process.exitCode = 1; });
