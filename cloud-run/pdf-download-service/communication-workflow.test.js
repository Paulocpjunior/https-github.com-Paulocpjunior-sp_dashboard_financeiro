const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {compile}=require('./communication-catalog');
const {createWorkflow,publicJob}=require('./communication-workflow');
function setup(){
 const id='a'.repeat(64),store=new Map(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const setCatalog=emails=>store.set('financialSettings/boletoPayers',compile({format:'boleto-payers-v1',sourceName:'synthetic.xls',sourceSha256:'f'.repeat(64),rows:[{document:'52998224725',name:'Teste',emails}]}));setCatalog(['test@example.com']);
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
 return {setCatalog,id,store,w,cfg,row,bank,env,history,userRef:collection('users').doc('admin'),calls:()=>calls,preview:()=>w.preview({historyId:id,email:'test@example.com'},'admin')};
}
test('server source -> reviewed drafts -> PDF validation, no financial writes or dispatch',async()=>{
 const f=setup(),p=await f.preview();assert.equal(p.planned.length,1);await f.w.saveDraft(p,'admin',f.userRef,'Conferido pelo administrador');
 const list=await f.w.list();assert.equal(list.rows[0].status,'draft');assert.ok(!JSON.stringify(list).includes('private-token'));
 const v=await f.w.validate(list.rows[0].id,'admin',f.userRef);assert.equal(v.status,'ready');assert.equal(v.sent,false);assert.equal(v.attachments.length,2);
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
test('missing days preserves an unscheduled draft and malformed recipients are rejected',async()=>{
 const f=setup();await assert.rejects(f.w.preview({historyId:f.id,email:'a@example.com;b@example.com'},'admin'));f.cfg.offsets=[];const p=await f.preview();assert.equal(p.planned[0].scheduledAt,null);assert.equal(p.planned[0].expiresAt,null);assert.equal(p.planned[0].offset,null);assert.equal(p.planned[0].status,'awaiting-schedule');await f.w.saveDraft(p,'admin',f.userRef,'Dias ainda não definidos');assert.equal((await f.w.list()).rows[0].status,'draft');assert.equal((await f.w.validate(p.planned[0].id,'admin',f.userRef)).status,'ready');
});
test('public status excludes private source, token, confirmation metadata',()=>{
 const out=publicJob({id:'x',status:'unknown',source:{token:'secret'},recipient:{email:'a@example.com',confirmedBy:'private-user'},attemptId:'private-attempt'});assert(!JSON.stringify(out).includes('secret'));assert(!JSON.stringify(out).includes('private-user'));
});
test('server send flag alone cannot activate worker',async()=>{const f=setup();f.env.FINANCEIRO_COMMUNICATION_SEND_ENABLED='true';assert.equal((await f.w.process('a'.repeat(64))).status,'disabled');assert.equal(f.calls(),0);});

test('worker is a no-op with server flag off, without accessing database',async()=>{
 const {run}=require('./communication-worker.cjs');assert.deepEqual(await run({db:null,env:{}}),{status:'disabled',processed:0});
});

test('all confirmed recipients survive preview and drafts; changing one blocks PDF validation',async()=>{
 const f=setup();f.setCatalog(['a@example.com','b@example.com']);const p=await f.w.preview({historyId:f.id,emails:['B@example.com','a@example.com','b@example.com']},'admin');
 assert.deepEqual(p.contact.emails,['a@example.com','b@example.com']);
 await f.w.saveDraft(p,'admin',f.userRef,'Todos os endereços conferidos');
 assert.equal((await f.w.list()).rows[0].recipient,'a@example.com; b@example.com');
 assert.equal((await f.w.validate(p.planned[0].id,'admin',f.userRef)).status,'ready');
 f.store.get('financialCommunicationContacts/'+f.id).emails=['a@example.com','c@example.com'];
 assert.equal((await f.w.validate(p.planned[0].id,'admin',f.userRef)).status,'blocked');
 await assert.rejects(f.w.preview({historyId:f.id,emails:['a@example.com','invalid']},'admin'));
});

test('catalog changes invalidate prior confirmation; missing settings preserves no-date draft',async()=>{
 const f=setup();f.store.delete('financialSettings/communicationRule');const p=await f.preview();await f.w.saveDraft(p,'admin',f.userRef,'Conferido sem agendamento');
 assert.equal((await f.w.validate(p.planned[0].id,'admin',f.userRef)).status,'ready');
 f.setCatalog(['new@example.com']);assert.equal((await f.w.validate(p.planned[0].id,'admin',f.userRef)).status,'blocked');
});

test('cancellation and uncertain-result review never requeue or erase audit',async()=>{
 const f=setup(),p=await f.preview();await f.w.saveDraft(p,'admin',f.userRef,'Conferir destinatário');const id=p.planned[0].id;
 const cancelled=await f.w.manage(id,'cancel','admin',f.userRef,'Cancelar rascunho conferido');assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.requeued,false);
 f.store.get('financialCommunications/'+id).status='unknown';
 await assert.rejects(f.w.manage(id,'cancel','admin',f.userRef,'Não cancelar envio incerto'));
 const reviewed=await f.w.manage(id,'review','admin',f.userRef,'Conferido manualmente em Enviados; sem reenvio');assert.equal(reviewed.status,'unknown');assert.equal(reviewed.requeued,false);
 assert([...f.store.values()].some(v=>v.action==='manual-review'));
 f.store.set('users/admin',{active:false});await assert.rejects(f.w.manage(id,'review','admin',f.userRef,'Outra conferência com acesso revogado'));
});


test('receivable preview identifies Boleto Cloud and preserves its emission date without inventing missing dates',async()=>{
 const f=setup();f.row.createdAt='2026-10-09';
 const p=await f.preview();assert.equal(p.dataOrigin,'Boleto Cloud');assert.equal(p.contactOrigin,'synthetic.xls');assert.equal(p.issuedAt,'2026-10-09');assert.equal(p.dueDate,f.bank.vencimento);
 delete f.row.createdAt;assert.equal((await f.preview()).issuedAt,null);
 f.bank.vencimento='2099-12-30';await assert.rejects(f.preview());
});
