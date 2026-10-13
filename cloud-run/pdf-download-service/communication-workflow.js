const stableJson=require('./stable-json');
const {createPayableSource,inspectEntry}=require('./communication-payable-source');
const catalog=require('./communication-catalog');
const {initial}=require('./communication-settings');
const {contactRecipients,recipients}=require('./communication-recipients');
// Administrative preparation and observation only. HTTP routes never dispatch mail.
const {createHash,randomUUID}=require('node:crypto');
const {createHistoryReader}=require('./boleto-history');
const {config,eligible,amount,money}=require('./boleto-cloud');
const {createBoletoSource}=require('./communication-boleto-source');
const {plan,createStore,execute}=require('./communication-rule');
const {createProvider}=require('./communication-provider');
const fingerprint=v=>createHash('sha256').update(stableJson(v)).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const idValid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const contactValid=c=>{try{contactRecipients(c);return true;}catch{return false;}};
function publicJob(j){return {id:j.id,status:j.status,scheduledAt:j.scheduledAt,expiresAt:j.expiresAt,recipient:contactRecipients(j.recipient).join('; '),number:j.number||'',client:j.client||'',createdAt:j.createdAt,validation:j.validation||null,review:j.review||null,reason:j.reason||null};}
function createWorkflow({db,env,allowed,fetchImpl=fetch,now=()=>new Date(),readHistory=async()=>createHistoryReader().load(db),getBucket}){
 const settingsRef=db.collection('financialSettings').doc('communicationRule');
 const contacts=db.collection('financialCommunicationContacts');
 const jobs=db.collection('financialCommunications');
 const cfg=config(env);
 const contactRef=(id,kind)=>contacts.doc(kind==='payable'?'payable-'+id:id);
 async function registeredContact(r,kind){if(kind!=='payable')return catalog.lookup(db,r.payerDocument);const settings=(await settingsRef.get()).data()||initial();return {emails:recipients(settings.payableRecipients),catalogRevision:String(settings.revision),sourceName:'Destinatários internos configurados'};}
 async function record(id,kind='receivable'){
  if(kind==='payable'){
   if(!/^[a-zA-Z0-9_-]{1,150}$/.test(id||''))fail('Conta inválida.',400);
   const entry=(await db.collection('transactions').doc(id).get()).data();inspectEntry(entry,now());
   return {entry,r:{id,number:id,payerName:entry.description||entry.client||id,dueDate:entry.dueDate,amountCents:require('./payables').nominal(entry)}};
  }
  if(kind!=='receivable')fail('Tipo inválido.',400);
  if(!idValid(id))fail('Selecione um boleto válido.',400);
  const history=await readHistory(),r=history.rows.find(r=>r.id===id);
  const account=history.meta.issuanceAccounts?.[cfg.accountFingerprint];
  if(cfg.environment!=='production'||!account||!r||account.beneficiaryDocument!==r.beneficiaryDocument||account.bank!==r.bank)fail('Boleto fora da conta homologada.');
  if(r.paidAt||r.cancelledAt||r.paidCents>0)fail('Boleto pago ou baixado.');
  let entry=null;
  if(r.transactionId){entry=(await db.collection('transactions').doc(r.transactionId).get()).data();if(!entry||!eligible(entry)||money(entry.valueReceived)>0||Math.round(amount(entry)*100)!==r.amountCents||entry.dueDate!==r.dueDate||String(entry.cpfCnpj||'').replace(/\D/g,'')!==r.payerDocument)fail('Lançamento indisponível ou divergente do boleto.');}
  return {r,entry};
 }
 function adapter(override=null,kind='receivable'){
  const loadBinding=async id=>{
   const {r,entry}=await record(id,kind),contact=override||(await contactRef(id,kind).get()).data();
   if(!contactValid(contact)||contact.active!==true)fail('Confirme os destinatários.');
   const registered=await registeredContact(r,kind);
   if(contact.catalogRevision!==registered.catalogRevision||JSON.stringify(contactRecipients(contact))!==JSON.stringify(registered.emails))fail('Cadastro de e-mails mudou. Confira novamente.');
   return {active:true,revision:fingerprint([r,entry,contact]),token:r.token||null,expected:{token:r.token||null,number:r.number,amountCents:r.amountCents,dueDate:r.dueDate,payerDocument:r.payerDocument||''},recipient:contact,...(entry?{entry}:{})};
  };
  if(kind==='payable')return createPayableSource({loadBinding,now,download:async(id,file)=>{if(!getBucket||!env.NATIVE_ENTRY_ATTACHMENT_BUCKET)fail('Armazenamento indisponível.');const [bytes]=await getBucket(env.NATIVE_ENTRY_ATTACHMENT_BUCKET).file(`native-finance/${id}/${file.sha256}`).download();return bytes;}});
  return createBoletoSource({base:cfg.base,apiKey:cfg.apiKey,fetchImpl,now,statement:require('./receivable-statement').statement,loadBinding});
 }
 async function authorize(job){
  const settings=(await settingsRef.get()).data()||initial();
  const profile=(await db.collection('users').doc(job.createdBy).get()).data();
  const contact=(await contactRef(job.source.id,job.source.kind).get()).data();
  return settings?.enabled===true&&settings.revision===job.settingsRevision&&allowed(profile)&&contact?.active===true&&contactValid(contact)&&JSON.stringify(contactRecipients(contact))===JSON.stringify(contactRecipients(job.recipient))&&contact.confirmedAt===job.recipient.confirmedAt;
 }
 return {
  async contact(historyId,kind='receivable'){const {r}=await record(historyId,kind);return registeredContact(r,kind);},
  async candidates(query='',kind='receivable'){
   if(kind==='payable'){const rows=[];let cursor,total=0;for(;;){let q=db.collection('transactions').orderBy('__name__').limit(500);if(cursor)q=q.startAfter(cursor);const page=await q.get();for(const doc of page.docs){total++;if(total>20000)fail('Volume exige consulta específica.');const e=doc.data();try{inspectEntry(e,now());}catch{continue;}if(![e.client,e.description,doc.id].join(' ').toLowerCase().includes(String(query).toLowerCase()))continue;rows.push({id:doc.id,number:doc.id,client:e.description||e.client||doc.id,dueDate:e.dueDate,amountCents:require('./payables').nominal(e)});}if(page.docs.length<500)break;cursor=page.docs.at(-1);}return {total:rows.length,rows:rows.slice(0,30),limit:30};}
   if(kind!=='receivable')fail('Tipo inválido.',400);
   const h=await readHistory(),account=h.meta.issuanceAccounts?.[cfg.accountFingerprint];
   if(!account||cfg.environment!=='production')fail('Conta não homologada.');
   const q=String(query).toLocaleLowerCase('pt-BR').slice(0,150);
   const rows=h.rows.filter(r=>r.bank===account.bank&&r.beneficiaryDocument===account.beneficiaryDocument&&!r.paidAt&&!r.cancelledAt&&!(r.paidCents>0)&&[r.number,r.payerName,r.payerDocument].join(' ').toLocaleLowerCase('pt-BR').includes(q));
   return {total:rows.length,limit:30,rows:rows.slice(0,30).map(r=>({id:r.id,number:r.number,client:r.payerName,dueDate:r.dueDate,amountCents:r.amountCents})),note:'Histórico para seleção. A prévia consulta a situação atual no emissor.'};
  },
  async preview({historyId,email,emails,kind='receivable'},uid){
   if(!contactValid({email,emails}))fail('Informe todos os e-mails cadastrados e conferidos.',400);
   const {r:contactRow}=await record(historyId,kind),registered=await registeredContact(contactRow,kind);
   if(JSON.stringify(recipients(emails??email))!==JSON.stringify(registered.emails))fail('Confira todos os e-mails do cadastro.');
   const contact={catalogRevision:registered.catalogRevision,emails:registered.emails,confirmedBy:uid,confirmedAt:now().toISOString(),active:true};
   const {r}=await record(historyId,kind),source=await adapter(contact,kind).readSource({id:historyId,kind});
   const settings=(await settingsRef.get()).data()||initial();
   const offsets=settings?.offsets;
   const planned=Array.isArray(offsets)&&offsets.length?plan({source,recipient:contact,offsets,now:now()}):plan({source,recipient:contact,offsets:[0],now:now()}).map(p=>({...p,id:fingerprint(['unscheduled-draft',source.kind,source.id]),status:'awaiting-schedule',offset:null,scheduledAt:null,expiresAt:null}));
   return {historyId,kind,number:r.number,client:r.payerName,issuedAt:kind==='receivable'?(r.createdAt||null):null,dataOrigin:kind==='receivable'?'Boleto Cloud':'Contas a pagar internas',contactOrigin:registered.sourceName,amountCents:source.amountCents,dueDate:source.dueDate,contact,settingsRevision:settings?.revision??0,source,planned};
  },
  async saveDraft(preview,uid,userRef,reason){
   if(typeof reason!=='string'||reason.trim().length<5||reason.length>500)fail('Informe o motivo da confirmação.',400);
   const source=await adapter(preview.contact,preview.kind).readSource({id:preview.historyId,kind:preview.kind});
   if(source.revision!==preview.source.revision)fail('Boleto alterado. Faça nova conferência.');
   return db.runTransaction(async tx=>{
    const user=(await tx.get(userRef)).data(),settings=(await tx.get(settingsRef)).data()||initial();
    const previous=(await tx.get(contactRef(preview.historyId,preview.kind))).data()||null;
    const existing=[];for(const p of preview.planned)existing.push((await tx.get(jobs.doc(p.id))).exists);
    if(!allowed(user))fail('Acesso revogado.',403);
    if(settings?.revision!==preview.settingsRevision||settings.enabled!==false)fail('Configuração alterada. Faça nova conferência.');
    if(existing.some(Boolean))fail('Esta cobrança já possui etapas preparadas. Confira o acompanhamento; não serão duplicadas.');
    const at=now().toISOString();
    tx.set(contactRef(preview.historyId,preview.kind),preview.contact);
    for(const p of preview.planned)tx.create(jobs.doc(p.id),{...p,status:'draft',plannedStatus:p.status,createdBy:uid,settingsRevision:settings.revision,number:preview.number,client:preview.client});
    tx.create(db.collection('financialCommunicationEvents').doc(randomUUID()),{action:'draft-confirmed',historyId:preview.historyId,uid,at,reason:reason.trim(),previousContact:previous,newContact:preview.contact,jobIds:preview.planned.map(p=>p.id)});
    return {count:preview.planned.length,enabled:false};
   });
  },
  // Explicit administrative re-review of unscheduled drafts, never a send/requeue.
  async refreshDraft(id,preview,uid,userRef,reason){
   if(!idValid(id)||typeof reason!=='string'||reason.trim().length<10||reason.length>500)fail('Informe a revisão do rascunho.');
   const source=await adapter(preview.contact,preview.kind).readSource({id:preview.historyId,kind:preview.kind});
   if(source.revision!==preview.source.revision)fail('Fonte alterada durante a revisão.');
   return db.runTransaction(async tx=>{
    const ref=jobs.doc(id),current=(await tx.get(ref)).data(),user=(await tx.get(userRef)).data(),settings=(await tx.get(settingsRef)).data()||initial();
    if(!allowed(user))fail('Acesso revogado.',403);
    if(settings.enabled!==false||settings.revision!==preview.settingsRevision||settings.offsets?.length)fail('Revisão exige envio desligado e dias a definir.');
    if(!current||current.status!=='draft'||current.scheduledAt!==null||current.attemptId)fail('Somente rascunho sem agendamento ou tentativa pode ser revisado.');
    const next=preview.planned.find(p=>p.id===id);
    if(!next||next.scheduledAt!==null||current.source.id!==source.id||current.source.kind!==source.kind||current.source.amountCents!==source.amountCents||current.source.dueDate!==source.dueDate)fail('Valor, vencimento ou identidade alterados; revisão específica necessária.');
    const at=now().toISOString();
    tx.set(contactRef(preview.historyId,preview.kind),preview.contact);
    tx.update(ref,{source:next.source,sourceFingerprint:next.sourceFingerprint,recipient:next.recipient,settingsRevision:settings.revision,validation:null,updatedAt:at});
    tx.create(db.collection('financialCommunicationEvents').doc(randomUUID()),{action:'draft-refreshed',jobId:id,uid,at,reason:reason.trim(),previousSource:current.source,newSource:next.source,previousRecipient:current.recipient,newRecipient:next.recipient});
    return {status:'draft',sent:false,scheduledAt:null};
   });
  },
  async manage(id,action,uid,userRef,reason){
   if(!idValid(id)||!['cancel','review'].includes(action))fail('Ação inválida.',400);
   if(typeof reason!=='string'||reason.trim().length<10||reason.length>1000)fail('Descreva a conferência ou o motivo (10 a 1000 caracteres).',400);
   return db.runTransaction(async tx=>{
    const user=(await tx.get(userRef)).data(),ref=jobs.doc(id),job=(await tx.get(ref)).data();
    if(!allowed(user))fail('Acesso revogado.',403);if(!job)fail('Etapa não encontrada.');
    if(action==='cancel'&&!['draft','queued'].includes(job.status))fail('Etapa já processada ou em andamento. Não é possível cancelar.');
    if(action==='review'&&!['unknown','blocked','accepted','suppressed'].includes(job.status))fail('Etapa não disponível para revisão.');
    const at=now().toISOString(),review={uid,at,reason:reason.trim()};
    tx.update(ref,action==='cancel'?{status:'cancelled',review,updatedAt:at}:{review,updatedAt:at});
    tx.create(db.collection('financialCommunicationEvents').doc(randomUUID()),{action:'manual-'+action,jobId:id,...review,previousStatus:job.status});
    return {status:action==='cancel'?'cancelled':job.status,sent:false,requeued:false};
   });
  },
  async list(){const result=await jobs.orderBy('createdAt','desc').limit(100).get();return {enabled:false,limit:100,rows:result.docs.map(d=>publicJob(d.data()))};},
  async validate(id,uid,userRef){
   if(!idValid(id))fail('Etapa inválida.',400);
   const ref=jobs.doc(id),job=(await ref.get()).data();if(!job||job.status!=='draft')fail('Somente rascunhos podem ser conferidos.');
   let validation;
   try{const a=adapter(null,job.source.kind),source=await a.readSource(job.source);if(source.revision!==job.source.revision)throw Error('source-changed');const files=await a.prepare(job);validation={status:'ready',checkedAt:now().toISOString(),attachments:files.attachments.map(x=>({name:x.name,bytes:x.content.length})),sent:false};}
   catch{validation={status:'blocked',checkedAt:now().toISOString(),reason:'Confira pagamento, vencimento, destinatário, composição e disponibilidade do emissor.',sent:false};}
   await db.runTransaction(async tx=>{const user=(await tx.get(userRef)).data(),current=(await tx.get(ref)).data();if(!allowed(user))fail('Acesso revogado.',403);if(!current||current.status!=='draft'||current.source.revision!==job.source.revision)fail('Etapa alterada.');tx.update(ref,{validation});tx.create(db.collection('financialCommunicationEvents').doc(randomUUID()),{action:'draft-validated',jobId:id,uid,...validation});});return validation;
  },
  // Future worker entry: no HTTP dispatch route; both server/config gates and reviewed queued jobs required.
  async process(id){
   if(env.FINANCEIRO_COMMUNICATION_SEND_ENABLED!=='true')return {status:'disabled'};
   if((await settingsRef.get()).data()?.enabled!==true)return {status:'disabled'};
   const job=(await jobs.doc(id).get()).data();if(!job)return {status:'not-found'};const a=adapter(null,job.source.kind);return execute({id,store:createStore(db),readSource:a.readSource,prepare:a.prepare,authorize,provider:createProvider({env,fetchImpl}),enabled:true,now});
  }
 };
}
async function handle({request,url,db,env,userRef,uid,allowed,readBody,reply,fetchImpl=fetch,getBucket}){
 const workflow=createWorkflow({db,env,allowed,fetchImpl,getBucket});
 const action=url.pathname.split('/').pop();
 const recheck=async()=>{if(!allowed((await userRef.get()).data()))fail('Acesso revogado.',403);};
 if(request.method==='GET'&&action==='candidates'){const result=await workflow.candidates(url.searchParams.get('q')||'',url.searchParams.get('kind')||'receivable');await recheck();reply(result);return;}
 if(request.method==='GET'&&action==='communications'){const result=await workflow.list();await recheck();reply(result);return;}
 if(request.method!=='POST')fail('Método não permitido.',405);
 let body;try{body=JSON.parse((await readBody(request)).toString('utf8'));}catch{fail('Dados inválidos.',400);}
 if(['cancel','review'].includes(action)){reply(await workflow.manage(body.id,action,uid,userRef,body.reason));return;}
 if(action==='contacts'){const data=await workflow.contact(body.historyId,body.kind);await recheck();reply(data);return;}
 if(action==='catalog-preview'){const data=catalog.compile(body.catalog);const previous=(await db.collection('financialSettings').doc('boletoPayers').get()).data();await recheck();reply({reviewToken:data.revision,expectedRevision:previous?.revision||null,count:data.count,blocked:data.blocked});return;}
 if(action==='catalog-import'){reply(await catalog.importCatalog({db,input:body.catalog,uid,userRef,allowed,reason:body.reason,expectedRevision:body.expectedRevision,reviewToken:body.reviewToken,now:()=>new Date()}));return;}
 if(action==='validate'){const result=await workflow.validate(body.id,uid,userRef);reply(result);return;}
 if(!['preview','draft'].includes(action))fail('Rota não encontrada.',404);
 // Recompute previews server-side. Never trust a source or recipient confirmation supplied by a client.
 const preview=await workflow.preview(body,uid);await recheck();
 const digest=fingerprint({historyId:preview.historyId,kind:preview.kind,number:preview.number,amount:preview.amountCents,due:preview.dueDate,issuedAt:preview.issuedAt,client:preview.client,emails:preview.contact.emails,settings:preview.settingsRevision,source:preview.source.reviewRevision});
 if(action==='preview'){reply({reviewToken:digest,number:preview.number,client:preview.client,issuedAt:preview.issuedAt,dataOrigin:preview.dataOrigin,contactOrigin:preview.contactOrigin,dueDate:preview.dueDate,amountCents:preview.amountCents,emails:preview.contact.emails,stages:preview.planned.map(p=>({scheduledAt:p.scheduledAt,status:p.status})),enabled:false});return;}
 if(body.reviewToken!==digest)fail('Prévia alterada. Confira novamente.');
 reply(await workflow.saveDraft(preview,uid,userRef,body.reason));
}
module.exports={createWorkflow,handle,publicJob};
