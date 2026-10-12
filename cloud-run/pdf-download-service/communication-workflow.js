const {contactRecipients,recipients}=require('./communication-recipients');
// Administrative preparation and observation only. HTTP routes never dispatch mail.
const {createHash,randomUUID}=require('node:crypto');
const {createHistoryReader}=require('./boleto-history');
const {config,eligible,amount,money}=require('./boleto-cloud');
const {createBoletoSource}=require('./communication-boleto-source');
const {plan,createStore,execute}=require('./communication-rule');
const {createProvider}=require('./communication-provider');
const fingerprint=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const idValid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const contactValid=c=>{try{contactRecipients(c);return true;}catch{return false;}};
function publicJob(j){return {id:j.id,status:j.status,scheduledAt:j.scheduledAt,expiresAt:j.expiresAt,recipient:contactRecipients(j.recipient).join('; '),number:j.number||'',client:j.client||'',createdAt:j.createdAt,validation:j.validation||null,reason:j.reason||null};}
function createWorkflow({db,env,allowed,fetchImpl=fetch,now=()=>new Date(),readHistory=async()=>createHistoryReader().load(db)}){
 const settingsRef=db.collection('financialSettings').doc('communicationRule');
 const contacts=db.collection('financialCommunicationContacts');
 const jobs=db.collection('financialCommunications');
 const cfg=config(env);
 async function record(id){
  if(!idValid(id))fail('Selecione um boleto válido.',400);
  const history=await readHistory(),r=history.rows.find(r=>r.id===id);
  const account=history.meta.issuanceAccounts?.[cfg.accountFingerprint];
  if(cfg.environment!=='production'||!account||!r||account.beneficiaryDocument!==r.beneficiaryDocument||account.bank!==r.bank)fail('Boleto fora da conta homologada.');
  if(r.paidAt||r.cancelledAt||r.paidCents>0)fail('Boleto pago ou baixado.');
  let entry=null;
  if(r.transactionId){entry=(await db.collection('transactions').doc(r.transactionId).get()).data();if(!entry||!eligible(entry)||money(entry.valueReceived)>0||Math.round(amount(entry)*100)!==r.amountCents||entry.dueDate!==r.dueDate||String(entry.cpfCnpj||'').replace(/\D/g,'')!==r.payerDocument)fail('Lançamento indisponível ou divergente do boleto.');}
  return {r,entry};
 }
 function adapter(override=null){return createBoletoSource({base:cfg.base,apiKey:cfg.apiKey,fetchImpl,now,statement:require('./receivable-statement').statement,loadBinding:async id=>{
  const {r,entry}=await record(id),contact=override||(await contacts.doc(id).get()).data();
  if(!contactValid(contact)||contact.active!==true)fail('Confirme o destinatário desta cobrança.');
  return {active:true,revision:fingerprint([r,entry,contact]),token:r.token,expected:{token:r.token,number:r.number,amountCents:r.amountCents,dueDate:r.dueDate,payerDocument:r.payerDocument},recipient:contact,...(entry?{entry}:{})};
 }});}
 async function authorize(job){
  const settings=(await settingsRef.get()).data();
  const profile=(await db.collection('users').doc(job.createdBy).get()).data();
  const contact=(await contacts.doc(job.source.id).get()).data();
  return settings?.enabled===true&&settings.revision===job.settingsRevision&&allowed(profile)&&contact?.active===true&&contactValid(contact)&&JSON.stringify(contactRecipients(contact))===JSON.stringify(contactRecipients(job.recipient))&&contact.confirmedAt===job.recipient.confirmedAt;
 }
 return {
  async candidates(query=''){
   const h=await readHistory(),account=h.meta.issuanceAccounts?.[cfg.accountFingerprint];
   if(!account||cfg.environment!=='production')fail('Conta não homologada.');
   const q=String(query).toLocaleLowerCase('pt-BR').slice(0,150);
   const rows=h.rows.filter(r=>r.bank===account.bank&&r.beneficiaryDocument===account.beneficiaryDocument&&!r.paidAt&&!r.cancelledAt&&!(r.paidCents>0)&&[r.number,r.payerName,r.payerDocument].join(' ').toLocaleLowerCase('pt-BR').includes(q));
   return {total:rows.length,limit:30,rows:rows.slice(0,30).map(r=>({id:r.id,number:r.number,client:r.payerName,dueDate:r.dueDate,amountCents:r.amountCents})),note:'Histórico para seleção. A prévia consulta a situação atual no emissor.'};
  },
  async preview({historyId,email,emails},uid){
   if(!contactValid({email,emails}))fail('Informe todos os e-mails cadastrados e conferidos.',400);
   const contact={emails:recipients(emails??email),confirmedBy:uid,confirmedAt:now().toISOString(),active:true};
   const {r}=await record(historyId),source=await adapter(contact).readSource({id:historyId,kind:'receivable'});
   const settings=(await settingsRef.get()).data();
   const offsets=settings?.offsets;
   const planned=Array.isArray(offsets)&&offsets.length?plan({source,recipient:contact,offsets,now:now()}):plan({source,recipient:contact,offsets:[0],now:now()}).map(p=>({...p,id:fingerprint(['unscheduled-draft',source.kind,source.id]),status:'awaiting-schedule',offset:null,scheduledAt:null,expiresAt:null}));
   return {historyId,number:r.number,client:r.payerName,amountCents:r.amountCents,dueDate:r.dueDate,contact,settingsRevision:settings?.revision??0,source,planned};
  },
  async saveDraft(preview,uid,userRef,reason){
   if(typeof reason!=='string'||reason.trim().length<5||reason.length>500)fail('Informe o motivo da confirmação.',400);
   const source=await adapter(preview.contact).readSource({id:preview.historyId,kind:'receivable'});
   if(source.revision!==preview.source.revision)fail('Boleto alterado. Faça nova conferência.');
   return db.runTransaction(async tx=>{
    const user=(await tx.get(userRef)).data(),settings=(await tx.get(settingsRef)).data();
    const previous=(await tx.get(contacts.doc(preview.historyId))).data()||null;
    const existing=[];for(const p of preview.planned)existing.push((await tx.get(jobs.doc(p.id))).exists);
    if(!allowed(user))fail('Acesso revogado.',403);
    if(settings?.revision!==preview.settingsRevision||settings.enabled!==false)fail('Configuração alterada. Faça nova conferência.');
    if(existing.some(Boolean))fail('Esta cobrança já possui etapas preparadas. Confira o acompanhamento; não serão duplicadas.');
    const at=now().toISOString();
    tx.set(contacts.doc(preview.historyId),preview.contact);
    for(const p of preview.planned)tx.create(jobs.doc(p.id),{...p,status:'draft',plannedStatus:p.status,createdBy:uid,settingsRevision:settings.revision,number:preview.number,client:preview.client});
    tx.create(db.collection('financialCommunicationEvents').doc(randomUUID()),{action:'draft-confirmed',historyId:preview.historyId,uid,at,reason:reason.trim(),previousContact:previous,newContact:preview.contact,jobIds:preview.planned.map(p=>p.id)});
    return {count:preview.planned.length,enabled:false};
   });
  },
  async list(){const result=await jobs.orderBy('createdAt','desc').limit(100).get();return {enabled:false,limit:100,rows:result.docs.map(d=>publicJob(d.data()))};},
  async validate(id,uid,userRef){
   if(!idValid(id))fail('Etapa inválida.',400);
   const ref=jobs.doc(id),job=(await ref.get()).data();if(!job||job.status!=='draft')fail('Somente rascunhos podem ser conferidos.');
   let validation;
   try{const a=adapter(),source=await a.readSource(job.source);if(source.revision!==job.source.revision)throw Error('source-changed');const files=await a.prepare(job);validation={status:'ready',checkedAt:now().toISOString(),attachments:files.attachments.map(x=>({name:x.name,bytes:x.content.length})),sent:false};}
   catch{validation={status:'blocked',checkedAt:now().toISOString(),reason:'Confira pagamento, vencimento, destinatário, composição e disponibilidade do emissor.',sent:false};}
   await db.runTransaction(async tx=>{const user=(await tx.get(userRef)).data(),current=(await tx.get(ref)).data();if(!allowed(user))fail('Acesso revogado.',403);if(!current||current.status!=='draft'||current.source.revision!==job.source.revision)fail('Etapa alterada.');tx.update(ref,{validation});tx.create(db.collection('financialCommunicationEvents').doc(randomUUID()),{action:'draft-validated',jobId:id,uid,...validation});});return validation;
  },
  // Future worker entry: no HTTP dispatch route; both server/config gates and reviewed queued jobs required.
  async process(id){
   if(env.FINANCEIRO_COMMUNICATION_SEND_ENABLED!=='true')return {status:'disabled'};
   if((await settingsRef.get()).data()?.enabled!==true)return {status:'disabled'};
   const a=adapter();return execute({id,store:createStore(db),readSource:a.readSource,prepare:a.prepare,authorize,provider:createProvider({env,fetchImpl}),enabled:true,now});
  }
 };
}
async function handle({request,url,db,env,userRef,uid,allowed,readBody,reply,fetchImpl=fetch}){
 const workflow=createWorkflow({db,env,allowed,fetchImpl});
 const action=url.pathname.split('/').pop();
 const recheck=async()=>{if(!allowed((await userRef.get()).data()))fail('Acesso revogado.',403);};
 if(request.method==='GET'&&action==='candidates'){const result=await workflow.candidates(url.searchParams.get('q')||'');await recheck();reply(result);return;}
 if(request.method==='GET'&&action==='communications'){const result=await workflow.list();await recheck();reply(result);return;}
 if(request.method!=='POST')fail('Método não permitido.',405);
 let body;try{body=JSON.parse((await readBody(request)).toString('utf8'));}catch{fail('Dados inválidos.',400);}
 if(action==='validate'){const result=await workflow.validate(body.id,uid,userRef);reply(result);return;}
 if(!['preview','draft'].includes(action))fail('Rota não encontrada.',404);
 // Recompute previews server-side. Never trust a source or recipient confirmation supplied by a client.
 const preview=await workflow.preview(body,uid);await recheck();
 const digest=fingerprint({historyId:preview.historyId,number:preview.number,amount:preview.amountCents,due:preview.dueDate,emails:preview.contact.emails,settings:preview.settingsRevision,source:preview.source.reviewRevision});
 if(action==='preview'){reply({reviewToken:digest,number:preview.number,client:preview.client,dueDate:preview.dueDate,amountCents:preview.amountCents,emails:preview.contact.emails,stages:preview.planned.map(p=>({scheduledAt:p.scheduledAt,status:p.status})),enabled:false});return;}
 if(body.reviewToken!==digest)fail('Prévia alterada. Confira novamente.');
 reply(await workflow.saveDraft(preview,uid,userRef,body.reason));
}
module.exports={createWorkflow,handle,publicJob};
