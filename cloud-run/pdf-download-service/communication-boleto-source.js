const {contactRecipients}=require('./communication-recipients');
// Read-only adapter. No routes, scheduling, issuance or customer delivery are enabled here.
const {createHash}=require('node:crypto');
const {validateSituation,artifacts:inviteArtifacts}=require('./boleto-invite');
const {validateArtifacts}=require('./communication-rule');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createBoletoSource({base,apiKey,loadBinding,fetchImpl=fetch,now=()=>new Date(),statement=null}){
 // Deployment must supply the already configured provider URL, never a URL from a job/client.
 if(!['https://app.boletocloud.com/api/v1','https://sandbox.boletocloud.com/api/v1'].includes(base)||!apiKey||typeof loadBinding!=='function')throw Error('Fonte indisponível.');
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
 const get=async(token,suffix)=>{
  let r;try{r=await fetchImpl(`${base}/boletos/${encodeURIComponent(token)}${suffix}`,{method:'GET',headers:{Authorization:`Basic ${Buffer.from(apiKey+':token').toString('base64')}`},redirect:'error',signal:AbortSignal.timeout(25000)});}catch{throw Error('Consulta ao emissor indisponível.');}
  if(!r.ok)throw Error('Consulta ao emissor indisponível.');return r;
 };
 async function inspect(ref){
  if(ref?.kind!=='receivable'||typeof ref.id!=='string'||!ref.id||ref.id.length>200)throw Error('Fonte inválida.');
  const binding=await loadBinding(ref.id);
  if(!binding||binding.active!==true||typeof binding.revision!=='string'||!binding.revision||typeof binding.token!=='string'||!binding.token||!binding.expected||binding.expected.token!==binding.token)throw Error('Vínculo indisponível.');
  const recipient=binding.recipient;
  const email=JSON.stringify(contactRecipients(recipient));
  if(!recipient.confirmedBy||!Number.isFinite(Date.parse(recipient.confirmedAt))||Date.parse(recipient.confirmedAt)>now().getTime())throw Error('Destinatário não confirmado.');
  const response=await get(binding.token,'/situacao');
  let bank;try{bank=(await response.json()).boleto;}catch{throw Error('Resposta inválida do emissor.');}
  validateSituation(bank,binding.expected,today());
  // Bind both authoritative source and administrative recipient to the immutable job revision.
  const source={id:ref.id,kind:'receivable',revision:digest([binding,bank]),reviewRevision:digest([bank,binding.expected,binding.entry||null,email]),status:'open',verified:true,amountCents:binding.expected.amountCents,dueDate:bank.vencimento};
  return {source,binding,bank,email};
 }
 return {
  readSource:async ref=>(await inspect(ref)).source,
  async prepare(job){
   const first=await inspect(job.source);
   if(first.source.revision!==job.source.revision||first.email!==JSON.stringify(contactRecipients(job.recipient)))throw Error('Cobrança ou destinatário alterado.');
   const response=await get(first.binding.token,'/atualizado/vencimento/'+first.bank.vencimento);
   if(Number(response.headers?.get('content-length'))>3000000)throw Error('PDF excede o limite.');
   const pdf=Buffer.from(await response.arrayBuffer());
   if(pdf.length>=3000000||pdf.subarray(0,5).toString()!=='%PDF-')throw Error('PDF inválido.');
   const attachments=[{name:'boleto.pdf',type:'application/pdf',content:pdf}];
   if(first.binding.entry){
    if(typeof statement!=='function'||Math.round(Number(first.binding.entry.valorOriginal)*100)!==first.source.amountCents)throw Error('Composição indisponível ou divergente.');
    attachments.push({name:'demonstrativo.pdf',type:'application/pdf',content:await statement(first.binding.entry)});
   }
   const last=await inspect(job.source);
   if(first.source.revision!==last.source.revision)throw Error('Cobrança alterada durante a preparação.');
   const value=(first.source.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
   const date=first.source.dueDate.split('-').reverse().join('/');
   const result={subject:`Lembrete de vencimento — ${date} — SP Financeiro`,text:`Olá,\n\nSegue o boleto de ${value}, com vencimento em ${date}. Confira os dados do beneficiário no PDF antes de pagar.\n\nSe já realizou o pagamento, desconsidere este lembrete. Em caso de divergência, responda a este e-mail.\n\nEquipe Financeira — SP Assessoria Contábil`,attachments};
   attachments.push({name:'vencimento.ics',type:'text/calendar',content:Buffer.from(inviteArtifacts(last.bank,pdf,now(),attachments[1]?.content).ics)});
   validateArtifacts(result);return result;
  }
 };
}
module.exports={createBoletoSource};
