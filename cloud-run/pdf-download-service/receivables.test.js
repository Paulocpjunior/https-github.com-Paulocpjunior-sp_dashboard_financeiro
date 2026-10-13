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
test('permissões de recebimento são independentes das contas a pagar',async()=>{
 const h=harness();h.store.set('users/u',{active:true,role:'operacional',financialPermissions:['payables.settle']});assert.equal((await h.call('items/legacy')).status,403);
 h.store.get('users/u').financialPermissions=['receivables.read'];assert.equal((await h.call('items/legacy')).status,200);assert.equal((await h.call('receipt/preview',await body(h))).status,403);
 h.store.get('users/u').financialPermissions=['receivables.settle'];assert.equal((await commit(h,await body(h))).status,200);
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
