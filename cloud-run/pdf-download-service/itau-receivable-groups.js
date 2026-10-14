// Bank composition metadata only. Individual settlements remain in their audited source.
const { randomUUID } = require('node:crypto');
const { ACCOUNT } = require('./itau-ofx');
const { hash, identifier, text, fail } = require('./itau-legacy-links');
const { isoDate } = require('./itau-legacy-payments');
const { money, amount } = require('./boleto-cloud');
const bankAccount = require('./native-entry-catalog.json').banks[0];
const canRead = p => p?.active === true && !['blocked','deleted'].includes(p.status) && (p.role === 'admin' || ['itau.openfinance.read','billing.boleto-cloud.history.read','receivables.read'].every(k => p.financialPermissions?.includes(k)));
const canWrite = p => canRead(p) && (p.role === 'admin' || p.financialPermissions?.includes('receivables.settle'));
const readerFor = db => ({get: ref => ref.get(), getAll: (...refs) => db.getAll(...refs)});
const refs = (db,id) => ({bank:db.collection('bankStatements').doc(ACCOUNT).collection('entries').doc(id), link:db.collection('bankReceivableGroups').doc(hash([ACCOUNT,id]))});
function selection(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200) fail('Selecione de 1 a 200 boletos individuais.',400);
  const result=value.map(v=>({boletoId:identifier(v?.boletoId),transactionId:identifier(v?.transactionId)})).sort((a,b)=>a.boletoId.localeCompare(b.boletoId));
  if(new Set(result.map(v=>v.boletoId)).size!==result.length || new Set(result.map(v=>v.transactionId)).size!==result.length) fail('Boleto ou lançamento repetido na composição.',400);
  return result;
}
function bankValid(s) {
  if (!s || s.accountId !== ACCOUNT || !isoDate(s.date) || !Number.isSafeInteger(s.amountCents) || s.amountCents <= 0 || !s.fitid || !/BOLETOS? RECEBIDOS?/i.test(`${s.name||''} ${s.memo||''}`)) fail('Selecione um crédito agrupado de boletos da conta Itaú.');
}
function validateMember(s,member,row,update,event) {
  const r=update?.record, b=row?.boletoSettlement;
  if(!r || !b) fail('Boleto sem baixa bancária individual auditada. Confira o retorno e o vínculo em Boletos Boleto Cloud.');
  if(row.isExcluded || row.deletedAt || row.movement!=='Entrada' || row.wixEntityId || row.wixInvoiceNumber || row.source==='wix' || row.receivableSettlement || row.receivableBalance) fail('Lançamento excluído, externo ou com baixa manual: revisão individual necessária.');
  if(row.status!=='Pago' || row.bankAccount!==bankAccount || b.origin!=='BANCO' || b.boletoId!==member.boletoId || r.bank!=='341' || r.paymentOrigin!=='BANCO' || r.manuallyPaid!==false || r.cancelledAt) fail('Retorno bancário ou situação da baixa inconsistente.');
  if(!isoDate(r.paidAt) || r.creditedAt!==s.date || b.creditedAt!==s.date || r.paidAt>s.date || b.paymentDate!==r.paidAt || row.paymentDate!==r.paidAt) fail('Data de crédito ou de pagamento sem confirmação correspondente.');
  if(!Number.isSafeInteger(r.paidCents) || r.paidCents<=0 || r.paidCents!==b.paidCents || r.paidCents!==r.amountCents || Math.round(amount(row)*100)!==r.amountCents || Math.round(money(row.valueReceived)*100)!==r.paidCents) fail('Valor recebido divergente. Juros, descontos ou tarifas exigem detalhamento individual.');
  if(String(row.cpfCnpj||'').replace(/\D/g,'')!==r.payerDocument || !/^\d{11}(\d{3})?$/.test(r.payerDocument||'') || row.dueDate!==r.dueDate) fail('Cliente ou vencimento divergente do boleto.');
  if(!event || event.transactionId!==member.transactionId || hash(event.after?.boletoSettlement||null)!==hash(b) || (b.kind==='confirmed-historical-link' ? event.boletoId!==member.boletoId : event.action!=='bank-return-settlement')) fail('Auditoria da baixa individual indisponível ou divergente.');
  return {...member,name:r.payerName,number:r.number,payerDocument:r.payerDocument,paidAt:r.paidAt,creditedAt:r.creditedAt,amountCents:r.paidCents,beneficiaryDocument:r.beneficiaryDocument};
}
async function memberSource(db,reader,s,member) {
  const [t,u]=await reader.getAll(db.collection('transactions').doc(member.transactionId),db.collection('boletoHistoryUpdates').doc(member.boletoId));
  const row=t.data(),update=u.data(),b=row?.boletoSettlement;
  const audit=b?.kind==='confirmed-historical-link' ? db.collection('boletoReconciliationSettlements').doc(member.boletoId) : b?.evidenceId ? db.collection('boletoSettlementAudit').doc(identifier(b.evidenceId)) : null;
  const event=audit ? (await reader.get(audit)).data() : null;
  return {payment:validateMember(s,member,row,update,event),fingerprint:hash({row,update,event})};
}
async function evidence(db,reader,statementId,members) {
  const s=(await reader.get(refs(db,statementId).bank)).data(); bankValid(s);
  const sources=await Promise.all(members.map(m=>memberSource(db,reader,s,m)));
  const payments=sources.map(v=>v.payment),totalCents=payments.reduce((n,p)=>n+p.amountCents,0);
  if(new Set(payments.map(p=>p.beneficiaryDocument)).size!==1 || !/^\d{14}$/.test(payments[0].beneficiaryDocument||'')) fail('Beneficiários diferentes ou não identificados no grupo.');
  if(!Number.isSafeInteger(totalCents) || totalCents!==s.amountCents) fail('A soma dos boletos não fecha com o crédito. Obtenha o detalhamento do lote; nenhuma diferença será distribuída.');
  return {statement:{id:statementId,date:s.date,amountCents:s.amountCents,fitid:s.fitid},members,payments,totalCents,fingerprint:hash({s,sources})};
}
const lockRefs=(db,members)=>members.flatMap(m=>[db.collection('bankReceivableClaims').doc(hash(['boleto',m.boletoId])),db.collection('bankReceivableClaims').doc(hash(['transaction',m.transactionId]))]);
async function list(db,uid,statementId) {
  statementId=identifier(statementId);
  const profile=()=>db.collection('users').doc(uid).get();
  if(!canRead((await profile()).data())) fail('Sem permissão para consultar a composição.',403);
  const ref=refs(db,statementId),s=(await ref.bank.get()).data();bankValid(s);
  const existing=(await ref.link.get()).data();
  const {rows}=await require('./boleto-history').createHistoryReader().load(db);
  const candidates=rows.filter(r=>r.creditedAt===s.date && r.bank==='341' && r.paidAt);
  if(candidates.length>500) fail('Mais de 500 boletos nesta data. Solicite conferência do lote.');
  const payments=[];
  // Bounded batches avoid a burst of thousands of simultaneous database requests.
  for(let offset=0;offset<candidates.length;offset+=20) {
    const batch=await Promise.all(candidates.slice(offset,offset+20).map(async r=>{
      const link=(await db.collection('boletoReconciliations').doc(r.id).get()).data();
      const transactionId=r.transactionId || link?.transactionId;
      const item={boletoId:r.id,transactionId:transactionId||null,name:r.payerName,number:r.number,payerDocument:r.payerDocument,amountCents:r.paidCents,paidAt:r.paidAt,creditedAt:r.creditedAt,eligible:false,reason:'Sem vínculo individual confirmado. Confira em Boletos Boleto Cloud.'};
      if(!transactionId)return item;
      try {
        await memberSource(db,readerFor(db),s,{boletoId:r.id,transactionId});
        const locks=await db.getAll(...lockRefs(db,[{boletoId:r.id,transactionId}]));
        if(locks.some(l=>l.data()?.active)) return {...item,reason:'Já vinculado a um crédito bancário. Confira a composição registrada.'};
        return {...item,eligible:true,reason:'Baixa bancária individual confirmada; confira participação neste lote.'};
      }catch(e){if(e.status!==409)throw e;return {...item,reason:e.message};}
    }));
    payments.push(...batch);
  }
  if(!canRead((await profile()).data()))fail('Acesso revogado.',403);
  let validation=null;
  if(existing?.active) {try { const current=await evidence(db,readerFor(db),statementId,existing.members);validation=current.fingerprint===existing.fingerprint?'current':'changed';}catch{validation='changed';}}
  return {payments,link:existing?{...existing,validation}:null,canConfirm:canWrite((await profile()).data())};
}
async function preview(db,uid,input) {
  const id=identifier(input.statementId),members=selection(input.members);
  if(!canWrite((await db.collection('users').doc(uid).get()).data()))fail('Sem permissão para conciliar recebimentos.',403);
  const result=await evidence(db,readerFor(db),id,members);
  const [p,l,...locks]=await db.getAll(db.collection('users').doc(uid),refs(db,id).link,...lockRefs(db,members));
  if(!canWrite(p.data()))fail('Acesso revogado.',403);
  if(l.data()?.active || locks.some(s=>s.data()?.active))fail('Crédito ou boleto já conciliado. Atualize a consulta.');
  return {...result,revision:l.data()?.revision||0};
}
async function mutate(db,uid,action,input) {
  if(!['confirm','unlink'].includes(action))fail('Operação inválida.',400);
  const id=identifier(input.statementId),requestId=identifier(input.requestId);
  if(!/^[a-f0-9-]{36}$/.test(requestId)||!Number.isSafeInteger(input.revision)||input.revision<0)fail('Revisão inválida.',400);
  const reason=text(input.reason,'Justificativa',10),reference=action==='confirm'?text(input.reference,'Referência do detalhamento bancário do lote',5):null;
  const members=action==='confirm'?selection(input.members):null;
  if(action==='confirm'&&(input.checkedEvidence!==true||!/^[a-f0-9]{64}$/.test(input.fingerprint||'')))fail('Confira o detalhamento bancário de todos os boletos do lote.',400);
  const requestHash=hash({uid,action,id,requestId,reason,reference,members,revision:input.revision,fingerprint:input.fingerprint||null});
  const ref=refs(db,id),op=db.collection('bankReceivableGroupOperations').doc(requestId);
  return db.runTransaction(async tx=>{
    const [p,o,l]=await tx.getAll(db.collection('users').doc(uid),op,ref.link);
    if(!canWrite(p.data()))fail('Acesso revogado.',403);
    if(o.exists){if(o.data().requestHash!==requestHash)fail('Solicitação reutilizada com outros dados.');return o.data().result;}
    const old=l.data();
    if((old?.revision||0)!==input.revision)fail('Composição alterada. Atualize a consulta.');
    if(action==='confirm'&&old?.active || action==='unlink'&&!old?.active)fail('Estado da composição alterado. Atualize a consulta.');
    const selected=members||selection(old.members),claims=lockRefs(db,selected),locks=await tx.getAll(...claims);
    if(action==='confirm'&&locks.some(s=>s.data()?.active))fail('Uma baixa já está conciliada em outro crédito.');
    if(action==='unlink'&&locks.some(s=>!s.data()?.active||s.data().statementId!==id))fail('Controle de composição inconsistente. Solicite revisão.');
    const source=action==='confirm'?await evidence(db,tx,id,selected):null;
    if(source&&source.fingerprint!==input.fingerprint)fail('Dados alterados desde a revisão. Confira novamente.');
    const at=new Date().toISOString(),revision=input.revision+1;
    const result={statementId:id,active:action==='confirm',revision};
    tx.set(ref.link,{...(source||old),...result,accountId:ACCOUNT,reference:reference||old?.reference||'',updatedAt:at,updatedBy:uid});
    claims.forEach(c=>tx.set(c,{statementId:id,active:result.active,at,uid}));
    tx.create(op,{requestHash,result,at,uid});
    tx.create(db.collection('bankStatementAudit').doc(randomUUID()),{action:`receivable-group-${action}`,uid,at,accountId:ACCOUNT,statementId:id,revision,reason,reference,members:selected,before:old||null,after:source});
    return result;
  });
}
module.exports={canRead,canWrite,selection,bankValid,validateMember,evidence,list,preview,mutate};
