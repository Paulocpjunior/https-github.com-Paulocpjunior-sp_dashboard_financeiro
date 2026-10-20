const {createHash}=require('node:crypto');
const {amount,money}=require('./boleto-cloud');
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const evidenceHash=v=>hash(canonical(v));
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const permits=(user,action)=>user?.active===true&&!['blocked','deleted'].includes(user.status)&&(user.role==='admin'||user.financialPermissions?.includes(`receivables.${action}`));
function routeAllowed(user,method,path){
 return method==='GET'&&/^items\/[^/]+$/.test(path)?['read','settle','reverse','amend'].some(a=>permits(user,a)):method==='POST'&&(['receipt/preview','receipt/commit'].includes(path)?permits(user,'settle'):['reversal/preview','reversal/commit'].includes(path)?permits(user,'reverse'):['due-date/preview','due-date/commit'].includes(path)&&permits(user,'amend'));
}
function receivable(row){
 if(!row||row.isExcluded||row.deletedAt||norm(row.movement)!=='entrada'||/saida|pagar/.test(norm(row.type)))fail('Conta a receber indisponível.');
 if(row.wixEntityId||row.wixInvoiceNumber||norm(row.source)==='wix'||String(row.id||'').startsWith('wix-inv-'))fail('Fatura Wix: registre e confira o recebimento na integração Wix.');
 if(!Number.isSafeInteger(Math.round(amount(row)*100))||amount(row)<=0)fail('Valor original inválido.');
 return row;
}
function balance(row){
 receivable(row);
 const nominalCents=Math.round(amount(row)*100), b=row.receivableBalance;
 if(b){
  if(b.version!==1||![b.receivedCents,b.interestCents,b.discountCents,b.remainingCents].every(v=>Number.isSafeInteger(v)&&v>=0)||nominalCents+b.interestCents-b.discountCents-b.receivedCents!==b.remainingCents||!row.receivableSettlement||Math.round(money(row.valueReceived)*100)!==b.receivedCents||row.paymentDate!==row.receivableSettlement.date)fail('Saldo de recebimento inconsistente. Confira o histórico.');
  return b;
 }
 return {version:1,receivedCents:0,interestCents:0,discountCents:0,remainingCents:nominalCents};
}
function blocked(row){
 if(row.boletoSettlement) return 'Recebimento bancário já registrado. Confira o retorno do boleto.';
 if(!['pendente','agendado','vencida','vencido'].includes(norm(row.status)))return 'Conta já quitada ou com situação que exige conferência.';
 if(row.receivableBalance){if(balance(row).remainingCents<=0)return 'Conta já quitada.';}
 else if(row.receivableSettlement||row.paymentDate||row.dataPagamento||['pago','sim','s','true','recebido'].includes(norm(row.pago))||['valueReceived','valorPago','valuePaid'].some(k=>money(row[k])!==0))return 'Conta com informação anterior de recebimento. Confira antes de baixar.';
 return null;
}
function receiptPatch(row,input,catalog){
 receivable(row);const reason=blocked(row);if(reason)fail(reason);
 const p=input||{}, today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date||p.date>today||row.receivableSettlement?.date>p.date)fail('Data de recebimento inválida, futura ou anterior à última baixa.',400);
 const cents=(v,label)=>{if(typeof v!=='string'||!/^\d{1,10}(\.\d{1,2})?$/.test(v))fail(`${label} inválido.`,400);const n=Math.round(Number(v)*100);if(!Number.isSafeInteger(n))fail(`${label} inválido.`,400);return n;};
 // Legacy balance interestCents represents all charges; fineCents itemizes the fine in the receipt.
 const received=cents(p.amount,'Valor recebido'), interest=cents(p.interest,'Juros')+cents(p.fine??'0','Multa'), discount=cents(p.discount,'Desconto');
 if(received<=0)fail('Informe um valor efetivamente recebido maior que zero.',400);
 if(!catalog.banks.includes(p.bankAccount)||!catalog.receiptMethods.includes(p.method))fail('Selecione conta bancária e forma de recebimento válidas.',400);
 if(typeof p.note!=='string'||p.note.trim().length<5||p.note.length>1000)fail('Informe uma observação ou referência do comprovante (5 a 1000 caracteres).',400);
 const b=balance(row), remaining=b.remainingCents+interest-discount-received;
 if(remaining<0)fail('Recebimento e desconto ultrapassam o saldo disponível.');
 const next={version:1,receivedCents:b.receivedCents+received,interestCents:b.interestCents+interest,discountCents:b.discountCents+discount,remainingCents:remaining};
 return {status:remaining===0?'Pago':'Pendente',pago:remaining===0?'Pago':'Não',valueReceived:next.receivedCents/100,valorPago:(next.receivedCents/100).toFixed(2),paymentDate:p.date,dataPagamento:p.date.split('-').reverse().join('/'),receivableBalance:next};
}
// Due date only moves while the account is open, without receipts and without a bank title carrying the old date.
function dueDateChange(row,input){
 receivable(row);const reason=blocked(row);if(reason)fail(reason);
 if(row.receivableSettlement||row.receivableReceipts?.length)fail('Conta com recebimento registrado. Estorne a baixa antes de corrigir o vencimento.');
 const p=input||{}, valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 if(!valid(p.dueDate)||p.dueDate<'2000-01-01'||p.dueDate>'2099-12-31')fail('Informe um vencimento válido.',400);
 if(p.dueDate===row.dueDate)fail('O novo vencimento é igual ao atual.',400);
 if(valid(row.date)&&p.dueDate<row.date)fail('O vencimento não pode ser anterior à data de lançamento.',400);
 if(typeof p.reason!=='string'||p.reason.trim().length<10||p.reason.length>2000)fail('Informe o motivo da correção (10 a 2000 caracteres).',400);
 return {...row,dueDate:p.dueDate};
}
async function dueDateConflicts(tx,db,id,row,dueDate){
 const issued=await tx.get(db.collection('boletoIssues').where('transactionId','==',id).limit(10));
 if(issued.docs.some(d=>!['draft','rejected'].includes(d.data().state)))fail('Boleto emitido para esta conta: o título no banco mantém o vencimento original. Trate a emissão no Boleto Cloud antes de corrigir o vencimento.');
 for(const c of ['boletoReconciliations','boletoManualResolutions'])if((await tx.get(db.collection(c).where('transactionId','==',id).limit(1))).docs.length)fail('Conta vinculada a boleto. Trate o vínculo antes de corrigir o vencimento.');
 const peers=await tx.get(db.collection('transactions').where('dueDate','==',dueDate).limit(1001));
 if(peers.docs.length>1000)fail('Volume exige conferência manual de duplicidade.');
 const doc=v=>String(v||'').replace(/\D/g,''), cents=r=>{try{return Math.round(amount(r)*100);}catch{return null;}};
 if(peers.docs.some(d=>{const r=d.data();return d.id!==id&&!r.isExcluded&&norm(r.movement)==='entrada'&&doc(r.cpfCnpj)&&doc(r.cpfCnpj)===doc(row.cpfCnpj)&&cents(r)===cents(row);}))fail('Já existe conta com o mesmo CPF/CNPJ, valor e esse vencimento. Confira a possível duplicidade antes de corrigir.');
}
// Only restore fields owned by the last manual receipt; never erase history.
function reversal(row,event,reason){
 receivable(row);
 if(row.boletoSettlement)fail('Recebimento bancário: confira o retorno do boleto.');
 if(typeof reason!=='string'||reason.trim().length<10||reason.length>2000)fail('Informe o motivo do estorno (10 a 2000 caracteres).',400);
 const last=row.receivableSettlement;
 if(!last?.requestId||last.origin!=='manual'||event?.action!=='receipt'||!event.before||evidenceHash(event.after?.receivableSettlement||null)!==evidenceHash(last)||(row.receivableReversals||[]).some(x=>x.receiptRequestId===last.requestId))fail('Baixa sem histórico íntegro ou já estornada. Solicite revisão.');
 if(amount(row)!==amount(event.after)||amount(row)!==amount(event.before))fail('Valor original alterado após a baixa. Solicite revisão.');
 const fields=['status','pago','valueReceived','valorPago','paymentDate','dataPagamento','receivableBalance','receivableSettlement'];
 for(const k of fields)if(evidenceHash(row[k]??null)!==evidenceHash(event.after[k]??null))fail('Conta alterada após a baixa. Solicite revisão.');
 const restored={...row};
 for(const k of fields){if(Object.hasOwn(event.before,k))restored[k]=event.before[k];else delete restored[k];}
 const reasonBlocked=blocked(restored);if(reasonBlocked)fail(reasonBlocked);
 return restored;
}
async function handleReceivables({request,url,db,userRef,user,uid,reply,readBody,enabled,allowed,catalog,catalogRef,catalogState}){
 if(!enabled)fail('Lançamentos nativos não ativados.',503);
 const path=url.pathname.replace('/api/financial-entries/receivables/','');
 const recheck=async tx=>{const profile=(await(tx?tx.get(userRef):userRef.get())).data();if(!allowed(profile))fail('Acesso revogado.',403);if((profile.name||uid)!==(user.name||uid))fail('Usuário alterado. Reabra a revisão.');if(tx&&((await tx.get(catalogRef)).data()?.revision||0)!==catalogState.revision)fail('Parâmetros alterados. Reabra a revisão.');};
 if(request.method==='GET'){
  const id=decodeURIComponent(path.slice(6));if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id))fail('Identificador inválido.',400);
  const row=receivable((await db.collection('transactions').doc(id).get()).data());await recheck();
  reply({transaction:{...row,id},version:hash(row),catalog:{banks:catalog.banks,receiptMethods:catalog.receiptMethods},canSettle:permits(user,'settle'),canReverse:permits(user,'reverse'),canAmend:permits(user,'amend'),blockedReason:blocked(row)});return;
 }
 let b;try{b=JSON.parse((await readBody(request)).toString('utf8'));}catch{fail('Dados inválidos.',400);}
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(b.id||'')||! /^[a-f0-9-]{36}$/.test(b.requestId||''))fail('Identificador inválido.',400);
 const ref=db.collection('transactions').doc(b.id), key=hash([uid,b.requestId]), op=db.collection('receivableOperations').doc(key), digest=hash([path,b]);
 let historical=null;
 if(b.retReview && /^[a-f0-9]{64}$/.test(b.retReview.eventId||'')){
  const e=(await db.collection('boletoReturnEvents').doc(b.retReview.eventId).get()).data();
  if(e?.boletoId){
   const update=(await db.collection('boletoHistoryUpdates').doc(e.boletoId).get()).data();
   const link=(await db.collection('boletoReconciliations').doc(e.boletoId).get()).data();
   if(!update?.record && !link?.record) historical=await require('./boleto-history').createHistoryReader().load(db);
  }
 }
 const result=await db.runTransaction(async tx=>{
  await recheck(tx);
  const prior=(await tx.get(op)).data();
  if(prior){if(prior.digest!==digest)fail('Tentativa já utilizada com outros dados.');return {...prior.result,replayed:true};}
  const current=(await tx.get(ref)).data();if(!current)fail('Conta não encontrada.',404);
  if(hash(current)!==b.version)fail('Conta alterada. Reabra e confira o saldo atual.');
  if(path.startsWith('due-date/')){
   const record=dueDateChange(current,b.amendment);
   await dueDateConflicts(tx,db,b.id,current,record.dueDate);
   const reviewHash=hash([uid,user.name||uid,b.id,b.version,b.amendment]);
   if(path==='due-date/preview')return {reviewHash,before:{...current,id:b.id},after:{...record,id:b.id}};
   if(b.confirmHash!==reviewHash)fail('Revise a correção antes de confirmar.');
   const at=new Date().toISOString(),entry={requestId:b.requestId,before:current.dueDate||'',after:record.dueDate,reason:b.amendment.reason.trim(),uid,actor:user.name||uid,at};
   record.dueDateAmendments=[...(current.dueDateAmendments||[]),entry];if(record.dueDateAmendments.length>50)fail('Limite de correções atingido. Solicite revisão.');
   record.updatedAt=at;
   const result={transaction:{...record,id:b.id}};
   tx.set(ref,record);tx.create(db.collection('receivableAudit').doc(key),{action:'due-date-amendment',transactionId:b.id,uid,at,before:current,after:record,amendment:entry});tx.create(op,{digest,result,at});return result;
  }
  if(path.startsWith('reversal/')){
   const last=current.receivableSettlement;
   if(!last?.uid||!last.requestId)fail('Baixa legada sem histórico de estorno. Solicite revisão.');
   const event=(await tx.get(db.collection('receivableAudit').doc(hash([last.uid,last.requestId])))).data();
   if(event?.transactionId!==b.id)fail('Histórico da baixa não corresponde à conta.');
   const retRef=last.retEvidence?.eventId?db.collection('boletoReturnEvents').doc(last.retEvidence.eventId):null;
   const retEvent=retRef?(await tx.get(retRef)).data():null;
   const record=reversal(current,event,b.reason);
   const reviewHash=hash([uid,user.name||uid,b.id,b.version,b.reason,last.requestId]);
   if(path==='reversal/preview')return {reviewHash,before:current,after:record};
   if(b.confirmHash!==reviewHash)fail('Revise o estorno antes de confirmar.');
   const at=new Date().toISOString(),entry={requestId:b.requestId,receiptRequestId:last.requestId,amountCents:last.amountCents,reason:b.reason.trim(),uid,actor:user.name||uid,at};
   record.receivableReversals=[...(current.receivableReversals||[]),entry];record.updatedAt=at;
   const result={transaction:{...record,id:b.id}};
   if(retEvent)tx.set(retRef,{...retEvent,state:'review',manualResolution:null,reason:'Recebimento manual estornado. Conferência obrigatória novamente.'});
   tx.set(ref,record);tx.create(db.collection('receivableAudit').doc(key),{action:'receipt-reversal',transactionId:b.id,uid,at,before:current,after:record,reversal:entry});tx.create(op,{digest,result,at});return result;
  }
  let retRef=null, retEvent=null, manualRef=null;
  if(b.retReview){
   if(!/^[a-f0-9]{64}$/.test(b.retReview.eventId||''))fail('Ocorrência RET inválida.',400);
   retRef=db.collection('boletoReturnEvents').doc(b.retReview.eventId);
   retEvent=(await tx.get(retRef)).data();
   if(retEvent?.state!=='review'||require('./boleto-ret-review').evidenceVersion(retEvent)!==b.retReview.evidenceVersion)fail('Retorno alterado ou já conferido. Atualize as pendências.');
   const link=(await tx.get(db.collection('boletoReconciliations').doc(retEvent.boletoId))).data();
   if(historical && (await tx.get(db.collection('boletoHistory').doc('production'))).data()?.snapshot!==historical.snapshot)fail('Histórico alterado. Atualize as pendências.');
   const history=(await tx.get(db.collection('boletoHistoryUpdates').doc(retEvent.boletoId))).data()?.record || link?.record || historical?.rows.find(r=>r.id===retEvent.boletoId);
   if(link?.transactionId && link.transactionId!==b.id)fail('Boleto vinculado a outra conta. Revise o vínculo antes da baixa.');
   if(history?.transactionId && history.transactionId!==b.id)fail('Emissão vinculada a outra conta. Revise o vínculo antes da baixa.');
   if(history?.token){const issues=await tx.get(db.collection('boletoIssues').where('token','==',history.token).limit(2));if(issues.docs.some(d=>d.data().transactionId!==b.id))fail('Emissão vinculada a outra conta. Revise o vínculo antes da baixa.');}
   manualRef=db.collection('boletoManualResolutions').doc(retEvent.boletoId);
   const manual=(await tx.get(manualRef)).data();
   if(manual?.transactionId && manual.transactionId!==b.id)fail('Boleto já tratado manualmente em outra conta.');
   const digits=v=>String(v||'').replace(/\D/g,'');
   if(!history?.payerDocument||digits(history.payerDocument)!==digits(current.cpfCnpj))fail('Confirme o CPF/CNPJ do cadastro antes de registrar esta baixa.');
   if(retEvent.manualResolution?.transactionId&&retEvent.manualResolution.transactionId!==b.id)fail('Esta ocorrência já foi aplicada a outra conta.');
   if(typeof b.receipt?.note!=='string'||b.receipt.note.trim().length<20)fail('Descreva a divergência, a forma real de recebimento e a referência do comprovante (mínimo 20 caracteres).',400);
  }
  const patch=receiptPatch(current,b.receipt,catalog);
  const reviewHash=hash([uid,user.name||uid,b.id,b.version,b.receipt,catalogState.revision,b.retReview||null]);
  if(path==='receipt/preview')return {reviewHash,before:{...current,id:b.id},after:{...current,...patch,id:b.id}};
  if(b.confirmHash!==reviewHash)fail('Revise o recebimento antes de confirmar.');
  const at=new Date().toISOString(), p=b.receipt;
  const settlement={requestId:b.requestId,uid,actor:user.name||uid,at,origin:'manual',date:p.date,amountCents:Math.round(Number(p.amount)*100),interestCents:Math.round(Number(p.interest)*100)+Math.round(Number(p.fine||0)*100),fineCents:Math.round(Number(p.fine||0)*100),discountCents:Math.round(Number(p.discount)*100),remainingCents:patch.receivableBalance.remainingCents,bankAccount:p.bankAccount,method:p.method,note:p.note.trim(),...(retEvent?{retEvidence:{eventId:b.retReview.eventId,fileId:retEvent.fileId,boletoId:retEvent.boletoId,number:retEvent.number,evidenceVersion:b.retReview.evidenceVersion,occurrence:retEvent.occurrence,evidenceConflict:retEvent.evidenceConflict||null}}:{})};
  const receipts=[...(current.receivableReceipts||[]),settlement];if(receipts.length>100)fail('Limite de 100 recebimentos atingido. Solicite revisão.');
  const record={...current,...patch,updatedAt:at,receivableSettlement:settlement,receivableReceipts:receipts};
  const result={transaction:{...record,id:b.id}};
  tx.set(ref,record);
  if(manualRef)tx.set(manualRef,{transactionId:b.id,eventId:b.retReview.eventId,requestId:b.requestId,at,uid});
  if(retRef)tx.set(retRef,{...retEvent,state:patch.receivableBalance.remainingCents===0?'manual-resolved':'review',manualResolution:{transactionId:b.id,requestId:b.requestId,uid,actor:user.name||uid,at,method:p.method,note:p.note.trim(),amountCents:settlement.amountCents,remainingCents:patch.receivableBalance.remainingCents,evidenceVersion:b.retReview.evidenceVersion}});
  tx.create(db.collection('receivableAudit').doc(key),{action:'receipt',transactionId:b.id,uid,at,before:current,after:record});
  tx.create(op,{digest,result,at});return result;
 });reply(result);
}
module.exports={handleReceivables,routeAllowed,receiptPatch,balance,blocked,reversal,dueDateChange};
