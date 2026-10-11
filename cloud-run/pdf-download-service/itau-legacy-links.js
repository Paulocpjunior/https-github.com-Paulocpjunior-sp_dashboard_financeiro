// Reconciliation metadata only: never writes transactions or bank entries.
const {createHash}=require('node:crypto');
const {ACCOUNT,StatementError}=require('./itau-ofx');
const {projectLegacy,isoDate}=require('./itau-legacy-payments');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const key=id=>hash([ACCOUNT,id]);
const admin=p=>p?.active===true && !['blocked','deleted'].includes(p.status) && p.role==='admin';
function fail(message,status=409){throw new StatementError(message,status);}
function identifier(value){if(typeof value!=='string'||!value||value.length>200||/[\/\x00-\x1f]/.test(value))fail('Identificador inválido.',400);return value;}
function text(value,label,min){if(typeof value!=='string'||value.trim().length<min||value.length>1000)fail(`${label}: informe de ${min} a 1.000 caracteres.`,400);return value.trim();}
const refs=(db,id)=>({statement:db.collection('bankStatements').doc(ACCOUNT).collection('entries').doc(id),link:db.collection('bankLegacyLinks').doc(key(id))});
function evidence(statement,transaction,statementId,transactionId){
 if(!statement||!transaction)fail('Movimentação ou lançamento indisponível. Atualize a consulta.');
 if(statement.accountId && statement.accountId!==ACCOUNT)fail('Movimentação de outra conta bancária.');
 if(!isoDate(statement.date)||!Number.isSafeInteger(statement.amountCents)||statement.amountCents>=0||!statement.fitid)fail('Somente débitos bancários válidos podem ser vinculados.');
 const payment=projectLegacy([{...transaction,id:transactionId}],'0001-01-01','9999-12-31').rows[0];
 if(!payment||payment.amountCents!==-statement.amountCents||Math.abs(Date.parse(payment.date)-Date.parse(statement.date))/86400000>3)fail('O pagamento deixou de atender aos critérios de revisão. Atualize a consulta.');
 return {statement:{id:statementId,date:statement.date,amountCents:statement.amountCents,fitid:statement.fitid,name:String(statement.name||statement.memo||'').slice(0,500)},payment,fingerprint:hash({statement,transaction})};
}
// Shared statement records prevent one debit from being linked through both flows.
// Legacy collection names are retained for backup compatibility and existing history.
function nativePayment(transaction,transactionId,paymentRequestId,event){
 const payments=transaction?.payablePayments;
 const p=Array.isArray(payments)&&payments.filter(p=>p?.requestId===paymentRequestId);
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(!transaction||transaction.isExcluded||norm(transaction.movement)!=='saida'||transaction.wixEntityId||transaction.wixInvoiceNumber||norm(transaction.source)==='wix'||!p||p.length!==1)fail('Baixa nativa indisponível ou inconsistente.');
 const payment=p[0];
 if(!Array.isArray(transaction.payableReversals||[])||(transaction.payableReversals||[]).some(r=>r.paymentRequestId===paymentRequestId))fail('Pagamento estornado. Não é possível confirmar o vínculo.');
 if(!event||event.action!=='payment'||event.transactionId!==transactionId||event.uid!==payment.uid||hash(event.after?.payableSettlement||null)!==hash(payment))fail('Baixa sem evento de auditoria íntegro.');
 if(payment.bankAccount!==require('./native-entry-catalog.json').banks[0]||!isoDate(payment.date)||!Number.isSafeInteger(payment.amountCents)||payment.amountCents<=0)fail('Confira data, valor pago e conta bancária da baixa.');
 return {id:`${transactionId}:${paymentRequestId}`,transactionId,paymentRequestId,date:payment.date,amountCents:payment.amountCents,supplier:String(payment.supplier||''),bankEvidence:'same-account'};
}
function auditRef(db,transaction,paymentRequestId){
 const p=Array.isArray(transaction?.payablePayments)&&transaction.payablePayments.find(p=>p?.requestId===paymentRequestId);
 if(!p?.uid)fail('Baixa nativa sem responsável identificado.');
 const id=createHash('sha256').update(JSON.stringify([p.uid,paymentRequestId])).digest('hex');
 return db.collection('payableAudit').doc(id);
}
async function sourceEvidence(db,reader,statement,transaction,statementId,transactionId,paymentRequestId){
 if(!paymentRequestId)return evidence(statement,transaction,statementId,transactionId);
 const event=(await reader.get(auditRef(db,transaction,paymentRequestId))).data();
 const payment=nativePayment(transaction,transactionId,paymentRequestId,event);
 if(!statement||statement.accountId&&statement.accountId!==ACCOUNT||!isoDate(statement.date)||!Number.isSafeInteger(statement.amountCents)||statement.amountCents>=0||!statement.fitid||payment.amountCents!==-statement.amountCents||Math.abs(Date.parse(payment.date)-Date.parse(statement.date))/86400000>3)fail('O débito não corresponde aos critérios desta baixa.');
 return {statement:{id:statementId,date:statement.date,amountCents:statement.amountCents,fitid:statement.fitid,name:String(statement.name||statement.memo||'').slice(0,500)},payment,fingerprint:hash({statement,transaction,event})};
}
const readerFor=db=>({get:ref=>ref.get()});
const paymentKey=(transactionId,paymentRequestId)=>paymentRequestId?hash([ACCOUNT,'native',transactionId,paymentRequestId]):key(transactionId);
async function preview(db,uid,input,kind='legacy'){
 const statementId=identifier(input.statementId),transactionId=identifier(input.transactionId);
 const ref=refs(db,statementId);
 const [s,t,l,p]=await db.getAll(ref.statement,db.collection('transactions').doc(transactionId),ref.link,db.collection('users').doc(uid));
 if(!admin(p.data()))fail('Somente administrador ativo pode confirmar vínculos.',403);
 const paymentRequestId=kind==='native'?identifier(input.paymentRequestId):null;
 const result=await sourceEvidence(db,readerFor(db),s.data(),t.data(),statementId,transactionId,paymentRequestId);
 if(!admin((await db.collection('users').doc(uid).get()).data()))fail('Acesso revogado.',403);
 if(l.data()?.active)fail('Este débito já possui vínculo ativo. Consulte o histórico.');
 return {...result,revision:l.data()?.revision||0};
}
async function mutate(db,uid,action,input,kind='legacy'){
 if(!['confirm','unlink'].includes(action))fail('Operação inválida.',400);
 const statementId=identifier(input.statementId),requestId=identifier(input.requestId);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))fail('Identificador da solicitação inválido.',400);
 const reason=text(input.reason,'Justificativa',10);
 if(!Number.isSafeInteger(input.revision)||input.revision<0)fail('Revise o vínculo antes de confirmar.',400);
 const transactionId=action==='confirm'?identifier(input.transactionId):null;
 const paymentRequestId=action==='confirm'&&kind==='native'?identifier(input.paymentRequestId):null;
 const reference=action==='confirm'?text(input.reference,'Referência do comprovante',5):null;
 if(action==='confirm'&&(input.checkedEvidence!==true||!/^([a-f0-9]{64})$/.test(input.fingerprint||'')))fail('Confira favorecido, conta e comprovante antes de confirmar.',400);
 const requestHash=hash({uid,action,statementId,transactionId,reason,reference,...(kind==='native'?{kind,paymentRequestId}:{}),revision:input.revision,fingerprint:input.fingerprint||null,checkedEvidence:input.checkedEvidence===true});
 const ref=refs(db,statementId),op=db.collection('bankLegacyLinkOperations').doc(requestId);
 return db.runTransaction(async tx=>{
  const [p,operation,current]=await tx.getAll(db.collection('users').doc(uid),op,ref.link);
  if(!admin(p.data()))fail('Somente administrador ativo pode confirmar vínculos.',403);
  if(operation.exists){if(operation.data().requestHash!==requestHash)fail('Solicitação reutilizada com dados diferentes.');return {...operation.data().result,replayed:true};}
  const old=current.data();
  if(action==='unlink'&&(old?.kind||'legacy')!==kind)fail('Tipo de vínculo divergente. Atualize a consulta.');
  if((old?.revision||0)!==input.revision)fail('O vínculo mudou durante a revisão. Atualize a consulta.');
  if((old?.history?.length||0)>=100)fail('Histórico de vínculo requer revisão administrativa.');
  const at=new Date().toISOString(),actor={uid,name:String(p.data().name||p.data().username||uid).slice(0,300)};
  let next,lock;
  if(action==='confirm'){
   if(old?.active)fail('Este débito já possui vínculo ativo.');
   lock=db.collection('bankLegacyPaymentLocks').doc(paymentKey(transactionId,paymentRequestId));
   const [s,t,occupied]=await tx.getAll(ref.statement,db.collection('transactions').doc(transactionId),lock);
   if(occupied.data()?.active)fail('Este pagamento já está vinculado a outro débito. Revise o vínculo existente.');
   const source=await sourceEvidence(db,tx,s.data(),t.data(),statementId,transactionId,paymentRequestId);
   if(source.fingerprint!==input.fingerprint)fail('Os dados mudaram desde a prévia. Revise novamente.');
   const event={kind,action,at,actor,reason,reference,transactionId,requestId,...(paymentRequestId?{paymentRequestId}: {})};
   next={kind,...(paymentRequestId?{paymentRequestId}:{}),accountId:ACCOUNT,statementId,statementDate:source.statement.date,transactionId,statement:source.statement,payment:source.payment,fingerprint:source.fingerprint,active:true,revision:input.revision+1,updatedAt:at,history:[...(old?.history||[]),event]};
   tx.set(lock,{active:true,statementId,transactionId,updatedAt:at});
  }else{
   if(!old?.active)fail('Não existe vínculo ativo para desfazer.');
   lock=db.collection('bankLegacyPaymentLocks').doc(paymentKey(old.transactionId,old.paymentRequestId));
   const occupied=await tx.get(lock);
   if(!occupied.data()?.active||occupied.data().statementId!==statementId)fail('Controle de vínculo inconsistente. Solicite revisão.');
   next={...old,active:false,revision:input.revision+1,updatedAt:at,history:[...old.history,{kind,action,at,actor,reason,transactionId:old.transactionId,requestId,...(old.paymentRequestId?{paymentRequestId:old.paymentRequestId}:{})}]};
   tx.set(lock,{active:false,statementId,transactionId:old.transactionId,updatedAt:at});
  }
  const result={statementId,revision:next.revision,active:next.active};
  tx.set(ref.link,next);
  tx.create(op,{requestHash,result,at,actor});
  tx.create(db.collection('bankStatementAudit').doc(),{action:`${kind}-link-${action}`,accountId:ACCOUNT,statementId,transactionId:next.transactionId,...(next.paymentRequestId?{paymentRequestId:next.paymentRequestId}:{}),at,actor,reason,reference,revision:next.revision,requestId});
  return result;
 });
}
async function list(db,start,end){
 const page=await db.collection('bankLegacyLinks').where('statementDate','>=',start).where('statementDate','<=',end).limit(1001).get();
 if(page.size>1000)fail('Mais de 1.000 vínculos. Reduza o período.');
 const records=page.docs.map(d=>d.data()).filter(r=>r.accountId===ACCOUNT);
 const active=records.filter(r=>r.active), states=new Map();
 for(let i=0;i<active.length;i+=50){
  const batch=active.slice(i,i+50),snapshots=await db.getAll(...batch.flatMap(r=>[refs(db,r.statementId).statement,db.collection('transactions').doc(r.transactionId)]));
  await Promise.all(batch.map(async(r,j)=>{const s=snapshots[j*2],t=snapshots[j*2+1];
   if(!s.exists||!t.exists){states.set(r.statementId,'missing');return;}
   let fingerprint;
   if(r.kind==='native'){
    try{fingerprint=(await sourceEvidence(db,readerFor(db),s.data(),t.data(),r.statementId,r.transactionId,r.paymentRequestId)).fingerprint;}
    catch(error){if(error.status!==409)throw error;states.set(r.statementId,'changed');return;}
   }else fingerprint=hash({statement:s.data(),transaction:t.data()});
   states.set(r.statementId,fingerprint===r.fingerprint?'current':'changed');
  }));
 }
 return records.map(r=>({...r,validation:r.active?states.get(r.statementId):'inactive'}));
}
module.exports={preview,mutate,list,evidence,admin};
