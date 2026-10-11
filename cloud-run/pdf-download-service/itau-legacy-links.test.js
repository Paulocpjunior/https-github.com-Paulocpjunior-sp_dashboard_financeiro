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
function nativeHarness(){
 const h=harness(),paymentRequestId=randomUUID();
 const p={requestId:paymentRequestId,uid:'admin',date:'2026-10-09',amountCents:1001,bankAccount:require('./native-entry-catalog.json').banks[0],supplier:'Fornecedor fictício'};
 const transaction={movement:'Saída',status:'Pendente',valuePaid:'30.00',payablePayments:[p],payableSettlement:p,payableBalance:{remainingCents:1999},payableReversals:[]};
 const auditId=require('node:crypto').createHash('sha256').update(JSON.stringify(['admin',paymentRequestId])).digest('hex');
 h.store.set('transactions/p1',transaction);
 h.store.set(`payableAudit/${auditId}`,{action:'payment',uid:'admin',transactionId:'p1',after:structuredClone(transaction)});
 const target={statementId:'s1',transactionId:'p1',paymentRequestId};
 h.input=async()=>({...await links.preview(h.db,'admin',target,'native'),...target,requestId:randomUUID(),reason:'Favorecido e baixa conferidos.',reference:'Comprovante fictício TEST-NATIVE',checkedEvidence:true});
 return {...h,paymentRequestId,auditId,target};
}
test('native partial payment uses individual settlement and immutable audit; no second financial write',async()=>{
 const h=nativeHarness(),before=structuredClone([...h.store]);
 const input=await h.input();assert.equal(input.payment.amountCents,1001);
 await links.mutate(h.db,'admin','confirm',input,'native');
 assert.equal((await links.mutate(h.db,'admin','confirm',input,'native')).replayed,true);
 const list=await links.list(h.db,'2026-10-01','2026-10-11');
 assert.equal(list[0].kind,'native');assert.equal(list[0].validation,'current');assert.equal(list[0].paymentRequestId,h.paymentRequestId);
 await assert.rejects(()=>links.mutate(h.db,'admin','unlink',{statementId:'s1',revision:1,requestId:randomUUID(),reason:'Desfazer associação para revisão.'}),/Tipo/);
 await links.mutate(h.db,'admin','unlink',{statementId:'s1',revision:1,requestId:randomUUID(),reason:'Desfazer associação para revisão.'},'native');
 for(const [key,value] of before)assert.deepEqual(h.store.get(key),value);
});
test('native confirmation rejects changed audit, reversed/excluded payment, wrong account and missing source',async()=>{
 for(const change of [
  h=>h.store.get('transactions/p1').payableReversals.push({paymentRequestId:h.paymentRequestId}),
  h=>{h.store.get('transactions/p1').isExcluded=true;},
  h=>{h.store.get('transactions/p1').payablePayments[0].bankAccount='Outro banco';},
  h=>h.store.delete(`payableAudit/${h.auditId}`),
  h=>{h.store.get(`payableAudit/${h.auditId}`).after.payableSettlement.amountCents=1002;},
  h=>{h.store.get('transactions/p1').payablePayments.push(h.store.get('transactions/p1').payablePayments[0]);},
  h=>h.store.delete('transactions/p1'),
 ]){
  const h=nativeHarness(),input=await h.input();change(h);
  await assert.rejects(()=>links.mutate(h.db,'admin','confirm',input,'native'));
  assert(![...h.store.keys()].some(k=>k.startsWith('bankLegacyLinks/')));
 }
});
test('native links become stale on reversal and can be undone without reversing twice',async()=>{
 const h=nativeHarness();await links.mutate(h.db,'admin','confirm',await h.input(),'native');
 h.store.get('transactions/p1').payableReversals.push({paymentRequestId:h.paymentRequestId});
 assert.equal((await links.list(h.db,'2026-10-01','2026-10-11'))[0].validation,'changed');
 await links.mutate(h.db,'admin','unlink',{statementId:'s1',revision:1,requestId:randomUUID(),reason:'Pagamento foi estornado posteriormente.'},'native');
 assert.equal(h.store.get('transactions/p1').payableReversals.length,1);
});
test('legacy and native paths share debit exclusivity; native payment cannot be reused',async()=>{
 const h=nativeHarness();h.store.set('transactions/legacy',structuredClone(payment));
 const native=await h.input();
 const legacy={...await links.preview(h.db,'admin',{statementId:'s1',transactionId:'legacy'}),statementId:'s1',transactionId:'legacy',requestId:randomUUID(),reason:'Favorecido conferido com documento.',reference:'Comprovante TEST',checkedEvidence:true};
 const results=await Promise.allSettled([links.mutate(h.db,'admin','confirm',native,'native'),links.mutate(h.db,'admin','confirm',legacy)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 h.store.set(`bankStatements/${ACCOUNT}/entries/s2`,{...statement,fitid:'SECOND'});
 const second={...await links.preview(h.db,'admin',{...h.target,statementId:'s2'},'native'),...h.target,statementId:'s2',requestId:randomUUID(),reason:native.reason,reference:native.reference,checkedEvidence:true};
 await assert.rejects(()=>links.mutate(h.db,'admin','confirm',second,'native'),/outro débito/);
});
test('two partial settlements of one title can link separately, never using accumulated paid total',async()=>{
 const h=nativeHarness();await links.mutate(h.db,'admin','confirm',await h.input(),'native');
 const transaction=h.store.get('transactions/p1');
 const second={...transaction.payablePayments[0],requestId:randomUUID(),amountCents:1999};
 transaction.payablePayments.push(second);transaction.payableSettlement=second;transaction.status='Pago';transaction.valorPago='30.00';
 const auditId=require('node:crypto').createHash('sha256').update(JSON.stringify(['admin',second.requestId])).digest('hex');
 h.store.set(`payableAudit/${auditId}`,{action:'payment',uid:'admin',transactionId:'p1',after:structuredClone(transaction)});
 h.store.set(`bankStatements/${ACCOUNT}/entries/s2`,{...statement,fitid:'SECOND',amountCents:-1999});
 const target={statementId:'s2',transactionId:'p1',paymentRequestId:second.requestId};
 const preview=await links.preview(h.db,'admin',target,'native');assert.equal(preview.payment.amountCents,1999);
 await links.mutate(h.db,'admin','confirm',{...preview,...target,requestId:randomUUID(),reason:'Segunda parcela conferida individualmente.',reference:'Documento fictício segunda parcela',checkedEvidence:true},'native');
 assert.equal((await links.list(h.db,'2026-10-01','2026-10-11')).filter(l=>l.active).length,2);
 assert.equal(transaction.valorPago,'30.00');
});
const groups=require('./itau-group-links');
function groupHarness(){
 const h=nativeHarness(),secondId=randomUUID();
 const second={...h.store.get('transactions/p1').payablePayments[0],requestId:secondId,amountCents:1999,supplier:'Segundo favorecido fictício'};
 const transaction={movement:'Saída',status:'Pago',payablePayments:[second],payableSettlement:second};
 h.store.set('transactions/p2',transaction);
 const auditId=require('node:crypto').createHash('sha256').update(JSON.stringify(['admin',secondId])).digest('hex');
 h.store.set(`payableAudit/${auditId}`,{action:'payment',uid:'admin',transactionId:'p2',after:structuredClone(transaction)});
 h.store.set(`bankStatements/${ACCOUNT}/entries/s1`,{...statement,amountCents:-3000});
 const members=[{transactionId:'p1',paymentRequestId:h.paymentRequestId},{transactionId:'p2',paymentRequestId:secondId}];
 h.groupInput=async()=>({...await groups.preview(h.db,'admin',{statementId:'s1',members}),statementId:'s1',requestId:randomUUID(),reason:'Lote e favorecidos conferidos individualmente.',reference:'Comprovante fictício do lote TEST-GROUP',checkedEvidence:true});
 return {...h,members,secondId};
}
test('group confirmation and undo are atomic metadata-only operations with replay and full history',async()=>{
 const h=groupHarness(),before=structuredClone([...h.store]),input=await h.groupInput();
 const result=await groups.mutate(h.db,'admin','confirm',input);assert.equal(result.active,true);
 assert.equal((await groups.mutate(h.db,'admin','confirm',input)).replayed,true);
 let list=await links.list(h.db,'2026-10-01','2026-10-11');assert.equal(list[0].validation,'current');assert.equal(list[0].payments.length,2);
 const undo={statementId:'s1',requestId:randomUUID(),revision:1,reason:'Lote revisado e associação desfeita.'};
 await groups.mutate(h.db,'admin','unlink',undo);assert.equal((await groups.mutate(h.db,'admin','unlink',undo)).replayed,true);
 list=await links.list(h.db,'2026-10-01','2026-10-11');assert.equal(list[0].history.length,2);assert.equal(list[0].history[1].members.length,2);
 assert.equal([...h.store].filter(([k,v])=>k.startsWith('bankLegacyPaymentLocks/')&&v.active).length,0);
 for(const [k,v] of before)assert.deepEqual(h.store.get(k),v);
});
test('group rejects duplicate selection, under/over totals, invalid count, wrong dates and missing audit',async()=>{
 for(const selection of [[],[{transactionId:'p1',paymentRequestId:'bad'}],Array(26).fill({transactionId:'p1',paymentRequestId:'bad'})])await assert.rejects(()=>groups.preview(groupHarness().db,'admin',{statementId:'s1',members:selection}));
 const duplicate=groupHarness();await assert.rejects(()=>groups.preview(duplicate.db,'admin',{statementId:'s1',members:[duplicate.members[0],duplicate.members[0]]}),/duas vezes/);
 for(const amount of [-3001,-2999,3000]){const h=groupHarness();h.store.get(`bankStatements/${ACCOUNT}/entries/s1`).amountCents=amount;await assert.rejects(()=>h.groupInput());}
 const h=groupHarness();h.store.get(`bankStatements/${ACCOUNT}/entries/s1`).date='2026-10-01';await assert.rejects(()=>h.groupInput(),/três dias/);
});
test('group revalidates all members and audit before any write, including reversal and access revocation',async()=>{
 for(const change of [h=>h.store.get('transactions/p1').payableReversals.push({paymentRequestId:h.paymentRequestId}),h=>h.store.delete(`payableAudit/${h.auditId}`),h=>{h.store.get('transactions/p2').isExcluded=true;},h=>{h.store.get('users/admin').active=false;}]){
  const h=groupHarness(),input=await h.groupInput();change(h);await assert.rejects(()=>groups.mutate(h.db,'admin','confirm',input));
  assert(![...h.store.keys()].some(k=>k.startsWith('bankLegacyPaymentLocks/')));
 }
 const h=groupHarness(),input=await h.groupInput();h.store.get('transactions/p2').description='Alterado após prévia';await assert.rejects(()=>groups.mutate(h.db,'admin','confirm',input),/mudou/);
 await assert.rejects(()=>groups.mutate(h.db,'admin','confirm',{...input,checkedEvidence:false}),e=>e.status===400);
});
test('group and individual links cannot reuse a payment or the same bank debit',async()=>{
 const h=groupHarness(),input=await h.groupInput();
 h.store.set(`bankStatements/${ACCOUNT}/entries/s2`,{...statement,fitid:'SECOND'});
 const single={...await links.preview(h.db,'admin',{...h.target,statementId:'s2'},'native'),...h.target,statementId:'s2',requestId:randomUUID(),reason:input.reason,reference:input.reference,checkedEvidence:true};
 const outcomes=await Promise.allSettled([groups.mutate(h.db,'admin','confirm',input),links.mutate(h.db,'admin','confirm',single,'native')]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 h.store.set('transactions/legacy',{...payment,valorPago:'30.00'});
 await assert.rejects(()=>links.preview(h.db,'admin',{statementId:'s1',transactionId:'legacy'}),/ativo/);
 const second=groupHarness(),g=await second.groupInput();second.store.set('transactions/legacy',{...payment,valorPago:'30.00'});
 const old={...await links.preview(second.db,'admin',{statementId:'s1',transactionId:'legacy'}),statementId:'s1',transactionId:'legacy',requestId:randomUUID(),reason:g.reason,reference:g.reference,checkedEvidence:true};
 await links.mutate(second.db,'admin','confirm',old);await assert.rejects(()=>groups.mutate(second.db,'admin','confirm',g),/mudou|ativo/);
});
test('group flags changed sources, permits undo when source disappears, stale undo cannot touch new group',async()=>{
 const h=groupHarness();await groups.mutate(h.db,'admin','confirm',await h.groupInput());
 const original=structuredClone(h.store.get('transactions/p2'));h.store.delete('transactions/p2');
 assert.equal((await links.list(h.db,'2026-10-01','2026-10-11'))[0].validation,'changed');
 const undo={statementId:'s1',requestId:randomUUID(),revision:1,reason:'Fonte indisponível; revisar lote.'};await groups.mutate(h.db,'admin','unlink',undo);
 h.store.set('transactions/p2',original);await groups.mutate(h.db,'admin','confirm',await h.groupInput());
 await assert.rejects(()=>groups.mutate(h.db,'admin','unlink',{...undo,requestId:randomUUID()}),/mudou/);
});
