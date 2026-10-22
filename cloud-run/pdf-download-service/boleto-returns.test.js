const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, runReturns, hash } = require('./boleto-returns');
const bank = require('./native-entry-catalog.json').banks[0];
const env = { BOLETO_CLOUD_ENVIRONMENT: 'production', BOLETO_CLOUD_API_KEY: 'test-key', BOLETO_CLOUD_ACCOUNT_TOKEN: 'test-account',
  BOLETO_CLOUD_CUTOVER_DATE: '2026-01-01', BOLETO_CLOUD_RETURN_ENABLED: 'true', BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED: 'true' };
const cfg = { accountFingerprint: hash('test-account') };
const id = hash(['production', 'native-test']);
const at = '2026-10-09T16:00:00Z';
const make = () => {
  const issue = { environment: 'production', state: 'issued', transactionId: 'native-test', accountFingerprint: cfg.accountFingerprint,
    token: 'synthetic-boleto-token', number: '001', control: 'sp-test', fields: { 'boleto.valor': '10.00', 'boleto.emissao': '2026-10-09',
      'boleto.vencimento': '2026-10-09', 'boleto.pagador.cprf': '52998224725', 'boleto.pagador.nome': 'Synthetic Test' } };
  const row = { source: 'native-finance', nativeEntry: { kind: 'receber' }, movement: 'Entrada', bankAccount: bank,
    cpfCnpj: '52998224725', dueDate: '2026-10-09', totalCobranca: 10, valorOriginal: 10, status: 'Pendente', pago: 'Não', valueReceived: 0, valuePaid: 0,
    date: '2026-10-09', description: 'Synthetic Test', paymentDate: '', dataPagamento: '', valorPago: '' };
  const body = { boleto: { token: issue.token, tokenControleUsuario: issue.control, numero: '001', valor: 10, emissao: '2026-10-09', vencimento: '2026-10-09',
    pagador: { cprf: row.cpfCnpj }, situacao: 'PAGO', pagamento: { situacao: 'PAGAMENTO_INFORMADO', origem: 'BANCO', marcadoComoPago: false,
      data: '2026-10-09', dataCredito: null, valor: 10, multa: null, juros: null, desconto: null } } };
  return { issue, row, body };
};
test('only exact linked native bank payments can settle', () => {
  const f = make(); assert.equal(evaluate(id, f.issue, f.row, f.body, cfg, at).state, 'ready');
  const mutations = [
    f => f.row.receivableSettlement = {origin:"manual"}, f => f.row.receivableBalance = {version:1},
    f => f.body.boleto.token = 'other', f => f.body.boleto.tokenControleUsuario = 'other', f => f.body.boleto.numero = 'other',
    f => f.body.boleto.valor = 20, f => f.body.boleto.pagador.cprf = 'other', f => f.body.boleto.pagamento.origem = 'USUARIO',
    f => delete f.body.boleto.pagamento.marcadoComoPago, f => f.body.boleto.pagamento.marcadoComoPago = true,
    f => f.body.boleto.pagamento.valor = 9, f => f.body.boleto.pagamento.valor = 11, f => f.body.boleto.pagamento.juros = 1,
    f => f.body.boleto.pagamento.data = '2026-02-30', f => f.body.boleto.pagamento.data = '2026-10-10',
    f => f.body.boleto.pagamento.dataCredito = '2026-10-08', f => f.row.source = 'wix', f => f.row.wixInvoiceNumber = '1', f => f.row.movement = 'Saída', f => f.row.nativeEntry.kind = 'pagar',
    f => f.row.isExcluded = true, f => f.row.status = 'Pago', f => f.row.valueReceived = 1, f => f.row.paymentDate = '2026-10-09',
    f => f.row.bankAccount = 'other', f => f.row.totalCobranca = 20, f => f.row.cpfCnpj = 'other', f => f.row.dueDate = '2026-11-01',
    f => f.issue.accountFingerprint = 'other', f => f.issue.transactionId = 'other',
  ];
  for (const mutate of mutations) { const v = make(); mutate(v); assert.equal(evaluate(id, v.issue, v.row, v.body, cfg, at).state, 'review', mutate.toString()); }
});
test('boletos issued by the app for older (Jotform) receivables settle with the same explicit link', () => {
  const legacy = () => { const f = make(); f.row = { ...f.row, source: 'jotform', bankAccount: '', valorOriginal: undefined }; delete f.row.nativeEntry; return f; };
  const f = legacy(); assert.equal(evaluate(id, f.issue, f.row, f.body, cfg, at).state, 'ready');
  for (const mutate of [f => f.row.bankAccount = 'other', f => f.row.totalCobranca = 20, f => f.row.cpfCnpj = 'other', f => f.row.dueDate = '2026-11-01', f => f.row.isExcluded = true])
  { const v = legacy(); mutate(v); assert.equal(evaluate(id, v.issue, v.row, v.body, cfg, at).state, 'review', mutate.toString()); }
});
function fixture() {
  const { issue, row, body } = make();
  const data = new Map([[`boletoIssues/${id}`, issue], ['transactions/native-test', row]]);
  const snap = p => ({ id: p.split('/').at(-1), ref: doc(p), data: () => structuredClone(data.get(p)) });
  const doc = p => ({ path: p, get: async () => snap(p) });
  const collection = (p, after = '', limit = Infinity) => ({ doc: i => doc(`${p}/${i}`), orderBy: () => collection(p, after, limit),
    limit: n => collection(p, after, n), startAfter: i => collection(p, i, limit),
    get: async () => ({ docs: [...data.keys()].filter(k => k.startsWith(p + '/') && k.slice(p.length + 1).split('/').length === 1 && k.split('/').at(-1) > after).sort().slice(0, limit).map(snap) }) });
  let queue = Promise.resolve();
  const db = { collection, runTransaction: fn => {
    const run = queue.then(async () => { const writes = []; let wrote = false;
      const result = await fn({ get: r => { assert.equal(wrote, false, 'all reads before writes'); return r.get(); },
        set: (r, v) => { wrote = true; writes.push(() => data.set(r.path, structuredClone(v))); },
        update: (r, v) => { wrote = true; assert.ok(data.has(r.path)); writes.push(() => data.set(r.path, { ...data.get(r.path), ...structuredClone(v) })); },
        create: (r, v) => { wrote = true; assert.ok(!data.has(r.path)); writes.push(() => data.set(r.path, structuredClone(v))); } });
      writes.forEach(w => w()); return result;
    }); queue = run.catch(() => {}); return run;
  } };
  const fetchImpl = async (url, opts) => { assert.equal(opts.method, 'GET'); assert.equal(opts.redirect, 'error'); assert.ok(url.endsWith('/situacao')); return { ok: true, json: async () => structuredClone(body) }; };
  return { data, db, body, fetchImpl, run: (opts = {}) => runReturns({ db, env, fetchImpl, ...opts }) };
}
test('atomic settlement preserves nominal fields, audits once and is retry-safe', async () => {
  const f = fixture(); const original = structuredClone(f.data.get('transactions/native-test'));
  assert.equal((await f.run()).settled, 1);
  const row = f.data.get('transactions/native-test'); assert.equal(row.status, 'Pago'); assert.equal(row.valueReceived, 10);
  for (const k of ['description', 'date', 'dueDate', 'valorOriginal', 'totalCobranca', 'source', 'bankAccount']) assert.equal(row[k], original[k]);
  assert.equal((await f.run()).settled, 1); assert.equal(f.data.get('transactions/native-test').valueReceived, 10);
  assert.equal([...f.data.keys()].filter(k => k.startsWith('boletoSettlementAudit/')).length, 1);
  f.body.boleto.pagamento = null; f.body.boleto.situacao = 'EM_ABERTO';
  assert.equal((await f.run()).review, 1); assert.equal(f.data.get('transactions/native-test').status, 'Pago');
});
test('concurrent executions are fenced and cannot duplicate a payment', async () => {
  const f = fixture(); const results = await Promise.all([f.run(), f.run()]); assert.ok(results.some(r => r.busy));
  assert.equal([...f.data.keys()].filter(k => k.startsWith('boletoSettlementAudit/')).length, 1);
});
test('dry run performs zero writes; disabled settlement updates only history/review', async () => {
  const f = fixture(), before = structuredClone(f.data);
  assert.equal((await f.run({ dryRun: true })).ready, 1); assert.deepEqual(f.data, before);
  assert.equal((await f.run({ env: { ...env, BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED: 'false' } })).review, 1);
  assert.deepEqual(f.data.get('transactions/native-test'), before.get('transactions/native-test'));
});
test('HTTP failure, malformed and manual payment never change receivables', async () => {
  for (const mode of ['http', 'malformed', 'manual', 'open', 'cancelled']) {
    const f = fixture(), old = structuredClone(f.data.get('transactions/native-test'));
    if (mode === 'malformed') f.body.boleto.pagamento.data = 'broken';
    if (mode === 'manual') f.body.boleto.pagamento.marcadoComoPago = true;
    if (mode === 'open') { f.body.boleto.pagamento = null; f.body.boleto.situacao = 'EM_ABERTO'; }
    if (mode === 'cancelled') { f.body.boleto.pagamento = null; f.body.boleto.situacao = 'BAIXADO'; f.body.boleto.baixa = { dataBanco: '2026-10-09' }; }
    const result = await f.run(mode === 'http' ? { fetchImpl: async () => ({ ok: false }) } : {});
    assert.equal(result.settled, 0); assert.deepEqual(f.data.get('transactions/native-test'), old);
  }
});
test('edited transaction during bank query is reread before settlement', async () => {
  const f = fixture(); const result = await f.run({ fetchImpl: async (...args) => {
    f.data.get('transactions/native-test').totalCobranca = 100; return f.fetchImpl(...args);
  } }); assert.equal(result.review, 1); assert.equal(f.data.get('transactions/native-test').status, 'Pendente');
});
test('pagination checkpoints include skipped documents and wrap without starvation', async () => {
  const f = fixture(); for (let n = 0; n < 25; n++) f.data.set(`boletoIssues/a${String(n).padStart(3, '0')}`, { state: 'draft', environment: 'sandbox' });
  const first = await f.run(); assert.equal(first.scanned, 20); assert.equal(first.more, true);
  const second = await f.run(); assert.equal(second.scanned, 6); assert.equal(second.more, false);
});
test('loss of job ownership during a provider call prevents financial writes', async () => {
  const f = fixture(); await assert.rejects(f.run({ fetchImpl: async (...args) => {
    f.data.get('boletoReturnJobs/production').lease = 'new-owner'; return f.fetchImpl(...args);
  } })); assert.equal(f.data.get('transactions/native-test').status, 'Pendente');
  assert.equal([...f.data.keys()].filter(k => k.startsWith('boletoSettlementAudit/')).length, 0);
});
test('existing audit prevents reapplying a reset receivable', async () => {
  const f = fixture(), original = structuredClone(f.data.get('transactions/native-test'));
  await f.run(); f.data.set('transactions/native-test', original);
  assert.equal((await f.run()).review, 1); assert.equal(f.data.get('transactions/native-test').status, 'Pendente');
});
test('a newer manual history query fences out the older automatic result', async () => {
  const f = fixture(); const { idFor } = require('./boleto-history');
  f.data.set(`boletoHistoryUpdates/${idFor(f.body.boleto.token)}`, { syncedAt: '2099-01-01T00:00:00.000Z', record: { sentinel: true } });
  assert.equal((await f.run()).errors, 1); assert.equal(f.data.get('transactions/native-test').status, 'Pendente');
});

