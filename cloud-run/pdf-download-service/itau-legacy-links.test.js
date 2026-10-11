const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {ACCOUNT}=require('./itau-ofx');
const links=require('./itau-legacy-links');
const statement={date:'2026-10-09',amountCents:-1001,fitid:'SYNTHETIC',name:'Fornecedor fictício'};
const payment={status:'Pago',movement:'Saída',paymentDate:'2026-10-09',valorPago:'10.01',client:'Fornecedor fictício'};
function harness(){
 const store=new Map([['users/admin',{active:true,role:'admin',name:'Administrador teste'}],['transactions/p1',structuredClone(payment)],[`bankStatements/${ACCOUNT}/entries/s1`,structuredClone(statement)]]);
 let seq=0,queue=Promise.resolve();
 const snapshot=ref=>({exists:store.has(ref.path),data:()=>structuredClone(store.get(ref.path))});
 const doc=path=>({path,get:async()=>snapshot({path}),collection:name=>collection(`${path}/${name}`)});
 const query=(path,filters=[],limit=1001)=>({where:(k,op,v)=>query(path,[...filters,[k,op,v]],limit),limit:n=>query(path,filters,n),get:async()=>{const values=[...store].filter(([k,v])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')&&filters.every(([key,op,val])=>op==='>='?v[key]>=val:v[key]<=val)).slice(0,limit);return {size:values.length,docs:values.map(([k])=>snapshot({path:k}))};}});
 const collection=path=>({...query(path),doc:id=>doc(`${path}/${id||++seq}`)});
 const db={collection,getAll:async(...refs)=>refs.map(snapshot),runTransaction:fn=>{
  const run=queue.then(async()=>{let wrote=false;const changes=[];const read=ref=>{assert(!wrote,'all reads must precede writes');return snapshot(ref);};const result=await fn({get:async ref=>read(ref),getAll:async(...refs)=>refs.map(read),set:(ref,data)=>{wrote=true;changes.push([ref.path,data]);},create:(ref,data)=>{assert(!store.has(ref.path));wrote=true;changes.push([ref.path,data]);}});for(const [k,v] of changes)store.set(k,structuredClone(v));return result;});queue=run.catch(()=>{});return run;
 }};
 const input=async()=>({...await links.preview(db,'admin',{statementId:'s1',transactionId:'p1'}),statementId:'s1',transactionId:'p1',requestId:randomUUID(),reason:'Favorecido e valor conferidos.',reference:'Comprovante interno TEST-001',checkedEvidence:true});
 return {db,store,input};
}
test('confirmation and unlink only write metadata, preserve history and allow safe retry',async()=>{
 const h=harness(),before=structuredClone([...h.store]);const input=await h.input();
 const result=await links.mutate(h.db,'admin','confirm',input);assert.equal(result.active,true);
 assert.equal((await links.mutate(h.db,'admin','confirm',input)).replayed,true);
 const list=await links.list(h.db,'2026-10-01','2026-10-11');assert.equal(list[0].validation,'current');assert.equal(list[0].payment.bankEvidence,'missing');assert.equal(list[0].history[0].actor.name,'Administrador teste');
 const unlink={statementId:'s1',requestId:randomUUID(),revision:result.revision,reason:'Comprovante revisado: associação incorreta.'};
 assert.equal((await links.mutate(h.db,'admin','unlink',unlink)).active,false);
 assert.equal((await links.mutate(h.db,'admin','unlink',unlink)).replayed,true);
 assert.equal((await links.list(h.db,'2026-10-01','2026-10-11'))[0].history.length,2);
 for(const [k,v] of before)assert.deepEqual(h.store.get(k),v);
 for(const [k] of h.store)if(!before.some(([old])=>old===k))assert.match(k,/^(bankLegacyLinks|bankLegacyPaymentLocks|bankLegacyLinkOperations|bankStatementAudit)\//);
});
test('changed, excluded, reversed, native, missing, other-bank and nonmatching evidence blocks confirmation',async()=>{
 for(const patch of [{valorPago:'10.02'},{isExcluded:true},{payableReversals:[{}]},{source:'native-finance'},{bankAccount:'Outro banco'},{status:'Pendente'},{client:'Outro favorecido'},{cpfCnpj:'identity-changed'}]){
  const h=harness(),input=await h.input();Object.assign(h.store.get('transactions/p1'),patch);
  await assert.rejects(()=>links.mutate(h.db,'admin','confirm',input));assert.equal([...h.store.keys()].filter(k=>k.startsWith('bankLegacyLinks/')).length,0);
 }
 const h=harness(),input=await h.input();h.store.delete('transactions/p1');await assert.rejects(()=>links.mutate(h.db,'admin','confirm',input));
});
test('concurrent attempts cannot reuse the same payment or bank debit',async()=>{
 const h=harness();h.store.set(`bankStatements/${ACCOUNT}/entries/s2`,{...statement,fitid:'SECOND'});
 const a=await h.input(),b={...a,...await links.preview(h.db,'admin',{statementId:'s2',transactionId:'p1'}),statementId:'s2',requestId:randomUUID()};
 const results=await Promise.allSettled([links.mutate(h.db,'admin','confirm',a),links.mutate(h.db,'admin','confirm',b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(()=>links.mutate(h.db,'admin','confirm',{...a,requestId:randomUUID()}),/mudou|ativo/);
 await assert.rejects(()=>links.mutate(h.db,'admin','confirm',{...a,reason:'Motivo diferente da solicitação anterior'}),/reutilizada/);
});
test('revoked admin, malformed requests and unacknowledged evidence cannot write',async()=>{
 for(const profile of [{active:true,role:'operacional'},{active:false,role:'admin'},{active:true,role:'admin',status:'blocked'}]){
  const h=harness(),input=await h.input();h.store.set('users/admin',profile);await assert.rejects(()=>links.mutate(h.db,'admin','confirm',input),e=>e.status===403);
 }
 for(const patch of [{reason:'curta'},{reference:''},{checkedEvidence:false},{revision:-1},{statementId:'../s1'},{requestId:'bad'}]){
  const h=harness(),input=await h.input();await assert.rejects(()=>links.mutate(h.db,'admin','confirm',{...input,...patch}),e=>e.status===400);
 }
});
test('source changes are flagged and unlink stays possible without editing missing source',async()=>{
 const h=harness(),input=await h.input();await links.mutate(h.db,'admin','confirm',input);
 h.store.get('transactions/p1').client='Alterado';assert.equal((await links.list(h.db,'2026-10-01','2026-10-11'))[0].validation,'changed');
 h.store.delete('transactions/p1');assert.equal((await links.list(h.db,'2026-10-01','2026-10-11'))[0].validation,'missing');
 await links.mutate(h.db,'admin','unlink',{statementId:'s1',requestId:randomUUID(),revision:1,reason:'Fonte indisponível para verificação.'});assert(!h.store.has('transactions/p1'));
});
test('stale unlink cannot remove a newer link, and a released payment can be reviewed again',async()=>{
 const h=harness();await links.mutate(h.db,'admin','confirm',await h.input());
 const unlink={statementId:'s1',requestId:randomUUID(),revision:1,reason:'Associação desfeita para nova revisão.'};
 await links.mutate(h.db,'admin','unlink',unlink);
 const next=await h.input();assert.equal(next.revision,2);await links.mutate(h.db,'admin','confirm',next);
 await assert.rejects(()=>links.mutate(h.db,'admin','unlink',{...unlink,requestId:randomUUID()}),/mudou/);
});
