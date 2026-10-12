const {createHash,randomUUID}=require('node:crypto');
const {recipients}=require('./communication-recipients');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function compile(input){
 if(input?.format!=='boleto-payers-v1'||! /^[a-f0-9]{64}$/.test(input.sourceSha256||'')||typeof input.sourceName!=='string'||input.sourceName.length>200||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>10000)throw Error('Relatório de pagadores inválido.');
 const records={};let blocked=0;
 for(const row of input.rows){
  const doc=String(row.document||'').replace(/\D/g,'');
  if(!/^(\d{11}|\d{14})$/.test(doc))throw Error('CPF/CNPJ inválido no relatório. Corrija a fonte.');
  let emails=[],issue=null;try{emails=recipients(row.emails);}catch{issue='E-mail ausente ou inválido no cadastro.';}
  if(records[doc]){records[doc]={document:doc,name:records[doc].name,emails:[],issue:'Mais de um cadastro para o CPF/CNPJ. Corrija na origem.'};continue;}
  records[doc]={document:doc,name:String(row.name||'').slice(0,300),emails,issue};
 }
 blocked=Object.values(records).filter(r=>r.issue).length;
 const data={format:input.format,sourceName:input.sourceName,sourceSha256:input.sourceSha256,records,count:input.rows.length,documents:Object.keys(records).length,blocked};
 if(Buffer.byteLength(JSON.stringify(data))>700000)throw Error('Relatório excede o limite de importação.');
 return {...data,revision:hash(data)};
}
async function lookup(db,document){
 const catalog=(await db.collection('financialSettings').doc('boletoPayers').get()).data();
 const row=catalog?.records?.[document];
 if(!row||row.issue)throw Object.assign(Error(row?.issue||'Importe e confira o relatório de pagadores do Boleto Cloud.'),{status:409});
 return {emails:recipients(row.emails),catalogRevision:catalog.revision,document,sourceName:catalog.sourceName,importedAt:catalog.importedAt};
}
async function importCatalog({db,input,uid,userRef,allowed,reason,expectedRevision,reviewToken,now}){
 const next=compile(input);if(reviewToken!==next.revision)throw Error('Relatório alterado. Revise novamente.');
 if(typeof reason!=='string'||reason.trim().length<5||reason.length>500)throw Error('Informe o motivo da importação.');
 const ref=db.collection('financialSettings').doc('boletoPayers');
 return db.runTransaction(async tx=>{
  const user=(await tx.get(userRef)).data(),old=(await tx.get(ref)).data();
  if(!allowed(user))throw Object.assign(Error('Acesso revogado.'),{status:403});
  if((old?.revision||null)!==expectedRevision)throw Error('Cadastro alterado. Revise novamente.');
  const at=now().toISOString();tx.set(ref,{...next,importedAt:at,importedBy:uid});
  tx.create(db.collection('financialCommunicationEvents').doc(randomUUID()),{action:'catalog-imported',uid,at,reason,sourceSha256:next.sourceSha256,previousRevision:old?.revision||null,revision:next.revision,count:next.count,blocked:next.blocked});
  return {count:next.count,blocked:next.blocked,enabled:false};
 });
}
module.exports={compile,lookup,importCatalog};
