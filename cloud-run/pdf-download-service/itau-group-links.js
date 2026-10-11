// Explicit many-payments-to-one-debit reconciliation. Never changes financial sources.
const {randomUUID}=require('node:crypto');
const {ACCOUNT}=require('./itau-ofx');
const {isoDate}=require('./itau-legacy-payments');
const {admin,hash,refs,paymentKey,identifier,text,fail,nativePayment,auditRef}=require('./itau-legacy-links');
const readerFor=db=>({get:ref=>ref.get(),getAll:(...items)=>db.getAll(...items)});
function members(value){
 if(!Array.isArray(value)||value.length<2||value.length>25)fail('Selecione de 2 a 25 baixas individuais.',400);
 const result=value.map(v=>({transactionId:identifier(v?.transactionId),paymentRequestId:identifier(v?.paymentRequestId)}));
 const keys=result.map(v=>JSON.stringify([v.transactionId,v.paymentRequestId]));
 if(new Set(keys).size!==keys.length)fail('A mesma baixa não pode aparecer duas vezes.',400);
 return result.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
async function evidence(db,reader,statementId,selection){
 const selected=members(selection),ref=refs(db,statementId);
 const [bank,...transactions]=await reader.getAll(ref.statement,...selected.map(v=>db.collection('transactions').doc(v.transactionId)));
 const statement=bank.data();
 if(!statement||statement.accountId&&statement.accountId!==ACCOUNT||!isoDate(statement.date)||!Number.isSafeInteger(statement.amountCents)||statement.amountCents>=0||!statement.fitid)fail('Selecione um débito válido da conta Itaú.');
 const audits=await reader.getAll(...selected.map((v,i)=>auditRef(db,transactions[i].data(),v.paymentRequestId)));
 const payments=selected.map((v,i)=>nativePayment(transactions[i].data(),v.transactionId,v.paymentRequestId,audits[i].data()));
 if(payments.some(p=>Math.abs(Date.parse(p.date)-Date.parse(statement.date))/86400000>3))fail('Cada baixa deve estar a até três dias da movimentação bancária.');
 const totalCents=payments.reduce((sum,p)=>sum+p.amountCents,0);
 if(!Number.isSafeInteger(totalCents)||totalCents!==-statement.amountCents)fail('A soma das baixas deve ser exatamente igual ao débito. Não distribua diferenças por suposição.');
 return {members:selected,payments,totalCents,statement:{id:statementId,date:statement.date,amountCents:statement.amountCents,fitid:statement.fitid,name:String(statement.name||statement.memo||'').slice(0,500)},fingerprint:hash({statement,selected,transactions:transactions.map(s=>s.data()),audits:audits.map(s=>s.data())})};
}
async function preview(db,uid,input){
 const statementId=identifier(input.statementId),selected=members(input.members),ref=refs(db,statementId);
 if(!admin((await db.collection('users').doc(uid).get()).data()))fail('Somente administrador ativo pode confirmar grupos.',403);
 const result=await evidence(db,readerFor(db),statementId,selected);
 const [current,profile,...locks]=await db.getAll(ref.link,db.collection('users').doc(uid),...selected.map(v=>db.collection('bankLegacyPaymentLocks').doc(paymentKey(v.transactionId,v.paymentRequestId))));
 if(!admin(profile.data()))fail('Acesso revogado.',403);
 if(current.data()?.active)fail('Este débito já possui vínculo ativo.');
 if(locks.some(l=>l.data()?.active))fail('Uma das baixas já está vinculada. Confira o histórico.');
 return {...result,revision:current.data()?.revision||0};
}
async function mutate(db,uid,action,input){
 if(!['confirm','unlink'].includes(action))fail('Operação inválida.',400);
 const statementId=identifier(input.statementId),requestId=identifier(input.requestId);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))fail('Solicitação inválida.',400);
 const reason=text(input.reason,'Justificativa',10),reference=action==='confirm'?text(input.reference,'Referência do comprovante do lote',5):null;
 const selected=action==='confirm'?members(input.members):null;
 if(!Number.isSafeInteger(input.revision)||input.revision<0)fail('Revise o grupo antes de confirmar.',400);
 if(action==='confirm'&&(input.checkedEvidence!==true||!/^[a-f0-9]{64}$/.test(input.fingerprint||'')))fail('Confira o comprovante e todos os favorecidos do lote.',400);
 const requestHash=hash({kind:'native-group',uid,action,statementId,selected,reason,reference,revision:input.revision,fingerprint:input.fingerprint||null,checkedEvidence:input.checkedEvidence===true});
 const ref=refs(db,statementId),operationRef=db.collection('bankLegacyLinkOperations').doc(requestId);
 return db.runTransaction(async tx=>{
  const [profile,operation,current]=await tx.getAll(db.collection('users').doc(uid),operationRef,ref.link);
  if(!admin(profile.data()))fail('Somente administrador ativo pode confirmar grupos.',403);
  if(operation.exists){if(operation.data().requestHash!==requestHash)fail('Solicitação reutilizada com dados diferentes.');return {...operation.data().result,replayed:true};}
  const old=current.data();
  if((old?.revision||0)!==input.revision)fail('O vínculo mudou. Atualize a consulta.');
  if((old?.history?.length||0)>=100)fail('Histórico requer revisão administrativa.');
  if(action==='confirm'&&old?.active)fail('Este débito já possui vínculo ativo.');
  if(action==='unlink'&&(!old?.active||old.kind!=='native-group'))fail('Não existe grupo ativo para desfazer.');
  const selection=selected||members(old.members);
  const lockRefs=selection.map(v=>db.collection('bankLegacyPaymentLocks').doc(paymentKey(v.transactionId,v.paymentRequestId)));
  const locks=await tx.getAll(...lockRefs);
  if(action==='confirm'&&locks.some(l=>l.data()?.active))fail('Uma das baixas já está vinculada a um débito.');
  if(action==='unlink'&&locks.some(l=>!l.data()?.active||l.data().statementId!==statementId))fail('Controle de vínculo inconsistente. Solicite revisão.');
  const source=action==='confirm'?await evidence(db,tx,statementId,selection):null;
  if(source&&source.fingerprint!==input.fingerprint)fail('Uma fonte mudou desde a prévia. Revise novamente.');
  const at=new Date().toISOString(),actor={uid,name:String(profile.data().name||profile.data().username||uid).slice(0,300)};
  const event={kind:'native-group',action,at,actor,reason,reference,members:selection,requestId};
  const next=source?{kind:'native-group',accountId:ACCOUNT,statementId,statementDate:source.statement.date,...source,active:true,revision:input.revision+1,updatedAt:at,history:[...(old?.history||[]),event]}:{...old,active:false,revision:input.revision+1,updatedAt:at,history:[...old.history,event]};
  if(Buffer.byteLength(JSON.stringify(next))>700000)fail('Histórico do grupo excedeu o limite. Solicite revisão administrativa.');
  lockRefs.forEach((lock,i)=>tx.set(lock,{active:next.active,statementId,...selection[i],updatedAt:at}));
  const result={statementId,active:next.active,revision:next.revision};
  tx.set(ref.link,next);
  tx.create(operationRef,{requestHash,result,at,actor});
  tx.create(db.collection('bankStatementAudit').doc(randomUUID()),{...event,action:`native-group-${action}`,accountId:ACCOUNT,statementId,revision:next.revision});
  return result;
 });
}
module.exports={preview,mutate,evidence,members};
