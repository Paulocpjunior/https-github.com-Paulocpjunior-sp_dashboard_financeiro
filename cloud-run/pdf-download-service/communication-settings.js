const {randomUUID}=require('node:crypto');
const {SENDER}=require('./communication-rule');
const {configuration}=require('./communication-provider');
const initial=()=>({revision:0,offsets:[],payableRecipients:[],sender:SENDER,replyTo:SENDER,enabled:false});
function fail(message,status=400){throw Object.assign(Error(message),{status});}
function change(state,body){
 if(!body||body.revision!==state.revision)fail('Configuração alterada. Recarregue antes de salvar.',409);
 if(body.enabled!==false)fail('Envio real depende da homologação do canal.');
 if(!Array.isArray(body.offsets)||body.offsets.length<1||body.offsets.length>5||body.offsets.some(n=>!Number.isInteger(n)||n< -30||n>0)||new Set(body.offsets).size!==body.offsets.length)fail('Informe até cinco dias distintos entre -30 e 0.');
 if(!Array.isArray(body.payableRecipients)||body.payableRecipients.length>20||body.payableRecipients.some(v=>typeof v!=='string'||v.length>254||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v)))fail('Confira os e-mails internos, no máximo 20.');
 const recipients=body.payableRecipients.map(v=>v.toLowerCase());if(new Set(recipients).size!==recipients.length)fail('E-mail repetido.');
 if(typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>500)fail('Informe o motivo da alteração.');
 return {revision:state.revision+1,offsets:[...body.offsets].sort((a,b)=>a-b),payableRecipients:recipients,sender:SENDER,replyTo:SENDER,enabled:false};
}
async function handle({request,db,userRef,uid,allowed,readBody,reply,env}){
 const ref=db.collection('financialSettings').doc('communicationRule');
 const output=state=>({...state,enabled:false,channel:configuration(env),activationAvailable:false});
 if(request.method==='GET'){
  const state=(await ref.get()).data()||initial();if(!allowed((await userRef.get()).data()))fail('Acesso revogado.',403);reply(output(state));return;
 }
 if(request.method!=='POST')fail('Método não permitido.',405);
 let body;try{body=JSON.parse((await readBody(request)).toString('utf8'));}catch{fail('Dados inválidos.');}
 const state=await db.runTransaction(async tx=>{
  if(!allowed((await tx.get(userRef)).data()))fail('Acesso revogado.',403);
  const before=(await tx.get(ref)).data()||initial();const next=change(before,body);const at=new Date().toISOString();
  tx.set(ref,{...next,updatedBy:uid,updatedAt:at});tx.create(db.collection('financialSettingsAudit').doc(randomUUID()),{group:'communicationRule',before,after:next,uid,at,reason:body.reason.trim()});return next;
 });reply(output(state));
}
module.exports={initial,change,handle};
