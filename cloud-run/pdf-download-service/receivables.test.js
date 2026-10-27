const test=require('node:test'), assert=require('node:assert/strict'), {randomUUID}=require('node:crypto');
const {createNativeEntryHandler}=require('./native-entries');
const catalog=require('./native-entry-catalog.json');
const row=()=>({movement:'Entrada',type:'Entrada de Caixa / Contas a Receber',source:'jotform',submissionId:'original',client:'Cliente teste',dueDate:'2026-01-31',date:'2026-01-01',status:'Pendente',valueReceived:0,valuePaid:0,totalCobranca:100,valorOriginal:100,bankAccount:catalog.banks[0]});
async function body(h,overrides={}) {const d=await h.call('items/legacy');assert.equal(d.status,200);return {id:'legacy',requestId:randomUUID(),version:d.body.version,receipt:{date:'2026-01-02',amount:'40.00',interest:'2.00',discount:'1.00',bankAccount:catalog.banks[0],method:catalog.receiptMethods[0],note:'Comprovante conferido',...overrides}};}
async function commit(h,b){const p=await h.call('receipt/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));return h.call('receipt/commit',{...b,confirmHash:p.body.reviewHash});}
function harness() {
  const store = new Map([
      ["users/u", { active: true, role: "admin" }],
      ["transactions/legacy", row()],
    ]),
    objects = new Map();
  let queue = Promise.resolve();
  const snap = (p) => ({
    id: p.split("/").at(-1),
    exists: store.has(p),
    data: () => structuredClone(store.get(p)),
  });
  const doc = (p) => ({ path: p, get: async () => snap(p) });
  const query = (p, filters = [], max = 10000) => ({
    where: (k, op, v) => query(p, [...filters, [k, v]], max),
    limit: (n) => query(p, filters, n),
    get: async () => ({
      docs: [...store.keys()]
        .filter(
          (k) =>
            k.startsWith(p + "/") &&
            !k.slice(p.length + 1).includes("/") &&
            filters.every(([f, v]) => store.get(k)[f] === v),
        )
        .slice(0, max)
        .map(snap),
    }),
  });
  const db = {
    collection: (p) => ({ ...query(p), doc: (id) => doc(p + "/" + id) }),
    runTransaction: (fn) => {
      const run = queue.then(async () => {
        const writes = [];
        const r = await fn({
          get: (ref) => ref.get(),
          set: (ref, data) => writes.push([ref.path, data, false]),
          create: (ref, data) => writes.push([ref.path, data, true]),
        });
        for (const [p, , create] of writes)
          if (create) assert.ok(!store.has(p));
        for (const [p, d] of writes) store.set(p, structuredClone(d));
        return r;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  const env = {
    NATIVE_ENTRY_ENABLED: "true",
    NATIVE_ENTRY_ATTACHMENT_BUCKET: "fixture",
  };
  const handler = createNativeEntryHandler({
    getServices: () => ({
      adminDb: db,
      adminAuth: {
        verifyIdToken: async (t) => {
          if (!["good","approver"].includes(t)) throw Error();
          return { uid: t === "approver" ? "v" : "u" };
        },
      },
    }),
    env,
    readBody: async (r) => Buffer.from(JSON.stringify(r.body)),
    sendJson: (_r, res, status, body) => Object.assign(res, { status, body }),
    getBucket: () => ({
      file: (p) => ({
        save: async (bytes) => objects.set(p, bytes),
        download: async () => [objects.get(p)],
      }),
    }),
  });
  return {
    store,
    env,
    objects,
    async call(path, body, token = "good") {
      const r = {};
      await handler(
        {
          url: "/api/financial-entries/receivables/" + path,
          method: body ? "POST" : "GET",
          headers: { authorization: token ? "Bearer " + token : "" },
          body,
        },
        r,
      );
      return r;
    },
  };
}

test('prévia não grava; parciais e quitação preservam original e histórico',async()=>{
 const h=harness(),b=await body(h);const before=structuredClone([...h.store]);
 const p=await h.call('receipt/preview',b);assert.equal(p.status,200);assert.deepEqual([...h.store],before);
 const first=await commit(h,b);assert.equal(first.status,200);assert.equal(first.body.transaction.receivableBalance.remainingCents,6100);assert.equal(first.body.transaction.status,'Pendente');
 const last=await commit(h,await body(h,{amount:'61.00',interest:'0.00',discount:'0.00',date:'2026-01-03'}));assert.equal(last.status,200);
 const r=h.store.get('transactions/legacy');assert.equal(r.status,'Pago');assert.equal(r.valueReceived,101);assert.equal(r.totalCobranca,100);assert.equal(r.submissionId,'original');assert.equal(r.receivableReceipts.length,2);assert.equal(r.receivableSettlement.origin,'manual');
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('receivableAudit/')).length,2);
});
test('repetição e concorrência não duplicam recebimento',async()=>{
 const h=harness(),b=await body(h),p=await h.call('receipt/preview',b),payload={...b,confirmHash:p.body.reviewHash};
 const results=await Promise.all([h.call('receipt/commit',payload),h.call('receipt/commit',payload)]);assert.ok(results.every(r=>r.status===200));assert.equal(h.store.get('transactions/legacy').receivableReceipts.length,1);
 assert.equal((await h.call('receipt/commit',{...payload,receipt:{...b.receipt,amount:'20.00'}})).status,409);
});
test('alteração concorrente e permissão revogada impedem gravação',async()=>{
 const h=harness(),b=await body(h),p=await h.call('receipt/preview',b);h.store.get('transactions/legacy').status='Pago';
 assert.equal((await h.call('receipt/commit',{...b,confirmHash:p.body.reviewHash})).status,409);
 const h2=harness(),b2=await body(h2),p2=await h2.call('receipt/preview',b2);h2.store.set('users/u',{active:false,role:'admin'});
 assert.equal((await h2.call('receipt/commit',{...b2,confirmHash:p2.body.reviewHash})).status,403);
});
test('baixa manual vale para toda a equipe ativa; perfil bloqueado ou inativo não acessa',async()=>{
 const h=harness();h.store.set('users/u',{active:true,role:'operacional',financialPermissions:[]});
 const d=await h.call('items/legacy');assert.equal(d.status,200);assert.equal(d.body.canSettle,true);assert.equal(d.body.canReverse,true);assert.equal(d.body.canAmend,true);assert.equal(d.body.canAdjust,true);
 const pending=await body(h);h.store.get('users/u').status='blocked';assert.equal((await h.call('items/legacy')).status,403);assert.equal((await h.call('receipt/preview',pending)).status,403);
 h.store.set('users/u',{active:false,role:'operacional',financialPermissions:['receivables.settle']});assert.equal((await h.call('items/legacy')).status,403);
 h.store.set('users/u',{active:true,role:'operacional',financialPermissions:[]});const c=await commit(h,await body(h));assert.equal(c.status,200);
});
test('valida dinheiro, datas, desconto e referências sem gravações',async()=>{
 for(const overrides of [{amount:'0.00'},{amount:'1000.00'},{amount:'NaN'},{interest:'-1.00'},{discount:'90.00'},{date:'2099-01-01'},{date:'2026-02-30'},{note:''},{bankAccount:'inventada'},{method:'inventado'}]){
  const h=harness();const b=await body(h,overrides);const result=await h.call('receipt/preview',b);assert.ok(result.status>=400,JSON.stringify(overrides));assert.equal(h.store.size,2);
 }
});
test('baixas legadas, bancárias e faturas Wix não podem receber segunda baixa',async()=>{
 for(const extra of [{status:'Pago'},{valueReceived:10},{paymentDate:'2026-01-01'},{boletoSettlement:{evidenceId:'bank'}}]){
  const h=harness();Object.assign(h.store.get('transactions/legacy'),extra);assert.equal((await h.call('receipt/preview',await body(h))).status,409);
 }
 const h=harness();h.store.get('transactions/legacy').source='wix';assert.equal((await h.call('items/legacy')).status,409);
});
test('saldo parcial bloqueia reemissão integral de boleto',()=>{
 const {eligible}=require('./boleto-cloud');assert.equal(eligible({...row(),metodoPagamento:'Boleto',receivableBalance:{version:1}}),false);
});

test('requisições diferentes para a mesma versão não aplicam duas baixas',async()=>{
 const h=harness(),a=await body(h),b=await body(h),pa=await h.call('receipt/preview',a),pb=await h.call('receipt/preview',b);
 const results=await Promise.all([h.call('receipt/commit',{...a,confirmHash:pa.body.reviewHash}),h.call('receipt/commit',{...b,confirmHash:pb.body.reviewHash})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(h.store.get('transactions/legacy').receivableReceipts.length,1);
});
test('revisão obrigatória e sessão autenticada',async()=>{
 const h=harness();assert.equal((await h.call('items/legacy',null,'')).status,401);
 const b=await body(h);assert.equal((await h.call('receipt/commit',b)).status,409);assert.equal(h.store.size,2);
});

// The browser collapses whitespace in option text when value is omitted.
// Catalog identifiers must survive the selection unchanged.
test('conta Itaú com espaços do cadastro aceita revisão e preserva identificação na baixa',async()=>{
 const h=harness(), bank=catalog.banks[0];
 assert.match(bank,/  /);
 const method=catalog.receiptMethods.find(v=>/11.*Boleto.*ITAU/i.test(v));
 assert.ok(method);
 const b=await body(h,{bankAccount:bank,method});
 const invalid=await h.call('receipt/preview',{...b,receipt:{...b.receipt,bankAccount:bank.replace(/\s+/g,' ')}});
 assert.equal(invalid.status,400);
 assert.equal(h.store.size,2);
 const result=await commit(h,b);
 assert.equal(result.status,200);
 assert.equal(h.store.get('transactions/legacy').receivableSettlement.bankAccount,bank);
 assert.equal(h.store.get('transactions/legacy').receivableSettlement.method,method);
});

test('estorno reabre recebimento integral, mantém histórico e permite data corrigida',async()=>{
 const h=harness();assert.equal((await commit(h,await body(h,{amount:'100.00',interest:'0.00',discount:'0.00'}))).status,200);
 const d=await h.call('items/legacy'),b={id:'legacy',requestId:randomUUID(),version:d.body.version,reason:'Data informada incorretamente no comprovante'};
 const old=structuredClone([...h.store]);const p=await h.call('reversal/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));assert.deepEqual([...h.store],old);
 const payload={...b,confirmHash:p.body.reviewHash};const r=await h.call('reversal/commit',payload);assert.equal(r.status,200);assert.equal(r.body.transaction.status,'Pendente');assert.equal(r.body.transaction.valueReceived,0);assert.equal(r.body.transaction.receivableReceipts.length,1);assert.equal(r.body.transaction.receivableReversals.length,1);
 assert.equal((await h.call('reversal/commit',payload)).status,200);assert.equal(h.store.get('transactions/legacy').receivableReversals.length,1);
 assert.equal((await commit(h,await body(h,{date:'2026-01-01',amount:'100.00',interest:'0.00',discount:'0.00'}))).status,200);
});
test('estorna parciais em ordem inversa e preserva anexos',async()=>{
 const h=harness();await commit(h,await body(h));await commit(h,await body(h,{amount:'61.00',interest:'0.00',discount:'0.00',date:'2026-01-03'}));
 h.store.get('transactions/legacy').attachments=[{name:'prova.pdf'}];
 for(const remaining of [6100,10000]){const d=await h.call('items/legacy'),b={id:'legacy',requestId:randomUUID(),version:d.body.version,reason:'Corrigir lançamento manual conferido'},p=await h.call('reversal/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));const r=await h.call('reversal/commit',{...b,confirmHash:p.body.reviewHash});assert.equal(r.status,200);assert.equal(r.body.transaction.receivableBalance?.remainingCents??10000,remaining);assert.equal(r.body.transaction.attachments[0].name,'prova.pdf');}
 assert.equal(h.store.get('transactions/legacy').receivableReceipts.length,2);
});
test('estorno exige perfil ativo, histórico íntegro e bloqueia retorno bancário',async()=>{
 for(const mode of ['permission','bank','tamper','stale']){const h=harness();await commit(h,await body(h));const d=await h.call('items/legacy');
 if(mode==='permission')h.store.set('users/u',{active:true,role:'operacional',status:'blocked',financialPermissions:['receivables.reverse']});
 if(mode==='bank')h.store.get('transactions/legacy').boletoSettlement={source:'return'};
 if(mode==='tamper')h.store.get('transactions/legacy').valorPago='99';
 const fresh=await h.call('items/legacy');const b={id:'legacy',requestId:randomUUID(),version:mode==='stale'?d.body.version:fresh.body.version,reason:'Corrigir data após conferência'};
 if(mode==='stale')h.store.get('transactions/legacy').updatedAt='changed';
 const r=await h.call('reversal/preview',b);assert.ok(r.status>=400,mode);
 }
});
test('estorno aceita ordem distinta de campos do Firestore, mas rejeita valor alterado',async()=>{
 const h=harness();await commit(h,await body(h,{amount:'100.00',interest:'0',discount:'0'}));
 const current=h.store.get('transactions/legacy');
 for(const key of ['receivableSettlement','receivableBalance'])current[key]=Object.fromEntries(Object.entries(current[key]).reverse());
 const d=await h.call('items/legacy'),b={id:'legacy',requestId:randomUUID(),version:d.body.version,reason:'Corrigir data após conferência'};
 const p=await h.call('reversal/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));
 current.receivableSettlement.amountCents++;const changed=await h.call('items/legacy');
 assert.ok((await h.call('reversal/preview',{...b,version:changed.body.version})).status>=400);
});

function retFixture(h){
 const eventId='a'.repeat(64),boletoId='b'.repeat(64);
 h.store.get('transactions/legacy').cpfCnpj='12345678000199';
 const event={state:'review',boletoId,number:'123',fileId:'file',occurrence:{situacao:'LIQUIDACAO',info:{valorPago:105,dataDePagamento:'2026-01-02'}}};
 h.store.set('boletoReturnEvents/'+eventId,event);
 h.store.set('boletoHistoryUpdates/'+boletoId,{record:{payerDocument:'12345678000199'}});
 return {eventId,evidenceVersion:require('./boleto-ret-review').evidenceVersion(event)};
}
test('RET manual resolution records fine, evidence and actor atomically; replay cannot duplicate',async()=>{
 const h=harness(),retReview=retFixture(h),b={...await body(h,{amount:'105',interest:'2',fine:'3',discount:'0',note:'PIX recebido; comprovante banco ABC 12345'}),retReview};
 const preview=await h.call('receipt/preview',b);assert.equal(preview.status,200);
 const confirmed={...b,confirmHash:preview.body.reviewHash};const result=await h.call('receipt/commit',confirmed);assert.equal(result.status,200);
 const r=h.store.get('transactions/legacy');assert.equal(r.valueReceived,105);assert.equal(r.receivableBalance.remainingCents,0);assert.equal(r.receivableSettlement.fineCents,300);assert.equal(r.receivableSettlement.interestCents,500);assert.equal(r.receivableSettlement.retEvidence.eventId,retReview.eventId);
 assert.equal(h.store.get('boletoReturnEvents/'+retReview.eventId).state,'manual-resolved');
 assert.equal(h.store.get('boletoManualResolutions/'+'b'.repeat(64)).transactionId,'legacy');
 const replay=await h.call('receipt/commit',confirmed);assert.equal(replay.status,200);assert.equal(h.store.get('transactions/legacy').receivableReceipts.length,1);
});
test('partial RET manual receipt stays in review and reversal reopens it preserving evidence',async()=>{
 const h=harness(),retReview=retFixture(h),b={...await body(h,{interest:'0',discount:'0',note:'Deposito parcial; comprovante ABC 12345'}),retReview};
 assert.equal((await commit(h,b)).status,200);
 assert.equal(h.store.get('boletoReturnEvents/'+retReview.eventId).state,'review');
 const item=await h.call('items/legacy');const rb={id:'legacy',version:item.body.version,requestId:randomUUID(),reason:'Data de recebimento informada incorretamente'};
 const preview=await h.call('reversal/preview',rb);assert.equal(preview.status,200,JSON.stringify(preview.body));
 assert.equal((await h.call('reversal/commit',{...rb,confirmHash:preview.body.reviewHash})).status,200);
 const event=h.store.get('boletoReturnEvents/'+retReview.eventId);assert.equal(event.state,'review');assert.equal(event.manualResolution,null);assert.equal(event.occurrence.info.valorPago,105);
 assert.equal(h.store.get('transactions/legacy').valueReceived,0);
});
test('stale RET evidence, mismatching document, existing title claim and weak explanation block manual writes',async()=>{
 for(const mutate of [
 (h,b)=>{h.store.get('boletoReturnEvents/'+b.retReview.eventId).occurrence.info.valorPago=999;},
 h=>{h.store.get('transactions/legacy').cpfCnpj='99999999000100';},
 h=>{h.store.set('boletoManualResolutions/'+'b'.repeat(64),{transactionId:'other'});},
 h=>{h.store.set('boletoReconciliations/'+'b'.repeat(64),{transactionId:'other'});},
 (h,b)=>{b.receipt.note='curto';}
 ]){const h=harness(),retReview=retFixture(h),b={...await body(h,{note:'PIX; comprovante bancario ABC 12345'}),retReview};mutate(h,b);const before=structuredClone(h.store.get('transactions/legacy'));const result=await h.call('receipt/preview',b);assert.ok(result.status>=400,JSON.stringify(result));assert.deepEqual(h.store.get('transactions/legacy'),before);}
});

async function dueBody(h,overrides={}){const d=await h.call('items/legacy');assert.equal(d.status,200);return {id:'legacy',requestId:randomUUID(),version:d.body.version,amendment:{dueDate:'2026-02-28',reason:'Vencimento lançado no mês errado',...overrides}};}
test('corrige vencimento com prévia, motivo e histórico',async()=>{
 const h=harness(),b=await dueBody(h),before=structuredClone([...h.store]);
 const p=await h.call('due-date/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));assert.equal(p.body.after.dueDate,'2026-02-28');assert.deepEqual([...h.store],before);
 assert.equal((await h.call('due-date/commit',b)).status,409);
 const payload={...b,confirmHash:p.body.reviewHash},r=await h.call('due-date/commit',payload);assert.equal(r.status,200);
 const row=h.store.get('transactions/legacy');assert.equal(row.dueDate,'2026-02-28');assert.equal(row.status,'Pendente');assert.equal(row.submissionId,'original');assert.equal(row.totalCobranca,100);
 assert.deepEqual(row.dueDateAmendments.map(a=>[a.before,a.after,a.reason]),[['2026-01-31','2026-02-28','Vencimento lançado no mês errado']]);
 const audit=[...h.store].find(([k,v])=>k.startsWith('receivableAudit/')&&v.action==='due-date-amendment');assert.equal(audit[1].before.dueDate,'2026-01-31');
 assert.equal((await h.call('due-date/commit',payload)).status,200);assert.equal(h.store.get('transactions/legacy').dueDateAmendments.length,1);
});
test('correção de vencimento vale para a equipe ativa',async()=>{
 const h=harness();h.store.set('users/u',{active:true,role:'operacional',financialPermissions:[]});
 const d=await h.call('items/legacy');assert.equal(d.status,200);assert.equal(d.body.canAmend,true);
 assert.equal((await h.call('due-date/preview',await dueBody(h))).status,200);
});
test('vencimento inválido, sem motivo ou anterior ao lançamento não grava',async()=>{
 for(const o of [{dueDate:'2026-02-30'},{dueDate:'2026-01-31'},{dueDate:'2025-12-31'},{dueDate:''},{reason:'curto'}]){const h=harness(),size=h.store.size;assert.equal((await h.call('due-date/preview',await dueBody(h,o))).status,400,JSON.stringify(o));assert.equal(h.store.size,size);}
});
test('bloqueia conta com recebimento, Wix, boleto emitido ou duplicidade no novo vencimento',async()=>{
 const paid=harness();await commit(paid,await body(paid));assert.equal((await paid.call('due-date/preview',await dueBody(paid))).status,409);
 const settled=harness();Object.assign(settled.store.get('transactions/legacy'),{status:'Pago',paymentDate:'2026-01-02'});assert.equal((await settled.call('due-date/preview',await dueBody(settled))).status,409);
 const boleto=harness();boleto.store.set('boletoIssues/x',{transactionId:'legacy',state:'issued'});assert.equal((await boleto.call('due-date/preview',await dueBody(boleto))).status,409);
 const draft=harness();draft.store.set('boletoIssues/x',{transactionId:'legacy',state:'draft'});assert.equal((await draft.call('due-date/preview',await dueBody(draft))).status,200);
 const linked=harness();linked.store.set('boletoReconciliations/x',{transactionId:'legacy'});assert.equal((await linked.call('due-date/preview',await dueBody(linked))).status,409);
 const dup=harness();dup.store.get('transactions/legacy').cpfCnpj='47.476.379/0001-74';dup.store.set('transactions/other',{...row(),cpfCnpj:'47476379000174',dueDate:'2026-02-28'});assert.equal((await dup.call('due-date/preview',await dueBody(dup))).status,409);
 dup.store.get('transactions/other').isExcluded=true;assert.equal((await dup.call('due-date/preview',await dueBody(dup))).status,200);
 const wix=harness();wix.store.get('transactions/legacy').source='wix';assert.equal((await wix.call('items/legacy')).status,409);
});
test('após estornar todas as baixas o vencimento pode ser corrigido',async()=>{
 const h=harness();await commit(h,await body(h,{amount:'100.00',interest:'0.00',discount:'0.00'}));
 assert.equal((await h.call('due-date/preview',await dueBody(h))).status,409);
 const d=await h.call('items/legacy'),b={id:'legacy',requestId:randomUUID(),version:d.body.version,reason:'Baixa registrada na conta errada'},p=await h.call('reversal/preview',b);
 assert.equal((await h.call('reversal/commit',{...b,confirmHash:p.body.reviewHash})).status,200);
 const due=await dueBody(h),pv=await h.call('due-date/preview',due);assert.equal(pv.status,200,JSON.stringify(pv.body));
 assert.equal((await h.call('due-date/commit',{...due,confirmHash:pv.body.reviewHash})).status,200);assert.equal(h.store.get('transactions/legacy').dueDate,'2026-02-28');assert.equal(h.store.get('transactions/legacy').receivableReceipts.length,1);
});

const nativeRow=()=>({...row(),source:'native-finance',submissionId:undefined,cpfCnpj:'47476379000174',nativeEntry:{version:1,kind:'receber'},honorarios:100,valorExtra:0,extras:0,totalCobranca:100,valorOriginal:100,cobrancaExtra:'',extraItems:[]});
function nativeHarness(){const h=harness();h.store.set('transactions/legacy',nativeRow());return h;}
async function chargeBody(h,overrides={}){const d=await h.call('items/legacy');assert.equal(d.status,200);return {id:'legacy',requestId:randomUUID(),version:d.body.version,charge:{honorarios:'100.00',extraItems:[{account:catalog.extras[0],amount:'50.00'}],reason:'Extra esquecido no lançamento',...overrides}};}
test('adiciona extra com prévia, motivo e histórico',async()=>{
 const h=nativeHarness(),d=await h.call('items/legacy');assert.deepEqual(d.body.catalog.extras,catalog.extras);assert.equal(d.body.canAdjust,true);
 const b=await chargeBody(h),before=structuredClone([...h.store]);
 const p=await h.call('charge/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));assert.equal(p.body.after.totalCobranca,150);assert.deepEqual([...h.store],before);
 assert.equal((await h.call('charge/commit',b)).status,409);
 const payload={...b,confirmHash:p.body.reviewHash},r=await h.call('charge/commit',payload);assert.equal(r.status,200,JSON.stringify(r.body));
 const saved=h.store.get('transactions/legacy');
 assert.deepEqual([saved.honorarios,saved.valorExtra,saved.extras,saved.totalCobranca,saved.valorOriginal,saved.cobrancaExtra,saved.status,saved.valuePaid],[100,50,50,150,150,catalog.extras[0],'Pendente',0]);
 assert.deepEqual(saved.chargeAmendments.map(a=>[a.before.totalCents,a.after.totalCents,a.reason]),[[10000,15000,'Extra esquecido no lançamento']]);
 const audit=[...h.store].find(([k,v])=>k.startsWith('receivableAudit/')&&v.action==='charge-amendment');assert.equal(audit[1].before.totalCobranca,100);assert.equal(audit[1].after.totalCobranca,150);
 assert.equal((await h.call('charge/commit',payload)).status,200);assert.equal(h.store.get('transactions/legacy').chargeAmendments.length,1);
});
test('correção de valores vale para a equipe ativa',async()=>{
 const h=nativeHarness();h.store.set('users/u',{active:true,role:'operacional',financialPermissions:[]});
 const d=await h.call('items/legacy');assert.equal(d.body.canAdjust,true);
 assert.equal((await h.call('charge/preview',await chargeBody(h))).status,200);
});
test('valores inválidos, sem motivo ou iguais aos atuais não gravam',async()=>{
 for(const o of [{honorarios:'-1'},{honorarios:'abc'},{extraItems:[{account:'Inexistente',amount:'10.00'}]},{extraItems:[{account:catalog.extras[0],amount:'0'}]},{honorarios:'0',extraItems:[]},{reason:'curto'},{extraItems:[]}]){const h=nativeHarness(),before=structuredClone([...h.store]);const r=await h.call('charge/preview',await chargeBody(h,o));assert.equal(r.status,400,JSON.stringify(o));assert.deepEqual([...h.store],before);}
});
test('bloqueia valor de conta com recebimento, histórico, boleto emitido ou duplicidade',async()=>{
 const paid=nativeHarness();await commit(paid,await body(paid));assert.equal((await paid.call('charge/preview',await chargeBody(paid))).status,409);
 const legacy=harness();assert.equal((await legacy.call('charge/preview',await chargeBody(legacy))).status,409);
 const boleto=nativeHarness();boleto.store.set('boletoIssues/x',{transactionId:'legacy',state:'issued'});const br=await boleto.call('charge/preview',await chargeBody(boleto));assert.equal(br.status,409);assert.match(br.body.error,/novo lançamento só com o valor extra/);
 const draft=nativeHarness();draft.store.set('boletoIssues/x',{transactionId:'legacy',state:'draft'});assert.equal((await draft.call('charge/preview',await chargeBody(draft))).status,200);
 const dup=nativeHarness();dup.store.set('transactions/other',{...nativeRow(),totalCobranca:150,valorOriginal:150});assert.equal((await dup.call('charge/preview',await chargeBody(dup))).status,409);
});
test('extra retirado do cadastro continua aceito no lançamento que já o tem',async()=>{
 const h=nativeHarness();Object.assign(h.store.get('transactions/legacy'),{honorarios:100,extraItems:[{account:'Extra antigo',amount:20}],valorExtra:20,extras:20,totalCobranca:120,valorOriginal:120,cobrancaExtra:'Extra antigo'});
 assert.equal((await h.call('charge/preview',await chargeBody(h,{honorarios:'110.00',extraItems:[{account:'Extra antigo',amount:'20.00'}]}))).status,200);
 const other=nativeHarness();assert.equal((await other.call('charge/preview',await chargeBody(other,{extraItems:[{account:'Extra antigo',amount:'20.00'}]}))).status,400);
});
const reopenBody=async(h,reason='Baixa lançada com data errada no histórico')=>{const d=await h.call('items/legacy');assert.equal(d.status,200);return {id:'legacy',requestId:randomUUID(),version:d.body.version,reason};};
test('reabre conta quitada fora do fluxo com prévia, motivo e histórico, e aceita nova baixa',async()=>{
 const h=harness();Object.assign(h.store.get('transactions/legacy'),{status:'Pago',pago:'Pago',paymentDate:'2026-01-02',dataPagamento:'02/01/2026',valueReceived:100,valorPago:'100.00'});
 const d=await h.call('items/legacy');assert.equal(d.body.reopenable,true);assert.ok(d.body.blockedReason);
 const b=await reopenBody(h),before=structuredClone([...h.store]);
 const p=await h.call('reopen/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));assert.equal(p.body.after.status,'Pendente');assert.deepEqual([...h.store],before);
 assert.equal((await h.call('reopen/commit',b)).status,409);
 const payload={...b,confirmHash:p.body.reviewHash},r=await h.call('reopen/commit',payload);assert.equal(r.status,200);
 const row=h.store.get('transactions/legacy');assert.equal(row.status,'Pendente');assert.equal(row.paymentDate,'');assert.equal(row.valueReceived,0);assert.equal(row.valorPago,'0.00');assert.equal(row.totalCobranca,100);
 assert.deepEqual(row.receivableReopenings.map(x=>[x.before.status,x.before.paymentDate,x.before.valueReceived,x.reason]),[['Pago','2026-01-02',100,'Baixa lançada com data errada no histórico']]);
 const audit=[...h.store].find(([k,v])=>k.startsWith('receivableAudit/')&&v.action==='legacy-reopen');assert.equal(audit[1].before.status,'Pago');
 assert.equal((await h.call('reopen/commit',payload)).status,200);assert.equal(h.store.get('transactions/legacy').receivableReopenings.length,1);
 const again=await h.call('items/legacy');assert.equal(again.body.reopenable,false);assert.equal(again.body.blockedReason,null);
 assert.equal((await commit(h,await body(h,{date:'2026-01-20',amount:'100.00',interest:'0',discount:'0'}))).status,200);assert.equal(h.store.get('transactions/legacy').status,'Pago');
});
test('reabertura exige perfil ativo e motivo; não vale para baixa bancária, baixa do Financeiro ou conta aberta',async()=>{
 const paid={status:'Pago',pago:'Pago',paymentDate:'2026-01-02',valueReceived:100};
 let h=harness();Object.assign(h.store.get('transactions/legacy'),paid);h.store.set('users/u',{active:true,role:'operacional',financialPermissions:[]});const pending=await reopenBody(h);
 h.store.get('users/u').status='blocked';assert.equal((await h.call('reopen/preview',pending)).status,403);
 h.store.set('users/u',{active:true,role:'operacional',financialPermissions:[]});assert.equal((await h.call('reopen/preview',await reopenBody(h))).status,200);
 assert.equal((await h.call('reopen/preview',await reopenBody(h,'curto'))).status,400);
 for(const extra of [{boletoSettlement:{evidenceId:'bank'}},{boletoReconciliation:{boletoId:'x'}}]){h=harness();Object.assign(h.store.get('transactions/legacy'),paid,extra);assert.equal((await h.call('items/legacy')).body.reopenable,false);assert.equal((await h.call('reopen/preview',await reopenBody(h))).status,409);}
 h=harness();assert.equal((await h.call('items/legacy')).body.reopenable,false);assert.equal((await h.call('reopen/preview',await reopenBody(h))).status,409);
 h=harness();await commit(h,await body(h,{amount:'100.00',interest:'0',discount:'0'}));assert.equal((await h.call('items/legacy')).body.reopenable,false);assert.equal((await h.call('reopen/preview',await reopenBody(h))).status,409);
});
test('reabertura aceita apelidos de pago e preserva valor guardado só no recebido',async()=>{
 for(const status of ['Paga','Quitado','Liquidado']){const h=harness();Object.assign(h.store.get('transactions/legacy'),{status});assert.equal((await h.call('items/legacy')).body.reopenable,true,status);}
 const h=harness(),row=h.store.get('transactions/legacy');delete row.totalCobranca;delete row.valorOriginal;Object.assign(row,{status:'Pago',valueReceived:100,paymentDate:'2026-01-02'});
 const b=await reopenBody(h),p=await h.call('reopen/preview',b);assert.equal(p.status,200,JSON.stringify(p.body));
 assert.equal((await h.call('reopen/commit',{...b,confirmHash:p.body.reviewHash})).status,200);
 const after=h.store.get('transactions/legacy');assert.equal(after.valorOriginal,100);assert.equal(after.valueReceived,0);assert.equal((await h.call('items/legacy')).status,200);
});
