const { createHash } = require('node:crypto');
const { gerarIcs, dataCivil } = require('./convites-vencimento.cjs');
class InviteError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
const hash = s => createHash('sha256').update(s).digest('hex');
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function validateSituation(b, expected, currentDay = today()) {
  if (!b || b.token !== expected.token || b.situacao !== 'EM_ABERTO' || b.pagamento || b.baixa || b.registro?.situacao !== 'REGISTRO_CONFIRMADO' || b.registro?.erro)
    throw new InviteError('INVITE disponível somente para boleto em aberto, com registro bancário confirmado e sem pagamento ou baixa.');
  let due; try { due = dataCivil(b.vencimento); } catch { throw new InviteError('Vencimento inválido no emissor.', 502); }
  if (due < currentDay) throw new InviteError('Boleto vencido. Regularize o vencimento antes de preparar o INVITE.');
  if (!Number.isFinite(b.valor) || b.valor <= 0 || !b.numero || !b.pagador?.nome ||
      Math.round(b.valor * 100) !== expected.amountCents || due !== expected.dueDate ||
      String(b.pagador.cprf || '').replace(/\D/g,'') !== expected.payerDocument ||
      (expected.number && b.numero !== expected.number))
    throw new InviteError('Dados do boleto divergiram. Atualize e confira a cobrança antes de preparar o INVITE.');
  return b;
}
// ASCII/base64 attachment lines can be folded without splitting Unicode text.
const foldBinary = s => s.match(/.{1,74}/g).join('\r\n ');
function artifacts(b, pdf, now = new Date()) {
  if (!Buffer.isBuffer(pdf) || pdf.length > 3_000_000 || pdf.subarray(0,5).toString() !== '%PDF-')
    throw new InviteError('PDF do boleto inválido ou maior que 3 MB.', 502);
  const number = b.numero.replace(/[^a-zA-Z0-9-]/g,'');
  const value = b.valor.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const subject = `Vencimento do boleto ${number} — ${value}`;
  const date = b.vencimento.split('-').reverse().join('/');
  const description = `Boleto ${number}. Valor: ${value}. Vencimento: ${date}.\nO PDF do boleto acompanha este convite. Confira o beneficiário no documento antes de pagar.\nSe já pagou, desconsidere o lembrete. Este arquivo não recebe atualizações automáticas; remova o evento após pagamento ou cancelamento.`;
  let ics = gerarIcs([{titulo:subject,vencimento:b.vencimento,identidade:hash(b.token),descricao:description}],now);
  // A cobrança mantém a identidade ao baixar novamente, independentemente da data/valor.
  ics = ics.replace(/UID:[\s\S]*?\r\n(?=[A-Z])/, foldBinary(`UID:boleto-${hash(b.token)}@financeiro.sp`)+"\r\n")
    .replace('TRANSP:TRANSPARENT', `CLASS:PRIVATE\r\n${foldBinary('ATTACH;FMTTYPE=application/pdf;ENCODING=BASE64;VALUE=BINARY:'+pdf.toString('base64'))}\r\nTRANSP:TRANSPARENT`);
  const base64 = bytes => Buffer.from(bytes).toString('base64').match(/.{1,76}/g).join('\r\n');
  const boundary = 'sp-financeiro-'+hash(b.token).slice(0,32);
  const part = (mime,name,bytes) => [`--${boundary}`,`Content-Type: ${mime}`,`Content-Disposition: attachment; filename="${name}"`,'Content-Transfer-Encoding: base64','',base64(bytes)].join('\r\n');
  // Draft only: no recipient, no sender and no network delivery hidden in download.
  const email = ['X-Unsent: 1','MIME-Version: 1.0',`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,`Content-Type: multipart/mixed; boundary="${boundary}"`,'',
    `--${boundary}`,'Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: base64','',base64(`Olá,\n\nSegue o boleto de ${value}, com vencimento em ${date}, e o convite para adicionar o vencimento à sua agenda.\nAbra o arquivo .ics para importar o evento e conferir o lembrete. O PDF também segue separado para acesso em calendários que não exibem anexos.\n\nSe já pagou, desconsidere.\nSP Assessoria Contábil`),
    part('application/pdf',`boleto-${number}.pdf`,pdf),part('text/calendar; charset=utf-8; method=PUBLISH',`vencimento-${number}.ics`,ics),`--${boundary}--`,''].join('\r\n');
  return {ics,email,number};
}
async function prepareInvite({token,base,apiKey,expected,fetchImpl=fetch,now=new Date()}) {
  const headers={Authorization:`Basic ${Buffer.from(apiKey+':token').toString('base64')}`};
  const get=async suffix=>{const r=await fetchImpl(`${base}/boletos/${encodeURIComponent(token)}${suffix}`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(25000)});if(!r.ok)throw new InviteError('Não foi possível conferir o boleto no emissor. Nenhum convite foi gerado.',502);return r;};
  const currentDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const first=validateSituation((await (await get('/situacao')).json()).boleto,expected,currentDay);
  // Read the PDF for the verified due date; this GET does not change bank registration.
  const document=await get('/atualizado/vencimento/'+first.vencimento);
  if(Number(document.headers?.get('content-length'))>3_000_000)throw new InviteError('PDF do boleto maior que 3 MB.',502);
  const pdf=Buffer.from(await document.arrayBuffer());
  const last=validateSituation((await (await get('/situacao')).json()).boleto,expected,currentDay);
  if(JSON.stringify(first)!==JSON.stringify(last))throw new InviteError('Boleto alterado durante a preparação. Atualize e tente novamente.');
  return artifacts(last,pdf,now);
}
function sendInvite(res,artifact,format) {
  const email=format==='invite-email';
  res.writeHead(200,{'Content-Type':email?'message/rfc822':'text/calendar; charset=utf-8','Content-Disposition':`attachment; filename="boleto-${artifact.number}.${email?'eml':'ics'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  res.end(email?artifact.email:artifact.ics);
}
module.exports={InviteError,validateSituation,artifacts,prepareInvite,sendInvite};
