import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildBillingCompleteness: review } = await server.ssrLoadModule('/utils/billingCompleteness.ts');
  const tx = (id, month, changes = {}) => ({ id, client: 'Empresa A', cpfCnpj: '11111111000111', clientNumber: '001', date: `${month}-02`, dueDate: `${month}-10`, movement: 'Entrada', type: 'Contas a Receber', status: 'Pago', valorOriginal: 1000, ...changes });
  const missing = review([tx('old', '2026-08')], '2026-09', 'dueDate');
  assert.equal(missing.missingClients, 1, 'pagamento anterior não elimina a obrigação seguinte');
  assert.equal(missing.missingReferenceAmount, 1000);
  assert.equal(missing.canCloseMonth, false);
  assert.equal(missing.checklistCoverage, null);
  assert.equal(missing.issuanceCoverage, null);
  const matched = review([tx('old', '2026-08'), tx('new', '2026-09', { cpfCnpj: '', status: 'Pendente' })], '2026-09', 'dueDate');
  assert.equal(matched.missingClients, 0, 'número único deve resolver ausência de documento no outro mês');
  assert.equal(matched.postingCoverage, 1);
  assert.equal(matched.canCloseMonth, false, '100% de lançamentos não comprova emissão ou contrato');
  const changed = review([tx('old', '2026-08'), tx('new', '2026-09', { valorOriginal: 900 })], '2026-09', 'date');
  assert.ok(changed.rows[0].issues.some(issue => issue.includes('Valor diferente')));
  const exit = review([tx('old', '2026-08', { observacao: 'Cliente saiu, não cobrar' })], '2026-09', 'date');
  assert.equal(exit.missingClients, 1, 'texto livre não comprova dispensa contratual');
  const names = review([tx('old', '2026-08', { cpfCnpj: '', clientNumber: '' }), tx('new', '2026-09', { cpfCnpj: '', clientNumber: '' })], '2026-09', 'date');
  assert.equal(names.missingClients, 1, 'mesmo nome não prova mesma pessoa jurídica');
  assert.ok(names.rows.every(row => row.issues.some(issue => issue.includes('Identificação insuficiente'))));
  const conflict = review([tx('old', '2026-08'), tx('other', '2026-09', { cpfCnpj: '22222222000122' }), tx('no-doc', '2026-09', { cpfCnpj: '' })], '2026-09', 'date');
  assert.equal(conflict.missingClients, 1);
  assert.ok(conflict.rows.every(row => row.issues.some(issue => issue.includes('documentos diferentes'))));
  const excluded = review([tx('old', '2026-08'), tx('new', '2026-09', { isExcluded: true }), tx('payable', '2026-09', { movement: 'Saída', type: 'Contas a Pagar' })], '2026-09', 'date');
  assert.equal(excluded.missingClients, 1, 'excluídos e contas a pagar não comprovam cobrança');
  const invalid = review([tx('invalid', '2026-09', { dueDate: '2026-09-31' }), tx('absent', '2026-09', { dueDate: undefined })], '2026-09', 'dueDate');
  assert.equal(invalid.sourceIssues.length, 2);
  assert.equal(invalid.postingCoverage, null);
  const year = review([tx('dec', '2026-12'), tx('jan', '2027-01', { valorOriginal: 1000.01 })], '2027-01', 'date');
  assert.equal(year.previousMonth, '2026-12');
  assert.equal(year.rows[0].currentAmount, 1000.01);
  assert.ok(year.rows[0].issues.some(issue => issue.includes('Valor diferente')));
  const multiple = review([tx('old', '2026-08'), tx('new1', '2026-09', { valorOriginal: 500 }), tx('new2', '2026-09', { valorOriginal: 500 })], '2026-09', 'date');
  assert.ok(multiple.rows[0].issues.some(issue => issue.includes('Múltiplos')));
  assert.throws(() => review([], '2026-13', 'date'), /inválido/);
  const { readBillingReview } = await server.ssrLoadModule('/services/billingReviewReader.ts');
  let calls = 0;
  const root = 'projects/test/databases/(default)/documents/transactions/';
  const readTime = '2026-10-01T12:00:00.000000Z';
  const fetcher = async (_url, request) => {
    const query = JSON.parse(request.body); calls++;
    if (calls > 1) { assert.equal(query.readTime, readTime); assert.ok(query.structuredQuery.startAt); }
    const start = (calls-1)*1000;
    const count = Math.min(1000, 20001-start);
    return { ok: true, json: async () => Array.from({ length: count }, (_, i) => ({ readTime,
      document: { name: root+String(start+i).padStart(6,'0'), fields: { id: { stringValue: 'legacy-id' }, client: { stringValue: 'Teste' } } } })) };
  };
  const full = await readBillingReview({ projectId: 'test', token: 'test-only', checkSession() {}, fetcher });
  assert.equal(full.documentCount, 20001, 'base maior que o limite antigo deve ser lida integralmente');
  assert.equal(full.transactions[0].id, '000000', 'usar ID oficial, não ID legado do payload');
  let failedPage = 0;
  await assert.rejects(readBillingReview({ projectId: 'test', token: 'test-only', checkSession() {}, fetcher: async () => {
    failedPage++;
    return failedPage === 1 ? { ok: true, json: async () => Array.from({ length: 1000 }, (_, i) => ({ readTime, document: { name: root+i, fields: {} } })) }
      : { ok: false, status: 403 };
  } }), /permissão/, 'falha posterior nunca entrega parte da base');
  const readRows = (rows, overrides = {}) => readBillingReview({projectId:'test',token:'synthetic-only',checkSession(){},fetcher:async()=>({ok:true,json:async()=>rows}),...overrides});
  assert.equal((await readRows([{readTime}])).documentCount,0,'resposta vazia explícita é válida');
  for (const rows of [[{readTime},{error:{message:'partial'}}],[{readTime,error:null}],[{readTime,document:null}],[{readTime,document:[]}],[{readTime},{}],[{readTime},null],[{readTime: 'invalid'}]]) {
    await assert.rejects(readRows(rows),/incompleta|versão/,'resposta incompleta não comprova lista vazia');
  }
  for (const name of [root,root+'parent/children/nested',root.replace('/transactions/','/users/')+'1']) {
    await assert.rejects(readRows([{readTime,document:{name,fields:{}}}]),/Paginação/);
  }
  await assert.rejects(readRows([{readTime,document:{name:root+'1',fields:{}}},{readTime,document:{name:root+'1',fields:{}}}]),/Paginação/);
  const cancelled = new AbortController(); cancelled.abort();
  let requests = 0;
  await assert.rejects(readRows([{readTime}],{signal:cancelled.signal,fetcher:async()=>{requests++;throw new Error('não deve consultar');}}),{name:'AbortError'});
  assert.equal(requests,0);
  const duringBody = new AbortController();
  await assert.rejects(readRows([],{signal:duringBody.signal,fetcher:async()=>({ok:true,json:async()=>{duringBody.abort();return [{readTime}];}})}),{name:'AbortError'});
  let sessionChanged = false;
  await assert.rejects(readRows([],{checkSession(){if(sessionChanged)throw new Error('Sessão alterada');},fetcher:async()=>({ok:true,json:async()=>{sessionChanged=true;return [{readTime}];}})}),/Sessão alterada/);
  console.log('OK: conferência mensal cobre omissão, identificação, valores, datas, exclusão, duplicidade e ausência de prova contratual/emissão.');
} finally {
  await server.close();
}
