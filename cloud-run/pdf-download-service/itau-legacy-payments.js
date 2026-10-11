// Read-only legacy evidence. Never infer a payment from a provisioned amount.
const { StatementError } = require('./itau-ofx');
const BANK = require('./native-entry-catalog.json').banks[0];
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
function isoDate(value) {
  if (typeof value !== 'string') return null;
  const s = /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value.split('/').reverse().join('-') : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s ? s : null;
}
function paidCents(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 && Number.isSafeInteger(Math.round(value*100)) ? Math.round(value*100) : null;
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/^R\$\s*/, '');
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(s)) s = s.replace(/\./g,'').replace(',','.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  return paidCents(Number(s));
}
function projectLegacy(records, start, end) {
  const rows = [], excluded = {native:0, inactiveOrOutsideScope:0, invalidEvidence:0, differentBank:0};
  for (const r of records) {
    if (norm(r.source) === 'native-finance' || r.nativeEntry || r.payableSettlement || r.payableBalance || r.payablePayments?.length || r.payableReversals?.length) { excluded.native++; continue; }
    if (r.isExcluded || r.deletedAt || r.wixEntityId || r.wixInvoiceNumber || norm(r.source)==='wix' || norm(r.movement)!=='saida' || !['pago','paga'].includes(norm(r.status))) { excluded.inactiveOrOutsideScope++; continue; }
    const date = isoDate(r.paymentDate || r.dataPagamento), amountCents = paidCents(r.valorPago);
    if (!date || !amountCents || (r.paymentDate && r.dataPagamento && isoDate(r.paymentDate)!==isoDate(r.dataPagamento)) || (r.pago && !['sim','pago','paga','true'].includes(norm(r.pago)))) { excluded.invalidEvidence++; continue; }
    if (date < start || date > end) continue;
    const bank = String(r.bankAccount || '').trim();
    const unknown = !bank || bank === '-';
    if (!unknown && bank !== BANK) { excluded.differentBank++; continue; }
    rows.push({id:r.id,transactionId:r.id,date,amountCents,supplier:String(r.client || r.description || '').slice(0,300),bankAccount:bank,bankEvidence:unknown?'missing':'same-account'});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  return {rows,excluded,examined:records.length,coverage:'Consulta por paymentDate (AAAA-MM-DD) e dataPagamento (DD/MM/AAAA ou AAAA-MM-DD). Registros sem essas datas ou em outros formatos não são cobertos. Usa somente valorPago explícito; valor provisionado não substitui pagamento. Nenhum vínculo ou baixa é registrado.'};
}
async function readLegacyPayments(db,start,end) {
  if (!isoDate(start) || !isoDate(end) || start>end || (Date.parse(end)-Date.parse(start))/86400000>98) throw new StatementError('Período inválido para consulta de legados.');
  const collection=db.collection('transactions'), records=new Map();
  const collect=async query=>{
    const page=await query.limit(5001).get();
    if(page.size>5000) throw new StatementError('Mais de 5.000 registros legados. Reduza o período; resultado parcial não apresentado.',409);
    for(const doc of page.docs) records.set(doc.id,{...doc.data(),id:doc.id});
    if(records.size>5000) throw new StatementError('Mais de 5.000 registros legados. Reduza o período; resultado parcial não apresentado.',409);
  };
  await collect(collection.where('paymentDate','>=',start).where('paymentDate','<=',end));
  const dates=[];
  for(let time=Date.parse(start);time<=Date.parse(end);time+=86400000) { const d=new Date(time).toISOString().slice(0,10); dates.push(d,d.split('-').reverse().join('/')); }
  for(let i=0;i<dates.length;i+=30) await collect(collection.where('dataPagamento','in',dates.slice(i,i+30)));
  return projectLegacy([...records.values()],start,end);
}
function compareLegacy(statements, legacy) {
  const links=new Map(); let candidateCount=0;
  const rows=statements.filter(s=>s.amountCents<0).map(statement=>{
    const candidates=legacy.rows.filter(p=>p.amountCents===-statement.amountCents && Math.abs(Date.parse(p.date)-Date.parse(statement.date))/86400000<=3);
    candidateCount+=candidates.length;
    if(candidateCount>5000) throw new StatementError('Mais de 5.000 correspondências possíveis. Reduza o período; resultado parcial não apresentado.',409);
    for(const p of candidates) links.set(p.id,(links.get(p.id)||0)+1);
    return {statement,candidates};
  }).map(row=>({...row,ambiguous:row.candidates.length>1 || row.candidates.some(p=>links.get(p.id)>1)}));
  return {...legacy,rows,paymentCount:legacy.rows.length};
}
module.exports={isoDate,paidCents,projectLegacy,readLegacyPayments,compareLegacy};