test('RET-triggered native settlement retains provenance, manual conflict and replay protection', async()=>{
 const {settleEvent}=require('./boleto-ret-files');
 for(const manual of [false,true]) {
  const f=fixture(),base=f.db.collection;
  f.db.collection=name=>{const c=base(name);return name==='boletoIssues'?{...c,where:()=>({limit:()=>({get:()=>c.get()})})}:c;};
  const jobRef=f.db.collection('boletoReturnJobs').doc('cnab-production');
  f.data.set(jobRef.path,{lease:'ret',leaseUntil:Date.now()+60000});
  if(manual)f.data.get('transactions/native-test').receivableSettlement={method:'PIX'};
  const event={token:f.body.boleto.token,number:'001',occurrence:{situacao:'LIQUIDACAO',info:{situacao:'LIQUIDACAO',valorPago:10,dataDePagamento:'2026-10-09'}}};
  const args={db:f.db,cfg:{...cfg,base:'https://example.invalid',apiKey:'fake'},env,fetchImpl:f.fetchImpl,event,provenance:{fileId:'file',eventId:'event'},lease:'ret',jobRef,at:new Date().toISOString(),dryRun:false};
  assert.equal((await settleEvent(args)).state,manual?'review':'settled');
  if(manual){assert.equal(f.data.get('transactions/native-test').status,'Pendente');assert.equal([...f.data.keys()].some(k=>k.startsWith('boletoSettlementAudit/')),false);}
  else {assert.deepEqual(f.data.get('transactions/native-test').boletoSettlement.returnEvidence,args.provenance);assert.equal((await settleEvent(args)).state,'settled');assert.equal([...f.data.keys()].filter(k=>k.startsWith('boletoSettlementAudit/')).length,1);}
 }
});
test('manual treatment or RET hold blocks automatic settlement without changing the account',async()=>{
 const f=fixture(),before=structuredClone(f.data.get('transactions/native-test'));
 f.data.set('boletoManualResolutions/'+require('./boleto-history').idFor(f.body.boleto.token),{requiresManualReview:true});
 assert.equal((await f.run()).review,1);
 assert.deepEqual(f.data.get('transactions/native-test'),before);
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('boletoSettlementAudit/')).length,0);
});
test('RET re-send releases a native boleto only from its own automatic quarantine marker', async()=>{
 const {settleEvent}=require('./boleto-ret-files'),{idFor}=require('./boleto-history');
 for(const [patch,supersedes,expected] of [[{},['old'],'settled'],[{},[],'review'],[{transactionId:'native-test'},['old'],'review'],[{reason:'MANUAL'},['old'],'review']]) {
  const f=fixture(),base=f.db.collection;
  f.db.collection=name=>{const c=base(name);return name==='boletoIssues'?{...c,where:()=>({limit:()=>({get:()=>c.get()})})}:c;};
  const jobRef=f.db.collection('boletoReturnJobs').doc('cnab-production');
  f.data.set(jobRef.path,{lease:'ret',leaseUntil:Date.now()+60000});
  f.data.set('boletoManualResolutions/'+idFor(f.body.boleto.token),{reason:'RETURN_EVIDENCE_CONFLICT',eventId:'old',requiresManualReview:true,...patch});
  const event={token:f.body.boleto.token,number:'001',occurrence:{situacao:'LIQUIDACAO',info:{situacao:'LIQUIDACAO',valorPago:10,dataDePagamento:'2026-10-09'}}};
  const result=await settleEvent({db:f.db,cfg:{...cfg,base:'https://example.invalid',apiKey:'fake'},env,fetchImpl:f.fetchImpl,event,provenance:{fileId:'file',eventId:'event'},lease:'ret',jobRef,at:new Date().toISOString(),dryRun:false,supersedes});
  assert.equal(result.state,expected,JSON.stringify(patch)+supersedes);
  assert.equal(f.data.get('transactions/native-test').status,expected==='settled'?'Pago':'Pendente');
 }
});
test('late payment with charges settles in full only when the RET job enables it, interest recorded', () => {
  const late = (patch = p => p) => { const f = make(); f.issue.fields['boleto.vencimento'] = f.body.boleto.vencimento = f.row.dueDate = '2026-10-08';
    Object.assign(f.body.boleto.pagamento, { valor: 10.5, juros: 0.5 }); patch(f); return f; };
  const ok = late(), result = evaluate(id, ok.issue, ok.row, ok.body, cfg, at, { lateInterest: true });
  assert.equal(result.state, 'ready'); assert.equal(result.evidence.paidCents, 1050); assert.equal(result.evidence.interestCents, 50);
  assert.equal(evaluate(id, ok.issue, ok.row, ok.body, cfg, at).state, 'review');
  for (const mutate of [f => f.body.boleto.pagamento.valor = 9.5, f => f.body.boleto.pagamento.desconto = 0.1, f => f.body.boleto.pagamento.juros = -1,
    f => { f.issue.fields['boleto.vencimento'] = f.body.boleto.vencimento = f.row.dueDate = '2026-10-09'; }]) {
    const v = late(mutate); assert.equal(evaluate(id, v.issue, v.row, v.body, cfg, at, { lateInterest: true }).state, 'review', mutate.toString());
  }
});
