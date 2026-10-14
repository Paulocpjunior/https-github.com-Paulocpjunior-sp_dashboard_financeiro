const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const digits=x=>String(x||'').replace(/\D/g,'');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const active=u=>u?.active===true&&!['blocked','deleted'].includes(u.status);
const allowed=(u,method)=>active(u)&&(method==='GET'||u.role==='admin');
function identity(r){return digits(r.cpfCnpj)?'doc:'+digits(r.cpfCnpj):digits(r.clientNumber)?'number:'+digits(r.clientNumber):'name:'+norm(r.source)+':'+norm(r.client);}
function resolve(key,entries){const seen=new Set();while(entries[key]?.target){if(seen.has(key)||seen.size>20)fail('Vínculo cadastral circular. Solicite revisão.');seen.add(key);key=entries[key].target;}return {key,profile:entries[key]};}
function profile(r){return {client:String(r.client||'').trim(),cpfCnpj:digits(r.cpfCnpj),clientNumber:String(r.clientNumber||'').trim()};}
function change(state,source,target,input){
 if(!source||source.isExcluded||norm(source.movement)!=='entrada')fail('Selecione um lançamento de cliente disponível.');
 if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>2000)fail('Informe a justificativa e a evidência (10 a 2000 caracteres).',400);
 const entries=structuredClone(state.entries||{}),sourceKey=identity(source),resolved=resolve(sourceKey,entries);
 let key=resolved.key;
 if(input.action==='merge'){
  if(!target||target.isExcluded||norm(target.movement)!=='entrada')fail('Cadastro de destino indisponível.');
  if(!digits(target.cpfCnpj)&&!digits(target.clientNumber))fail('O destino precisa ter CPF/CNPJ ou número de cliente.');
  const destination=resolve(identity(target),entries);if(destination.key===key)fail('Os registros já estão vinculados ao mesmo cadastro.');
  const from=resolved.profile||profile(source),to=destination.profile||profile(target);
  if(digits(from.cpfCnpj)&&digits(to.cpfCnpj)&&digits(from.cpfCnpj)!==digits(to.cpfCnpj))fail('Documentos diferentes: corrija e confira a identificação antes de unificar.');
  entries[destination.key]=to;entries[key]={target:destination.key};
 }else if(input.action==='edit'){
  const p=input.profile;
  if(!p||typeof p.client!=='string'||p.client.trim().length<3||p.client.length>300||!/^\d{0,20}$/.test(String(p.clientNumber||'')))fail('Confira nome e número do cliente.',400);
  const document=digits(p.cpfCnpj);
  // Identification changes need a stable document; never infer an absent document.
  if(document&&![11,14].includes(document.length))fail('Informe CPF com 11 dígitos ou CNPJ com 14 dígitos.',400);
  const old=resolved.profile||profile(source);
  if(document!==digits(old.cpfCnpj)||String(p.clientNumber||'')!==String(old.clientNumber||''))fail('Para corrigir documento ou número, vincule ao cadastro correto. Identificadores não podem ser substituídos livremente.');
  entries[key]=profile(p);
 }else if(input.action==='unlink'){
  if(!entries[sourceKey]?.target)fail('Este registro não é um vínculo.');
  key=sourceKey;delete entries[key];
 }else fail('Ação inválida.',400);
 if(Object.keys(entries).length>2000||Buffer.byteLength(JSON.stringify(entries))>300000)fail('Limite de cadastros atingido. Solicite revisão.');
 return {...state,revision:(state.revision||0)+1,entries};
}
async function handle({request,url,db,userRef,user,uid,reply,readBody}){
 const path=url.pathname.replace('/api/financial-entries/customers/',''),ref=db.collection('financialSettings').doc('customerDirectory');
 const recheck=async tx=>{const u=(await(tx?tx.get(userRef):userRef.get())).data();if(!allowed(u,request.method))fail('Acesso revogado.',403);};
 if(request.method==='GET'){
  const state=(await ref.get()).data()||{revision:0,entries:{}};await recheck();
  if(path==='mappings'){reply(state);return;}
  if(path!=='list'||user.role!=='admin')fail('Acesso restrito ao administrador.',403);
  const month=url.searchParams.get('month');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))fail('Competência inválida.',400);
  const rows=await db.collection('transactions').where('dueDate','>=',month+'-01').where('dueDate','<=',month+'-31').limit(5001).get();
  if(rows.docs.length>5000)fail('Mais de 5000 lançamentos no período. Solicite revisão.');
  const groups=new Map();for(const d of rows.docs){const r=d.data();if(r.isExcluded||norm(r.movement)!=='entrada')continue;const key=identity(r),canonical=resolve(key,state.entries);const found=groups.get(key);if(found){found.count++;continue;}groups.set(key,{key,transactionId:d.id,source:profile(r),sourceSystem:r.source||'histórico',canonicalKey:canonical.key,profile:canonical.profile||profile(r),linked:Boolean(state.entries[key]?.target),count:1});}
  await recheck();reply({revision:state.revision,customers:[...groups.values()].sort((a,b)=>a.profile.client.localeCompare(b.profile.client,'pt-BR'))});return;
 }
 if(request.method!=='POST'||!['preview','commit'].includes(path))fail('Rota não encontrada.',404);
 let b;try{b=JSON.parse((await readBody(request)).toString('utf8'));}catch{fail('Dados inválidos.',400);}
 if(!/^[a-f0-9-]{36}$/.test(b.requestId||'')||![b.sourceId,...(b.targetId?[b.targetId]:[])].every(id=>/^[a-zA-Z0-9_-]{1,200}$/.test(id||'')))fail('Identificador inválido.',400);
 const key=hash([uid,b.requestId]),op=db.collection('customerOperations').doc(key),digest=hash([path,b]);
 const result=await db.runTransaction(async tx=>{
  await recheck(tx);const previous=(await tx.get(op)).data();if(previous){if(previous.digest!==digest)fail('Tentativa já usada.');return previous.result;}
  const state=(await tx.get(ref)).data()||{revision:0,entries:{}};if(state.revision!==b.revision)fail('Cadastro alterado. Recarregue antes de revisar.');
  const source=(await tx.get(db.collection('transactions').doc(b.sourceId))).data();
  const target=b.targetId?(await tx.get(db.collection('transactions').doc(b.targetId))).data():null;
  // Never discard a protected billing rule as a side effect of identity consolidation.
  if(b.action==='merge'){
   const root=resolve(identity(source),state.entries),p=root.profile||profile(source);
   const billingKey=digits(p.cpfCnpj)?'doc-'+digits(p.cpfCnpj):digits(p.clientNumber)?'client-'+digits(p.clientNumber):'name-'+norm(p.client).replace(/ /g,'-');
   const rules=await tx.get(db.collection('billingProfiles').where('identityKey','==',billingKey).limit(2));
   if(rules.docs.some(d=>d.data().active!==false))fail('Este cadastro possui regra de faturamento ativa. Revise essa regra antes de unificar; nenhuma configuração será descartada.');
  }
  const next=change(state,source,target,b),reviewHash=hash([uid,state,source,target,b.action,b.profile||null,b.reason]);
  const result={revision:next.revision,source:profile(source),after:resolve(identity(source),next.entries).profile||profile(source)};
  if(path==='preview')return {...result,reviewHash};
  if(b.confirmHash!==reviewHash)fail('Revise o cadastro antes de confirmar.');
  const at=new Date().toISOString();next.updatedAt=at;next.updatedBy=uid;
  tx.set(ref,next);tx.create(db.collection('customerAudit').doc(key),{uid,actor:user.name||uid,at,action:b.action,sourceId:b.sourceId,targetId:b.targetId||null,reason:b.reason.trim(),before:state,after:next});tx.create(op,{digest,result,at});return result;
 });reply(result);
}
module.exports={identity,resolve,change,allowed,handle};
