// Read-only matching. Suggestions never authorize a settlement.
const { amount, money } = require('./boleto-cloud');
const { differences } = require('./boleto-reconciliation');
const digits = v => String(v || '').replace(/\D/g, '');
function candidatesFor(record, rows) {
  if (!record) return [];
  const document = digits(record.payerDocument);
  return rows.filter(({data:r}) => r.movement === 'Entrada' && !r.isExcluded && !r.deletedAt &&
    ((document && digits(r.cpfCnpj) === document) || (r.dueDate === record.dueDate && Math.round(money(amount(r))*100) === record.amountCents)))
    .map(({id,data:r}) => ({ id, name:r.client || r.description || '', cpfCnpj:r.cpfCnpj || '', dueDate:r.dueDate || '',
      amountCents:Math.round(money(amount(r))*100), receivedCents:Math.round(money(r.valueReceived)*100), paymentDate:r.paymentDate || '',
      method:r.receivableSettlement?.method || r.paymentMethod || '', bankAccount:r.bankAccount || '', status:r.status || '',
      differences:[...differences(record,r,true), ...(r.boletoReconciliation ? ['Lançamento já vinculado a outro boleto; conferir vínculo.'] : [])] }))
    .sort((a,b)=>a.differences.length-b.differences.length || Number(b.dueDate===record.dueDate)-Number(a.dueDate===record.dueDate) || a.id.localeCompare(b.id));
}
function classify(record, candidates, truncated=false) {
  if (!record) return 'Boleto ausente do histórico';
  if (truncated) return 'Consulta parcial — conferir candidatos';
  const exact = candidates.filter(r=>!r.differences.length);
  if (exact.length>1) return 'Múltiplos lançamentos compatíveis';
  if (exact.length===1) return exact[0].status==='Pago' ? 'Já recebido — conferir vínculo' : 'Correspondência única — revisar baixa';
  return candidates.length ? 'Divergência — conferir' : 'Sem lançamento candidato';
}
async function loadCandidates(db, record) {
  if (!record) return {rows:[],truncated:false};
  const d=digits(record.payerDocument), formatted=d.length===14?d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
  const filters=[['dueDate',record.dueDate],...[...new Set([d,formatted])].filter(Boolean).map(v=>['cpfCnpj',v])];
  const results=await Promise.all(filters.map(([k,v])=>db.collection('transactions').where(k,'==',v).limit(201).get()));
  const rows=new Map(results.flatMap(x=>x.docs.slice(0,200).map(doc=>[doc.id,{id:doc.id,data:doc.data()}])));
  return {rows:candidatesFor(record,[...rows.values()]),truncated:results.some(x=>x.docs.length>200)};
}
async function reviewQueue(db, records, cursor='') {
  let q=db.collection('boletoReturnEvents').where('state','==','review').orderBy('__name__');
  if(cursor)q=q.startAfter(cursor);
  const docs=(await q.limit(11).get()).docs, index=new Map(records.map(r=>[r.id,r]));
  const rows=await Promise.all(docs.slice(0,10).map(async doc=>{
    const e=doc.data(),r=index.get(e.boletoId),c=await loadCandidates(db,r);
    return {eventId:doc.id,fileId:e.fileId,boletoId:e.boletoId,number:e.number,reason:e.reason,
      paidCents:Math.round(money(e.occurrence?.info?.valorPago)*100),paymentDate:e.occurrence?.info?.dataDePagamento || '',
      record:r?{id:r.id,payerName:r.payerName,payerDocument:r.payerDocument,dueDate:r.dueDate,amountCents:r.amountCents,number:r.number}:null,
      candidates:c.rows,truncated:c.truncated,classification:classify(r,c.rows,c.truncated)};
  }));
  return {rows,nextCursor:docs.length>10?docs[9].id:null};
}
module.exports={candidatesFor,classify,loadCandidates,reviewQueue};
