const test=require('node:test');const assert=require('node:assert/strict');
const {plan,createStore,execute,SENDER}=require('./communication-rule');
const now=new Date('2026-10-12T12:00:00Z');
const source={id:'synthetic',kind:'receivable',revision:'r1',status:'open',verified:true,amountCents:1001,dueDate:'2026-10-12'};
const recipient={email:'teste@example.com',confirmedBy:'admin',confirmedAt:'2026-10-11T12:00:00Z'};
const make=patch=>plan({source,recipient,offsets:[0],now,...patch})[0];
const artifacts=()=>({subject:'Lembrete fictício',text:'Teste',attachments:[{name:'boleto.pdf',type:'application/pdf',content:Buffer.from('%PDF-synthetic')}]});
function harness(){
 const data=new Map();let queue=Promise.resolve();
 const db={collection:name=>({doc:id=>({path:name+'/'+id})}),runTransaction:fn=>{
  const pending=queue.then(async()=>{let wrote=false;const writes=[];const out=await fn({get:async ref=>{assert(!wrote);return {exists:data.has(ref.path),data:()=>structuredClone(data.get(ref.path))};},set:(r,v)=>{wrote=true;writes.push([r.path,v]);},create:(r,v)=>{wrote=true;assert(!data.has(r.path));writes.push([r.path,v]);}});for(const [k,v] of writes)data.set(k,structuredClone(v));return out;});queue=pending.catch(()=>{});return pending;
 }};
 const store=createStore(db);let sends=0,current={...source},receipt={accepted:true,messageId:'synthetic-message'};
 const options={store,authorize:async()=>true,readSource:async()=>current,prepare:async()=>artifacts(),provider:{send:async payload=>{sends++;assert.equal(payload.from,SENDER);return receipt;}},enabled:true,now:()=>now};
 return {data,store,options,setSource:s=>current=s,setReceipt:r=>receipt=r,sends:()=>sends};
}
test('civil schedule, mandatory amount/recipient and stable keys prevent duplicate stages',()=>{
 const job=make();assert.equal(job.scheduledAt,now.toISOString());assert.equal(job.sender,SENDER);
 assert.equal(make({source:{...source,revision:'r2'},recipient:{...recipient,email:'other@example.com'}}).id,job.id);
 assert.equal(plan({source,recipient,offsets:[-3,0],now})[0].status,'expired');
 for(const patch of [{source:{...source,amountCents:0}},{source:{...source,dueDate:'2026-02-30'}},{recipient:{...recipient,confirmedBy:''}},{recipient:{...recipient,email:'a@example.com\r\nBcc: b@example.com'}},{offsets:[0,0]},{offsets:[1]}])assert.throws(()=>make(patch));
});
test('disabled is a strict no-op and two workers send only once',async()=>{
 const h=harness(),job=make();assert(await h.store.enqueue(job));assert.equal(await h.store.enqueue(job),false);
 assert.equal((await execute({...h.options,id:job.id,enabled:false})).status,'disabled');assert.equal(h.sends(),0);
 const results=await Promise.all([execute({...h.options,id:job.id}),execute({...h.options,id:job.id})]);assert.equal(h.sends(),1);assert.deepEqual(results.map(r=>r.status).sort(),['accepted','not-claimed']);
 assert.equal([...h.data.keys()].filter(k=>k.startsWith('financialCommunicationEvents/')).length,1);
 assert.equal(h.data.get('financialCommunications/'+job.id).status,'accepted');
});
test('payment, cancellation, partial payment and changed source suppress without sending',async()=>{
 for(const patch of [{status:'paid'},{paymentConfirmed:true},{receivedCents:1},{cancelled:true},{excluded:true},{verified:false},{revision:'r2'},{amountCents:1002}]){
  const h=harness(),job=make();await h.store.enqueue(job);h.setSource({...source,...patch});assert.equal((await execute({...h.options,id:job.id})).status,'suppressed');assert.equal(h.sends(),0);
 }
});
test('payment during preparation blocks dispatch; verification failure is fail-closed',async()=>{
 const h=harness(),job=make();await h.store.enqueue(job);
 assert.equal((await execute({...h.options,id:job.id,prepare:async()=>{h.setSource({...source,status:'paid'});return artifacts();}})).status,'suppressed');assert.equal(h.sends(),0);
 const x=harness();await x.store.enqueue(job);assert.equal((await execute({...x.options,id:job.id,readSource:async()=>{throw Error('offline');}})).status,'blocked');assert.equal(x.sends(),0);
});
test('missing or invalid PDF is blocked',async()=>{
 for(const attachments of [[],[{name:'fake.pdf',type:'application/pdf',content:Buffer.from('not pdf')}],[{name:'calendar.ics',type:'text/calendar',content:Buffer.from('ics')}]]){
  const h=harness(),job=make();await h.store.enqueue(job);assert.equal((await execute({...h.options,id:job.id,prepare:async()=>({...artifacts(),attachments})})).status,'blocked');assert.equal(h.sends(),0);
 }
});
test('timeout or malformed response is unknown and cannot automatically retry',async()=>{
 for(const receipt of [null,{}, {accepted:true}, {accepted:false}]){
  const h=harness(),job=make();await h.store.enqueue(job);h.setReceipt(receipt);assert.equal((await execute({...h.options,id:job.id})).status,'unknown');await execute({...h.options,id:job.id});assert.equal(h.sends(),1);
 }
 const h=harness(),job=make();await h.store.enqueue(job);assert.equal((await execute({...h.options,id:job.id,provider:{send:async()=>{throw Error('timeout after acceptance');}}})).status,'unknown');assert.equal((await execute({...h.options,id:job.id})).status,'not-claimed');
});
test('expired claims become unknown, expired reminders never send, future reminders wait',async()=>{
 const h=harness(),job=make();await h.store.enqueue(job);await h.store.claim(job.id,now.toISOString());assert.equal(await h.store.claim(job.id,'2026-10-12T12:06:00Z'),null);assert.equal(h.data.get('financialCommunications/'+job.id).status,'unknown');
 const x=harness();await x.store.enqueue(job);assert.equal(await x.store.claim(job.id,'2026-10-13T12:00:00Z'),null);assert.equal(x.data.get('financialCommunications/'+job.id).status,'expired');
 const y=harness();await y.store.enqueue(job);assert.equal(await y.store.claim(job.id,'2026-10-12T11:59:59Z'),null);assert.equal(y.data.get('financialCommunications/'+job.id).status,'queued');
});
test('persistence failure after provider acceptance never triggers resend',async()=>{
 const h=harness(),job=make();await h.store.enqueue(job);await assert.rejects(()=>execute({...h.options,id:job.id,store:{...h.store,finish:async()=>{throw Error('storage unavailable');}}}));assert.equal(h.sends(),1);assert.equal((await execute({...h.options,id:job.id})).status,'not-claimed');
});

test('revoked authorization or recipient blocks delivery even after preparation',async()=>{
 const h=harness(),job=make();await h.store.enqueue(job);let n=0;
 assert.equal((await execute({...h.options,id:job.id,authorize:async()=>++n===1})).reason,'authorization-revoked');assert.equal(h.sends(),0);
});
