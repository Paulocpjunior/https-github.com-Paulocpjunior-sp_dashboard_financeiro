// Transport-independent foundation. No route, scheduler or live provider is enabled here.
const {createHash,randomUUID}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SENDER='financeiro@spassessoriacontabil.com.br';
function day(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw Error('Data civil inválida.');
 return value;
}
function email(value){
 if(typeof value!=='string'||value.length>254||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value))throw Error('Destinatário inválido.');
 return value.trim().toLowerCase();
}
function identity(source){
 if(!source||!['receivable','payable'].includes(source.kind)||typeof source.id!=='string'||!source.id||source.id.length>200||typeof source.revision!=='string'||!source.revision)throw Error('Fonte sem identidade ou revisão.');
 if(!Number.isSafeInteger(source.amountCents)||source.amountCents<=0)throw Error('Valor ainda não confirmado.');
 return {id:source.id,kind:source.kind,revision:source.revision,dueDate:day(source.dueDate),amountCents:source.amountCents};
}
function stopReason(source){
 if(!source)return 'source-unavailable';
 if(source.excluded===true||source.cancelled===true)return 'cancelled';
 // Partial payment also stops this version: it must not send the original full amount.
 if(source.status==='paid'||source.paymentConfirmed===true||source.receivedCents>0)return 'payment-detected';
 if(source.status!=='open'||source.verified!==true)return 'source-unverified';
 return null;
}
function plan({source,recipient,offsets,now=new Date()}){
 const reason=stopReason(source);if(reason)throw Error(reason);
 const snapshot=identity(source),to=email(recipient?.email);
 if(typeof recipient?.confirmedBy!=='string'||!recipient.confirmedBy||!Number.isFinite(Date.parse(recipient.confirmedAt))||Date.parse(recipient.confirmedAt)>now.getTime())throw Error('Destinatário precisa de confirmação administrativa.');
 if(!Array.isArray(offsets)||!offsets.length||offsets.length>5||offsets.some(n=>!Number.isInteger(n)||n < -30||n>0)||new Set(offsets).size!==offsets.length)throw Error('Escolha até cinco dias distintos entre -30 e 0. Pós-vencimento exige fluxo próprio.');
 return [...offsets].sort((a,b)=>a-b).map(offset=>{
  const due=new Date(snapshot.dueDate+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+offset);
  const scheduledAt=due.toISOString();
  // Keys do not include revision/email: editing either must not create a second reminder for the same stage.
  const id=hash(['financial-reminder-v1',snapshot.kind,snapshot.id,snapshot.dueDate,offset]);
  return {id,status:due<now?'expired':'queued',scheduledAt,expiresAt:new Date(due.getTime()+86400000).toISOString(),source:snapshot,sourceFingerprint:hash(snapshot),recipient:{email:to,confirmedBy:recipient.confirmedBy,confirmedAt:recipient.confirmedAt},sender:SENDER,replyTo:SENDER,offset,createdAt:now.toISOString()};
 });
}
function createStore(db){
 const ref=id=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('Identificador inválido.');return db.collection('financialCommunications').doc(id);};
 return {
  enqueue:job=>db.runTransaction(async tx=>{const r=ref(job.id),old=await tx.get(r);if(old.exists)return false;tx.create(r,job);return true;}),
  claim:(id,at)=>db.runTransaction(async tx=>{
   const r=ref(id),job=(await tx.get(r)).data();if(!job)return null;
   if(job.status==='sending'&&job.leaseUntil<=at){tx.set(r,{...job,status:'unknown',updatedAt:at});return null;}
   if(job.status!=='queued'||job.scheduledAt>at)return null;
   if(job.expiresAt<=at){tx.set(r,{...job,status:'expired',updatedAt:at});return null;}
   const attemptId=randomUUID(),next={...job,status:'sending',attemptId,leaseUntil:new Date(Date.parse(at)+300000).toISOString(),updatedAt:at};tx.set(r,next);return next;
  }),
  finish:(job,result,at)=>db.runTransaction(async tx=>{
   const r=ref(job.id),current=(await tx.get(r)).data();
   if(!current||!['sending','unknown'].includes(current.status)||current.attemptId!==job.attemptId)throw Error('Tentativa mudou; resultado requer conferência.');
   const event=db.collection('financialCommunicationEvents').doc(job.attemptId);
   const existing=await tx.get(event);if(existing.exists)return false;
   tx.set(r,{...current,...result,updatedAt:at});
   tx.create(event,{jobId:job.id,attemptId:job.attemptId,...result,at});return true;
  })
 };
}
function validateArtifacts(artifacts){
 if(!artifacts||typeof artifacts.subject!=='string'||!artifacts.subject.trim()||/[\r\n]/.test(artifacts.subject)||artifacts.subject.length>200||typeof artifacts.text!=='string'||!artifacts.text.trim())throw Error('Mensagem inválida.');
 if(!Array.isArray(artifacts.attachments)||!artifacts.attachments.length||artifacts.attachments.length>3)throw Error('Anexos obrigatórios ausentes.');
 let bytes=0,pdf=false;
 for(const a of artifacts.attachments){
  if(!Buffer.isBuffer(a.content)||!a.content.length||! /^[a-zA-Z0-9_.-]{1,120}$/.test(a.name)||!['application/pdf','text/calendar'].includes(a.type))throw Error('Anexo inválido.');
  bytes+=a.content.length;
  if(a.type==='application/pdf'){if(a.content.subarray(0,5).toString()!=='%PDF-')throw Error('PDF inválido.');pdf=true;}
 }
 if(!pdf||bytes>6000000)throw Error('PDF obrigatório ou limite excedido.');
}
async function execute({id,store,readSource,authorize,prepare,provider,enabled=false,now=()=>new Date()}){
 if(enabled!==true)return {status:'disabled'};
 const job=await store.claim(id,now().toISOString());if(!job)return {status:'not-claimed'};
 const finish=async result=>{await store.finish(job,result,now().toISOString());return result;};
 const check=async()=>{const source=await readSource(job.source);const reason=stopReason(source);if(reason)return reason;return hash(identity(source))===job.sourceFingerprint?null:'source-changed';};
 let artifacts;
 try {
  if(typeof authorize!=='function'||await authorize(job)!==true)return finish({status:'suppressed',reason:'authorization-revoked'});
  const reason=await check();if(reason)return finish({status:'suppressed',reason});
  artifacts=await prepare(job);validateArtifacts(artifacts);
  const latest=await check();if(latest)return finish({status:'suppressed',reason:latest});
  if(await authorize(job)!==true)return finish({status:'suppressed',reason:'authorization-revoked'});
  if(now().toISOString()>=job.leaseUntil)return finish({status:'blocked',reason:'preparation-timeout'});
  if(now().toISOString()>=job.expiresAt)return finish({status:'expired'});
 }catch{return finish({status:'blocked',reason:'preparation-or-verification-failed'});}
 let result;
 try {
  const receipt=await provider.send({...artifacts,idempotencyKey:job.id,from:job.sender,replyTo:job.replyTo,to:job.recipient.email});
  // Provider acceptance is NOT a delivery receipt. Ambiguous outcomes never auto-retry.
  const messageId=typeof receipt?.messageId==='string'&&receipt.messageId.length>0&&receipt.messageId.length<=500?receipt.messageId:null;
  const correlation=receipt?.provider==='microsoft-graph'&&receipt.correlationId===job.id;
  result=receipt?.accepted===true&&(messageId||correlation)
   ?{status:'accepted',...(messageId?{messageId}:{provider:'microsoft-graph',correlationId:job.id})}
   :{status:'unknown',reason:'provider-result-unconfirmed'};
 }catch{result={status:'unknown',reason:'provider-result-unconfirmed'};}
 // Persistence failure propagates, leaving the claimed job unavailable to another sender.
 return finish(result);
}
module.exports={SENDER,plan,createStore,execute,validateArtifacts,stopReason};
