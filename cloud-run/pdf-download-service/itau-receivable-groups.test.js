const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const groups=require('./itau-receivable-groups');
const {ACCOUNT}=require('./itau-ofx');
const {idFor}=require('./boleto-history');
const {hash}=require('./itau-legacy-links');
function harness() {
 const store=new Map([['users/u',{active:true,role:'admin'}]]);let queue=Promise.resolve();
 const snap=ref=>({id:ref.path.split('/').pop(),exists:store.has(ref.path),data:()=>structuredClone(store.get(ref.path))});
 const doc=path=>({path,get:async()=>snap({path}),collection:name=>collection(`${path}/${name}`)});
 const query=(path,filters=[])=>({where:(k,op,v)=>query(path,[...filters,[k,op,v]]),get:async()=>({docs:[...store].filter(([k,v])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')&&filters.every(([key,op,val])=>v[key]===val)).map(([path])=>snap({path}))})});
 const collection=path=>({...query(path),doc:id=>doc(`${path}/${id}`)});
 const db={collection,getAll:async(...refs)=>refs.map(snap),runTransaction:fn=>{const run=queue.then(async()=>{let wrote=false;const changes=[];const read=ref=>{assert(!wrote,'reads precede writes');return snap(ref);};const result=await fn({get:async ref=>read(ref),getAll:async(...refs)=>refs.map(read),set:(ref,data)=>{wrote=true;changes.push([ref.path,data]);},create:(ref,data)=>{assert(!store.has(ref.path));wrote=true;changes.push([ref.path,data]);}});changes.forEach(([k,v])=>store.set(k,structuredClone(v)));return result;});queue=run.catch(()=>{});return run;}};
 const bank={accountId:ACCOUNT,date:'2026-10-13',amountCents:30000,fitid:'GROUP-1',name:'BOLETOS RECEBIDOS'};
 store.set(`bankStatements/${ACCOUNT}/entries/s1`,bank);
 const records=[],members=[];
 for(let i=1;i<=2;i++) {
  const token=`synthetic-boleto-token-${i}`,boletoId=idFor(token),transactionId=`t${i}`,paidCents=i*10000;
  const record={id:boletoId,token,transactionId,bank:'341',payerDocument:'12345678000199',payerName:`Cliente fictício ${i}`,beneficiaryDocument:'98765432000199',number:`${i}`,paidAt:'2026-10-10',creditedAt:bank.date,dueDate:'2026-10-10',amountCents:paidCents,paidCents,paymentOrigin:'BANCO',manuallyPaid:false,cancelledAt:null};
  const settlement={boletoId,evidenceId:`e${i}`,origin:'BANCO',paymentDate:record.paidAt,creditedAt:bank.date,paidCents};
  const row={movement:'Entrada',status:'Pago',bankAccount:require('./native-entry-catalog.json').banks[0],cpfCnpj:record.payerDocument,dueDate:record.dueDate,totalCobranca:paidCents/100,valueReceived:paidCents/100,paymentDate:record.paidAt,boletoSettlement:settlement};
  store.set(`transactions/${transactionId}`,row);
  store.set(`boletoHistoryUpdates/${boletoId}`,{record,syncedAt:'2026-10-14T12:00:00Z'});
  store.set(`boletoSettlementAudit/e${i}`,{transactionId,action:'bank-return-settlement',after:{boletoSettlement:settlement}});
  records.push(record);members.push({boletoId,transactionId});
 }
 store.set('boletoHistory/production',{snapshot:'test'});
 store.set('boletoHistorySnapshots/test',{complete:true,exportedAt:'2026-10-01T00:00:00Z',totals:{count:2}});
 store.set('boletoHistorySnapshots/test/chunks/one',{records});
 const input=async(id='s1')=>({...await groups.preview(db,'u',{statementId:id,members}),statementId:id,requestId:randomUUID(),reason:'Detalhamento conferido individualmente.',reference:'Relatório sintético do lote 001',checkedEvidence:true});
 return {db,store,members,input,bank};
}
test('audited individual receipts form one credit; confirmation and unlink never alter financial sources',async()=>{
 const h=harness(),before=structuredClone([...h.store]);
 const listed=await groups.list(h.db,'u','s1');assert.equal(listed.payments.length,2);assert(listed.payments.every(p=>p.eligible));assert(!JSON.stringify(listed).includes('synthetic-boleto-token'));
 const input=await h.input();assert.equal(input.totalCents,30000);
 const result=await groups.mutate(h.db,'u','confirm',input);assert(result.active);
 assert.deepEqual(await groups.mutate(h.db,'u','confirm',input),result);
 assert.equal((await groups.list(h.db,'u','s1')).link.validation,'current');
 await groups.mutate(h.db,'u','unlink',{statementId:'s1',requestId:randomUUID(),revision:1,reason:'Composição revista com detalhamento novo.'});
 for(const [key,value]of before)assert.deepEqual(h.store.get(key),value);
 for(const [key]of h.store)if(!before.some(([k])=>k===key))assert.match(key,/^(bankReceivableGroups|bankReceivableClaims|bankReceivableGroupOperations|bankStatementAudit)\//);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('bankStatementAudit/')).length,2);
});
test('amount difference, duplicate member, wrong bank/date, missing individual evidence fail closed',async()=>{
 for(const patch of [{amountCents:30001},{amountCents:-30000},{accountId:'other'},{date:'2026-10-14'},{name:'TED PAGAR.ME'}]){
  const h=harness();Object.assign(h.store.get(`bankStatements/${ACCOUNT}/entries/s1`),patch);await assert.rejects(h.input);
 }
 const h=harness();await assert.rejects(()=>groups.preview(h.db,'u',{statementId:'s1',members:[h.members[0],h.members[0]]}));
 for(const patch of [{status:'Pendente'},{isExcluded:true},{deletedAt:'today'},{receivableSettlement:{}},{bankAccount:'Outra conta'},{cpfCnpj:'other'},{totalCobranca:999}]){
  const h=harness();Object.assign(h.store.get('transactions/t1'),patch);await assert.rejects(h.input);
 }
 for(const patch of [{paymentOrigin:'USUARIO'},{manuallyPaid:true},{creditedAt:null},{paidCents:9999},{beneficiaryDocument:'11111111000111'},{cancelledAt:'2026-10-14'}]){
  const h=harness();Object.assign(h.store.get(`boletoHistoryUpdates/${h.members[0].boletoId}`).record,patch);await assert.rejects(h.input);
 }
 const missing=harness();missing.store.delete('boletoSettlementAudit/e1');await assert.rejects(missing.input);
 const list=await groups.list(missing.db,'u','s1');assert.equal(list.payments.filter(p=>p.eligible).length,1);
});
test('stale previews, revoked access and confirmation without evidence cannot write',async()=>{
 for(const update of [h=>h.store.get('transactions/t1').client='Mudou',h=>h.store.get(`boletoHistoryUpdates/${h.members[0].boletoId}`).syncedAt='later',h=>h.store.delete('boletoSettlementAudit/e1'),h=>h.store.set('users/u',{active:false,role:'admin'})]) {
  const h=harness(),input=await h.input();update(h);await assert.rejects(()=>groups.mutate(h.db,'u','confirm',input));assert(![...h.store.keys()].some(k=>k.startsWith('bankReceivableClaims/')));
 }
 for(const patch of [{checkedEvidence:false},{reference:''},{revision:-1},{requestId:'invalid'}]){const h=harness(),input=await h.input();await assert.rejects(()=>groups.mutate(h.db,'u','confirm',{...input,...patch}));}
});
test('concurrent groups cannot consume the same individual receipt twice',async()=>{
 const h=harness();h.store.set(`bankStatements/${ACCOUNT}/entries/s2`,{...h.bank,fitid:'GROUP-2'});
 const a=await h.input(),b=await h.input('s2');
 const results=await Promise.allSettled([groups.mutate(h.db,'u','confirm',a),groups.mutate(h.db,'u','confirm',b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(()=>groups.mutate(h.db,'u','confirm',{...a,reference:'Alterou referência mantendo requestId'}),/reutilizada/);
});
test('active operators use explicit read and settle grants; changed source is flagged and link can be undone',async()=>{
 const p={active:true,role:'operacional',financialPermissions:['itau.openfinance.read','billing.boleto-cloud.history.read','receivables.read','receivables.settle']};
 assert(groups.canWrite(p));assert(!groups.canWrite({...p,financialPermissions:p.financialPermissions.slice(0,3)}));assert(!groups.canRead({...p,status:'blocked'}));
 const h=harness();h.store.set('users/u',p);await groups.mutate(h.db,'u','confirm',await h.input());
 h.store.delete('transactions/t1');assert.equal((await groups.list(h.db,'u','s1')).link.validation,'changed');
 await groups.mutate(h.db,'u','unlink',{statementId:'s1',requestId:randomUUID(),revision:1,reason:'Recebimento fonte requer conferência.'});
 assert.equal(h.store.get(`bankReceivableGroups/${hash([ACCOUNT,'s1'])}`).active,false);
});
test('HTTP endpoints require revoked-token verification and explicit cross-module permissions',async()=>{
 const {createStatementHandler}=require('./itau-statements');
 for(const profile of [{active:true,role:'operacional',financialPermissions:['itau.openfinance.read']},{active:false,role:'admin'}]) {
  let verified=false,status;
  const handler=createStatementHandler({getServices:()=>({adminAuth:{verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);verified=true;return{uid:'u'};}},adminDb:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>profile})})})}}),readBody:async()=>{throw Error('must not read payload without permission');},sendJson:(req,res,s)=>{status=s;}});
  await handler({method:'POST',url:'/api/itau/receivable-groups/confirm',headers:{authorization:'Bearer test'}},{});
  assert(verified);assert.equal(status,403);
 }
});
