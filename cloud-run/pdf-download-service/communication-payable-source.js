const {createHash}=require('node:crypto');
const {pending,nominal,calendar}=require('./payables');
const {contactRecipients}=require('./communication-recipients');
const {validateArtifacts}=require('./communication-rule');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function inspectEntry(entry,now){
 pending(entry);
 if(entry.payableBalance?.paidCents>0||entry.payableSettlement)throw Error('Pagamento parcial exige conferência própria.');
 const due=entry.dueDate;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(due||'')||new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due)throw Error('Vencimento inválido.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(due<today)throw Error('Conta vencida exige revisão.');
 const files=(entry.attachments||[]).filter(a=>a.type==='application/pdf');
 if(files.length!==1||!/^[a-f0-9]{64}$/.test(files[0].sha256||''))throw Error('Vincule um único PDF conferido à conta antes de preparar o aviso.');
 return files[0];
}
function createPayableSource({loadBinding,download,now=()=>new Date()}){
 async function inspect(ref){
  if(ref.kind!=='payable')throw Error('Fonte inválida.');
  const b=await loadBinding(ref.id),file=inspectEntry(b.entry,now());
  const emails=contactRecipients(b.recipient);
  if(!b.recipient.confirmedBy||!Number.isFinite(Date.parse(b.recipient.confirmedAt)))throw Error('Confirmação ausente.');
  return {b,file,emails,source:{id:ref.id,kind:'payable',revision:hash(b),reviewRevision:hash([b.entry,emails,b.recipient.catalogRevision]),dueDate:b.entry.dueDate,amountCents:nominal(b.entry),status:'open',verified:true}};
 }
 return {readSource:async ref=>(await inspect(ref)).source,async prepare(job){
  const first=await inspect(job.source);
  if(first.source.revision!==job.source.revision||JSON.stringify(first.emails)!==JSON.stringify(contactRecipients(job.recipient)))throw Error('Conta ou destinatários alterados.');
  const pdf=await download(job.source.id,first.file);
  if(!Buffer.isBuffer(pdf)||pdf.length>=3000000||pdf.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(pdf).digest('hex')!==first.file.sha256)throw Error('Documento divergente.');
  const last=await inspect(job.source);if(last.source.revision!==first.source.revision)throw Error('Conta alterada durante a conferência.');
  const ics=calendar(first.b.entry,job.source.id,first.emails,{bytes:pdf}).ics;
  const out={subject:'Lembrete interno de conta a pagar — SP Financeiro',text:`Conta: ${first.b.entry.description||first.b.entry.client||job.source.id}\nVencimento: ${first.source.dueDate}\nValor: R$ ${(first.source.amountCents/100).toFixed(2)}\nConfira a fatura anexa e o sistema antes de pagar. Este aviso não executa pagamento. Se já pagou, desconsidere. O calendário não recebe atualizações automáticas.`,attachments:[{name:'fatura.pdf',type:'application/pdf',content:pdf},{name:'vencimento.ics',type:'text/calendar',content:Buffer.from(ics)}]};validateArtifacts(out);return out;
 }};
}
module.exports={createPayableSource,inspectEntry};
