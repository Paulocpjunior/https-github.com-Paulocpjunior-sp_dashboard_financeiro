const {createHash}=require('node:crypto');
const {validDocument}=require('./boleto-cloud');
// Cliente novo (geralmente do Checklist do Legal) entra no cadastro conferido usado pela Nova cobrança.
// Nunca substitui um cadastro conferido existente: só cria ou completa o que estava pendente, com histórico.
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const digits=x=>String(x||'').replace(/\D/g,'');
const number=x=>digits(x).replace(/^0+(?=\d)/,'');
const norm=x=>String(x||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const sources=['checklist','manual'];
function validate(b){
 if(!b||typeof b!=='object')fail('Dados inválidos.',400);
 if(!/^[a-f0-9-]{36}$/.test(b.requestId||''))fail('Identificador inválido.',400);
 const str=(x,max)=>{if(x!=null&&typeof x!=='string')fail('Dados inválidos.',400);const t=String(x||'').trim();if(t.length>max)fail('Texto muito longo.',400);return t;};
 const client=str(b.client,300).replace(/\s+/g,' '),document=digits(str(b.cpfCnpj,40)),clientNumber=str(b.clientNumber,40);
 if(client.length<3)fail('Informe o nome do cliente.',400);
 if(![11,14].includes(document.length)||!validDocument(document))fail('Informe CPF (11 dígitos) ou CNPJ (14 dígitos) válido.',400);
 if(!/^\d{1,20}$/.test(clientNumber)||!number(clientNumber))fail('Informe o N.Cliente (somente números).',400);
 const source=str(b.source,20);if(!sources.includes(source))fail('Origem do cadastro inválida.',400);
 const submissionId=str(b.checklistSubmissionId,40);
 if(source==='checklist'&&!/^\d{1,30}$/.test(submissionId))fail('Resposta do Checklist inválida.',400);
 const reason=str(b.reason,2000);
 if(source==='manual'&&reason.length<10)fail('Informe a origem e o motivo do cadastro manual (mínimo de 10 caracteres).',400);
 return {client,document,clientNumber,source,submissionId:source==='checklist'?submissionId:'',reason};
}
const option=(id,r)=>({id,client:r.client||'',clientNumber:String(r.clientNumber||''),cpfCnpj:r.cpfCnpjDigits||''});
async function registerClient({db,userRef,user,uid,allowed,body}){
 const v=validate(body),id='doc-'+v.document,ref=db.collection('clientRegistry').doc(id);
 const key=hash([uid,body.requestId]),op=db.collection('clientRegistryOperations').doc(key),digest=hash(['register',v]);
 return db.runTransaction(async tx=>{
  if(!allowed((await tx.get(userRef)).data()))fail('Acesso revogado.',403);
  const previous=(await tx.get(op)).data();if(previous){if(previous.digest!==digest)fail('Tentativa já usada.');return previous.result;}
  const before=(await tx.get(ref)).data()||null;
  // Já conferido: usa o cadastro existente; corrigir nome ou N.Cliente é outro fluxo, com revisão própria.
  if(before?.status==='ready'){const result={client:option(id,before),created:false,existing:true};tx.create(op,{digest,result,at:new Date().toISOString()});return result;}
  const num=number(v.clientNumber);
  const same=await tx.get(db.collection('clientRegistry').where('clientNumberNormalized','==',num).limit(5));
  const other=same.docs.find(d=>d.id!==id&&d.data().status==='ready');
  if(other)fail(`N.Cliente ${v.clientNumber} já pertence a ${other.data().client||'outro cliente'}. Confira o número no Checklist antes de cadastrar.`);
  const at=new Date().toISOString(),actor=user?.name||user?.username||uid;
  const after={...(before||{}),key:'doc:'+v.document,keyType:v.document.length===11?'cpf':'cnpj',cpfCnpjDigits:v.document,client:v.client,clientNormalized:norm(v.client),clientNumber:v.clientNumber,clientNumberNormalized:num,status:'ready',confidence:'high',source:before?.source||v.source,registeredFrom:v.source,checklistSubmissionId:v.submissionId||null,createdAt:before?.createdAt||at,updatedAt:at,updatedBy:actor,updatedByUid:uid};
  tx.set(ref,after);
  tx.create(db.collection('clientRegistryAudit').doc(key),{uid,actor,at,action:before?'complete-registry':'register',clientRegistryId:id,source:v.source,checklistSubmissionId:v.submissionId||null,reason:v.reason,before,after});
  const result={client:option(id,after),created:!before,existing:false};
  tx.create(op,{digest,result,at});return result;
 });
}
module.exports={registerClient,validate};
