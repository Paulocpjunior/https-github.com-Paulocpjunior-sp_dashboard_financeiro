const test=require('node:test');
const assert=require('node:assert/strict');
const {registerClient}=require('./client-registration');
const {allowed}=require('./native-entries');
// CNPJs válidos e fictícios.
const RADIO='07147345000111',OTHER='11222333000181';
function fixture(extra=[]){
 const store=new Map([['users/u',{active:true,role:'admin',name:'Financeiro'}],...extra]);
 const doc=path=>({path,get:async()=>({data:()=>structuredClone(store.get(path))})});
 const db={collection:n=>({doc:id=>doc(n+'/'+id),where:(field,op,value)=>({limit:()=>({get:async()=>({docs:[...store.entries()].filter(([k,v])=>k.startsWith(n+'/')&&v[field]===value).map(([k,v])=>({id:k.slice(n.length+1),data:()=>v}))})})})}),runTransaction:async fn=>{const writes=[];const result=await fn({get:ref=>ref.get(),set:(ref,v)=>writes.push([ref.path,v]),create:(ref,v)=>{assert.equal(store.has(ref.path),false);writes.push([ref.path,v]);}});writes.forEach(([p,v])=>store.set(p,structuredClone(v)));return result;}};
 return {store,call:body=>registerClient({db,userRef:doc('users/u'),user:store.get('users/u'),uid:'u',allowed,body})};
}
const body=(extra={})=>({requestId:'11111111-1111-4111-8111-111111111111',client:'RADIO SB FM LTDA',cpfCnpj:'07.147.345/0001-11',clientNumber:'170',source:'checklist',checklistSubmissionId:'5912345678901234567',...extra});
const audits=store=>[...store.keys()].filter(k=>k.startsWith('clientRegistryAudit/'));
test('cliente novo do Checklist entra no cadastro conferido com histórico e repetição idempotente',async()=>{
 const h=fixture(),r=await h.call(body());
 assert.deepEqual(r.client,{id:'doc-'+RADIO,client:'RADIO SB FM LTDA',clientNumber:'170',cpfCnpj:RADIO});
 assert.equal(r.created,true);
 const saved=h.store.get('clientRegistry/doc-'+RADIO);
 assert.equal(saved.status,'ready');assert.equal(saved.clientNumberNormalized,'170');assert.equal(saved.registeredFrom,'checklist');
 const [audit]=audits(h.store);const a=h.store.get(audit);
 assert.equal(a.action,'register');assert.equal(a.actor,'Financeiro');assert.equal(a.before,null);assert.equal(a.checklistSubmissionId,'5912345678901234567');
 assert.deepEqual(await h.call(body()),r);assert.equal(audits(h.store).length,1);
 await assert.rejects(h.call(body({client:'OUTRO NOME'})),/Tentativa já usada/);
});
test('cadastro já conferido não é substituído',async()=>{
 const ready={status:'ready',client:'RADIO SB FM',clientNumber:'170',clientNumberNormalized:'170',cpfCnpjDigits:RADIO};
 const h=fixture([['clientRegistry/doc-'+RADIO,ready]]),r=await h.call(body({client:'NOME DIFERENTE'}));
 assert.equal(r.existing,true);assert.equal(r.client.client,'RADIO SB FM');
 assert.deepEqual(h.store.get('clientRegistry/doc-'+RADIO),ready);assert.equal(audits(h.store).length,0);
});
test('cadastro pendente de N.Cliente é completado com antes e depois no histórico',async()=>{
 const pending={status:'missing_client_number',client:'RADIO SB FM LTDA',clientNumber:'',cpfCnpjDigits:RADIO,source:'transactions',createdAt:'2026-01-01T00:00:00.000Z'};
 const h=fixture([['clientRegistry/doc-'+RADIO,pending]]);await h.call(body());
 const saved=h.store.get('clientRegistry/doc-'+RADIO);assert.equal(saved.status,'ready');assert.equal(saved.source,'transactions');assert.equal(saved.createdAt,pending.createdAt);
 const a=h.store.get(audits(h.store)[0]);assert.equal(a.action,'complete-registry');assert.deepEqual(a.before,pending);
});
test('N.Cliente de outro cliente, documento inválido, cadastro manual sem motivo e acesso revogado são recusados',async()=>{
 const h=fixture([['clientRegistry/doc-'+OTHER,{status:'ready',client:'OUTRA EMPRESA',clientNumber:'170',clientNumberNormalized:'170',cpfCnpjDigits:OTHER}]]);
 await assert.rejects(h.call(body()),/já pertence a OUTRA EMPRESA/);
 await assert.rejects(h.call(body({cpfCnpj:'07147345000112'})),/CNPJ/);
 await assert.rejects(h.call(body({clientNumber:'A1'})),/N.Cliente/);
 await assert.rejects(h.call(body({source:'manual',checklistSubmissionId:'',reason:'curto'})),/motivo/);
 await assert.rejects(h.call(body({checklistSubmissionId:''})),/Checklist/);
 assert.equal(h.store.has('clientRegistry/doc-'+RADIO),false);
 const m=fixture();await m.call(body({source:'manual',checklistSubmissionId:'',reason:'Contrato assinado em 20/10, ainda fora do Checklist.'}));
 assert.equal(m.store.get(m.store.get(audits(m.store)[0]).after?'clientRegistry/doc-'+RADIO:'').registeredFrom,'manual');
 const r=fixture();r.store.set('users/u',{active:false,role:'admin'});await assert.rejects(r.call(body()),/Acesso revogado/);
});
