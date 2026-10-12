const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createWorkflow,publicJob}=require('./communication-workflow');
function setup(){
 const id='a'.repeat(64),store=new Map(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const cfg={revision:1,offsets:[0],enabled:false};store.set('financialSettings/communicationRule',cfg);store.set('users/admin',{active:true,role:'admin'});
 const bank={token:'private-token',numero:'123',vencimento:'2099-12-31',valor:10,situacao:'EM_ABERTO',registro:{situacao:'REGISTRO_CONFIRMADO'},pagador:{nome:'Teste',cprf:'52998224725'}};
 const row={id,token:bank.token,number:'123',payerName:'Teste',payerDocument:'52998224725',amountCents:1000,dueDate:'2099-12-31',beneficiaryDocument:'12345678000199',bank:'341'};
 const read=ref=>({exists:store.has(ref.path),data:()=>structuredClone(store.get(ref.path))});
 const collection=name=>({
  doc:id=>({path:name+'/'+id,get:async()=>read({path:name+'/'+id})}),
  orderBy:()=>({limit:()=>({get:async()=>({docs:[...store].filter(([k])=>k.startsWith(name+'/')).map(([,v])=>({data:()=>structuredClone(v)}))})})})
 });
 const db={collection,runTransaction:async fn=>{const changes=[];const out=await fn({get:async r=>read(r),set:(r,v)=>changes.push([r.path,v]),create:(r,v)=>{assert(!store.has(r.path));changes.push([r.path,v]);},update:(r,v)=>changes.push([r.path,{...store.get(r.path),...v}])});for(const [k,v] of changes)store.set(k,v);return out;}};
 const history={rows:[row],meta:{issuanceAccounts:{[hash('account')]:{beneficiaryDocument:row.beneficiaryDocument,bank:'341'}}}};
 let calls=0;
 const env={BOLETO_CLOUD_ENVIRONMENT:'production',BOLETO_CLOUD_CUTOVER_DATE:'2026-01-01',BOLETO_CLOUD_API_KEY:'secret',BOLETO_CLOUD_ACCOUNT_TOKEN:'account'};
 const w=createWorkflow({db,env,allowed:p=>p?.active===true&&p.role==='admin',readHistory:async()=>history,now:()=>new Date('2026-10-12T15:00:00Z'),fetchImpl:async url=>{calls++;return url.endsWith('/situacao')?{ok:true,json:async()=>({boleto:structuredClone(bank)})}:{ok:true,arrayBuffer:async()=>Buffer.from('%PDF-synthetic')};}});
 return {id,store,w,cfg,row,bank,env,history,userRef:collection('users').doc('admin'),calls:()=>calls,preview:()=>w.preview({historyId:id,email:'test@example.com'},'admin')};
}
test('server source -> reviewed drafts -> PDF validation, no financial writes or dispatch',async()=>{
 const f=setup(),p=await f.preview();assert.equal(p.planned.length,1);await f.w.saveDraft(p,'admin',f.userRef,'Conferido pelo administrador');
 const list=await f.w.list();assert.equal(list.rows[0].status,'draft');assert.ok(!JSON.stringify(list).includes('private-token'));
 const v=await f.w.validate(list.rows[0].id,'admin',f.userRef);assert.equal(v.status,'ready');assert.equal(v.sent,false);assert.equal(v.attachments.length,1);
 assert.equal((await f.w.process(list.rows[0].id)).status,'disabled');assert(![...f.store.keys()].some(k=>k.startsWith('transactions/')));
 await assert.rejects(f.w.saveDraft(p,'admin',f.userRef,'Repetição não permitida'),/já possui/);
});
test('revoked admin and changed settings prevent writes',async()=>{
 for(const mode of ['admin','settings']){const f=setup(),p=await f.preview();if(mode==='admin')f.store.set('users/admin',{active:false,role:'admin'});else f.cfg.revision=2;
 await assert.rejects(f.w.saveDraft(p,'admin',f.userRef,'Confirmar destinatário'));assert.equal([...f.store.keys()].filter(k=>k.startsWith('financialCommunications/')).length,0);}
});
test('source account mismatch, paid snapshot and local ledger mismatch block',async()=>{
 for(const mode of ['account','paid','ledger']){const f=setup();if(mode==='account')f.row.beneficiaryDocument='other';if(mode==='paid')f.row.paidCents=1;if(mode==='ledger')f.row.transactionId='missing';await assert.rejects(f.preview());assert.equal(f.calls(),0);}
});
test('payment after draft creation is recorded as blocked without requeue',async()=>{
 const f=setup(),p=await f.preview();await f.w.saveDraft(p,'admin',f.userRef,'Confirmar destinatário');f.bank.pagamento={valor:10};const v=await f.w.validate(p.planned[0].id,'admin',f.userRef);assert.equal(v.status,'blocked');assert.equal((await f.w.list()).rows[0].status,'draft');
});
test('missing days or multiple emails cannot silently activate defaults',async()=>{
 const f=setup();await assert.rejects(f.w.preview({historyId:f.id,email:'a@example.com;b@example.com'},'admin'));f.cfg.offsets=[];await assert.rejects(f.preview());
});
test('public status excludes private source, token, confirmation metadata',()=>{
 const out=publicJob({id:'x',status:'unknown',source:{token:'secret'},recipient:{email:'a@example.com',confirmedBy:'private-user'},attemptId:'private-attempt'});assert(!JSON.stringify(out).includes('secret'));assert(!JSON.stringify(out).includes('private-user'));
});
test('server send flag alone cannot activate worker',async()=>{const f=setup();f.env.FINANCEIRO_COMMUNICATION_SEND_ENABLED='true';assert.equal((await f.w.process('a'.repeat(64))).status,'disabled');assert.equal(f.calls(),0);});

test('worker is a no-op with server flag off, without accessing database',async()=>{
 const {run}=require('./communication-worker.cjs');assert.deepEqual(await run({db:null,env:{}}),{status:'disabled',processed:0});
});
