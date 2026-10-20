const {createHash}=require('node:crypto');
const {validDocument}=require('./boleto-cloud');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const digits=x=>String(x||'').replace(/\D/g,'');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const active=u=>u?.active===true&&!['blocked','deleted'].includes(u.status);
const allowed=(u,method)=>active(u)&&['GET','POST'].includes(method);
function identity(r){return digits(r.cpfCnpj)?'doc:'+digits(r.cpfCnpj):digits(r.clientNumber)?'number:'+digits(r.clientNumber):'name:'+norm(r.source)+':'+norm(r.client);}
function resolve(key,entries){const seen=new Set();while(entries[key]?.target){if(seen.has(key)||seen.size>20)fail('Vínculo cadastral circular. Solicite revisão.');seen.add(key);key=entries[key].target;}return {key,profile:entries[key]};}
function profile(r){return {client:String(r.client||'').trim(),cpfCnpj:digits(r.cpfCnpj),clientNumber:String(r.clientNumber||'').trim()};}
// Same key as utils/billingForecast.ts getBillingIdentityKey.
const billingKey=p=>digits(p.cpfCnpj)?'doc-'+digits(p.cpfCnpj):digits(p.clientNumber)?'client-'+digits(p.clientNumber):'name-'+(norm(p.client).replace(/ /g,'-')||'sem-identificacao');
const billingId=k=>k.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,140);
const number=x=>{const d=digits(x);return d?d.replace(/^0+(?=\d)/,''):'';};
function change(state,source,target,input,{identifiers=false}={}){
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
  if(document!==digits(old.cpfCnpj)||String(p.clientNumber||'')!==String(old.clientNumber||'')){
   // Only the billing rule flow may correct identifiers: it checks duplicates and moves the rule with them.
   if(!identifiers)fail('Para corrigir documento ou número, vincule ao cadastro correto. Identificadores não podem ser substituídos livremente.');
   if(document&&!validDocument(document))fail('CPF/CNPJ inválido: confira os dígitos verificadores.',400);
   if(digits(old.cpfCnpj)&&!document)fail('Informe o CPF/CNPJ correto. O documento não pode ficar em branco.',400);
   if(digits(old.clientNumber)&&!digits(p.clientNumber))fail('Informe o N.Cliente correto. O número não pode ficar em branco.',400);
  }
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
  if(path!=='list')fail('Acesso restrito ao administrador.',403);
  const month=url.searchParams.get('month');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))fail('Competência inválida.',400);
  const rows=await db.collection('transactions').where('dueDate','>=',month+'-01').where('dueDate','<=',month+'-31').limit(5001).get();
  if(rows.docs.length>5000)fail('Mais de 5000 lançamentos no período. Solicite revisão.');
  const groups=new Map();for(const d of rows.docs){const r=d.data();if(r.isExcluded||norm(r.movement)!=='entrada')continue;const key=identity(r),canonical=resolve(key,state.entries);const found=groups.get(key);if(found){found.count++;continue;}groups.set(key,{key,transactionId:d.id,source:profile(r),sourceSystem:r.source||'histórico',canonicalKey:canonical.key,profile:canonical.profile||profile(r),linked:Boolean(state.entries[key]?.target),count:1});}
  await recheck();reply({revision:state.revision,customers:[...groups.values()].sort((a,b)=>a.profile.client.localeCompare(b.profile.client,'pt-BR'))});return;
 }
 if(request.method!=='POST'||!['preview','commit','billing-profile'].includes(path))fail('Rota não encontrada.',404);
 let b;try{b=JSON.parse((await readBody(request)).toString('utf8'));}catch{fail('Dados inválidos.',400);}
 if(path==='billing-profile'){reply(await saveBillingProfile({db,ref,user,uid,recheck,b}));return;}
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
   const rules=await tx.get(db.collection('billingProfiles').where('identityKey','==',billingKey(p)).limit(2));
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
// A corrected CPF/CNPJ or N.Cliente cannot take over another customer's identity: that is a merge, with its own review.
async function identifierConflicts(tx,db,entries,key,before,after){
 const others=new Map();
 const doc=digits(after.cpfCnpj),num=number(after.clientNumber);
 if(doc&&doc!==digits(before.cpfCnpj)){
  for(const [k,v] of Object.entries(entries))if(!v.target&&k!==key&&digits(v.cpfCnpj)===doc)others.set(k,v.client);
  for(const d of (await tx.get(db.collection('clientRegistry').where('cpfCnpjDigits','==',doc).limit(5))).docs){const r=resolve('doc:'+doc,entries);if(r.key!==key)others.set(r.key,(r.profile||d.data()).client);}
 }
 if(num&&num!==number(before.clientNumber)){
  for(const [k,v] of Object.entries(entries))if(!v.target&&k!==key&&number(v.clientNumber)===num)others.set(k,v.client);
  for(const d of (await tx.get(db.collection('clientRegistry').where('clientNumberNormalized','==',num).limit(5))).docs){
   const r=d.data(),registryKey=digits(r.cpfCnpjDigits)?resolve('doc:'+digits(r.cpfCnpjDigits),entries):null;
   if(registryKey?.key===key)continue;
   // The other customer may already have been corrected to a different number.
   if(registryKey?.profile&&number(registryKey.profile.clientNumber)!==num)continue;
   others.set(registryKey?.key||'registry:'+d.id,registryKey?.profile?.client||r.client||'outro cliente');
  }
 }
 if(others.size)fail(`${doc&&doc!==digits(before.cpfCnpj)?'CPF/CNPJ':'N.Cliente'} já pertence a ${[...others.values()].filter(Boolean).slice(0,2).join(', ')||'outro cliente'}. Se for a mesma empresa, use Cadastros de clientes › Unificar.`);
}
const channels=['email','whatsapp','printed'],methods=['Boleto Itaú','Fatura Wix','Boleto Itaú + Fatura Wix','Outro'];
const day=x=>Number.isInteger(x)&&x>=1&&x<=31;
const text=(x,max)=>{if(x!=null&&typeof x!=='string')fail('Dados inválidos.',400);const t=String(x||'').trim();if(t.length>max)fail('Texto muito longo.',400);return t;};
function rule(input){
 const r={groupName:text(input.groupName,200),billingMethod:text(input.billingMethod,60),issueDay:input.issueDay,issueMonthOffset:input.issueMonthOffset??0,dueDay:input.dueDay,deliveryChannels:input.deliveryChannels,billingEmail:text(input.billingEmail,300),whatsapp:text(input.whatsapp,60),printedDeliveryDetails:text(input.printedDeliveryDetails,1000),billingInstructions:text(input.billingInstructions,2000)};
 if(!methods.includes(r.billingMethod)||!day(r.issueDay)||!day(r.dueDay)||![-1,0].includes(r.issueMonthOffset)||!Array.isArray(r.deliveryChannels)||!r.deliveryChannels.length||r.deliveryChannels.some(c=>!channels.includes(c))||new Set(r.deliveryChannels).size!==r.deliveryChannels.length)fail('Complete os campos obrigatórios da regra de faturamento.',400);
 if(r.deliveryChannels.includes('email')&&!r.billingEmail||r.deliveryChannels.includes('whatsapp')&&!r.whatsapp||r.deliveryChannels.includes('printed')&&!r.printedDeliveryDetails)fail('Complete o contato do meio de envio escolhido.',400);
 return r;
}
// Billing rule and customer identity are saved together, with one audit record (who, when, why, before and after).
async function saveBillingProfile({db,ref,user,uid,recheck,b}){
 if(!/^[a-f0-9-]{36}$/.test(b.requestId||'')||!/^[a-zA-Z0-9_-]{1,200}$/.test(b.sourceId||'')||!/^[a-zA-Z0-9_-]{1,140}$/.test(b.profileId||''))fail('Identificador inválido.',400);
 const reason=text(b.reason,2000),next=rule(b.rule||{}),wanted=b.customer||{};
 const key=hash([uid,b.requestId]),op=db.collection('customerOperations').doc(key),digest=hash(['billing-profile',b]);
 return db.runTransaction(async tx=>{
  await recheck(tx);const previous=(await tx.get(op)).data();if(previous){if(previous.digest!==digest)fail('Tentativa já usada.');return previous.result;}
  const state=(await tx.get(ref)).data()||{revision:0,entries:{}},source=(await tx.get(db.collection('transactions').doc(b.sourceId))).data();
  if(!source||source.isExcluded||norm(source.movement)!=='entrada')fail('A empresa não está mais disponível na base de lançamentos. Atualize a tela.');
  const resolved=resolve(identity(source),state.entries||{}),before=resolved.profile||profile(source),beforeKey=billingKey(before);
  if(b.identityKey!==beforeKey)fail('Cadastro alterado por outra pessoa. Atualize a tela e revise.');
  const identityChanged=['client','cpfCnpj','clientNumber'].some(f=>(f==='cpfCnpj'?digits(wanted[f]):String(wanted[f]||'').trim())!==(f==='cpfCnpj'?digits(before[f]):String(before[f]||'').trim()));
  let directory=state,after=before;
  if(identityChanged){
   if(state.revision!==b.revision)fail('Cadastro alterado por outra pessoa. Atualize a tela e revise.');
   if(reason.length<10)fail('Informe o motivo da correção de empresa, CPF/CNPJ ou N.Cliente (mínimo de 10 caracteres).',400);
   directory=change(state,source,null,{action:'edit',reason,profile:wanted},{identifiers:true});after=directory.entries[resolved.key];
   await identifierConflicts(tx,db,state.entries||{},resolved.key,before,after);
  }
  const afterKey=billingKey(after),id=billingId(afterKey),oldRef=db.collection('billingProfiles').doc(b.profileId),newRef=db.collection('billingProfiles').doc(id);
  const oldRule=(await tx.get(oldRef)).data()||null,currentRule=id===b.profileId?oldRule:(await tx.get(newRef)).data()||null;
  if(oldRule&&oldRule.active!==false&&(oldRule.identityKey||'')!==beforeKey)fail('Regra de faturamento vinculada a outro cadastro. Atualize a tela.');
  if(id!==b.profileId&&currentRule&&currentRule.active!==false)fail(`Já existe regra de faturamento ativa para ${currentRule.client||'esse cadastro'}. Se for a mesma empresa, use Cadastros de clientes › Unificar.`);
  const rules=await tx.get(db.collection('billingProfiles').where('identityKey','==',afterKey).limit(3));
  if(rules.docs.some(d=>d.id!==id&&d.id!==b.profileId&&d.data().active!==false))fail('Já existe regra de faturamento ativa para esse CPF/CNPJ ou N.Cliente.');
  const at=new Date().toISOString(),actor=user.name||user.username||uid;
  const saved={...(oldRule||{}),...next,id,identityKey:afterKey,client:after.client,cpfCnpj:after.cpfCnpj,clientNumber:after.clientNumber,active:true,createdAt:oldRule?.createdAt||at,updatedAt:at,updatedBy:actor,updatedByUid:uid};
  delete saved.movedTo;
  if(identityChanged){directory={...directory,updatedAt:at,updatedBy:uid};tx.set(ref,directory);}
  if(oldRule&&id!==b.profileId)tx.set(oldRef,{...oldRule,active:false,movedTo:id,updatedAt:at,updatedBy:actor,updatedByUid:uid});
  tx.set(newRef,saved);
  const result={profile:saved,revision:directory.revision,identityChanged};
  tx.create(db.collection('billingProfileAudit').doc(key),{uid,actor,at,action:identityChanged?'billing-profile-identity':'billing-profile',sourceId:b.sourceId,reason,before:{customer:before,rule:oldRule},after:{customer:after,rule:saved},...(identityChanged?{directoryRevisionBefore:state.revision||0,directoryRevisionAfter:directory.revision}:{})});
  if(identityChanged)tx.create(db.collection('customerAudit').doc(key),{uid,actor,at,action:'edit-identifiers',sourceId:b.sourceId,targetId:null,reason,before:state,after:directory});
  tx.create(op,{digest,result,at});return result;
 });
}
module.exports={identity,resolve,change,allowed,handle,billingKey};
