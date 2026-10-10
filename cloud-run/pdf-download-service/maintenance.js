const {createHash, randomUUID} = require('node:crypto');
const seed = require('./native-entry-catalog.json');
const editable = ['categories','paymentMethods','receiptMethods','deliveryMethods','paidBy','authorizedBy','extras'];
const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
function initial() {
 return {revision:0,items:Object.fromEntries(Object.entries(seed).map(([group,values])=>[group,values.map(label=>({id:createHash('sha256').update(group+'|'+label).digest('hex').slice(0,24),label,active:true}))]))};
}
function effective(state) {
 const result={...seed};
 for(const group of editable) result[group]=state.items[group].filter(x=>x.active).map(x=>x.label);
 return result;
}
function change(state,body) {
 if(!editable.includes(body.group))fail('Parâmetro protegido ou desconhecido.');
 if(body.revision!==state.revision)fail('Cadastro alterado por outro administrador. Recarregue antes de salvar.',409);
 const label=typeof body.label==='string'?body.label.trim():'';
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(!label||label.length>160||/[\x00-\x1f]/.test(label)||reason.length<5||reason.length>500||typeof body.active!=='boolean')fail('Confira descrição, situação e motivo da alteração.');
 const items=state.items[body.group];
 const old=body.id?items.find(x=>x.id===body.id):null;
 if(body.id&&!old)fail('Cadastro não encontrado.',404);
 if(items.length>=1000&&!old)fail('Limite de cadastros atingido.');
 const code = value => value.match(/^(\d+)\s*-/)?.[1];
 if(body.group==='categories'){
  if(!/^\d{1,6}\s*-\s*\S/.test(label)||Number(code(label))<1)fail('Use o padrão código - descrição.');
  if(old&&Number(code(old.label))!==Number(code(label)))fail('O código de uma conta existente não pode mudar.');
  if(items.some(x=>x.id!==old?.id&&Number(code(x.label))===Number(code(label))))fail('Código já cadastrado, inclusive entre contas inativas.');
 }
 if(items.some(x=>x.id!==old?.id&&x.label.toLocaleLowerCase('pt-BR')===label.toLocaleLowerCase('pt-BR')))fail('Descrição já cadastrada.');
 const entry={id:old?.id||randomUUID(),label,active:body.active};
 return {next:{revision:state.revision+1,items:{...state.items,[body.group]:old?items.map(x=>x.id===old.id?entry:x):[...items,entry]}},before:old,after:entry,reason};
}
async function handleMaintenance({request,db,userRef,uid,allowed,readBody,reply}) {
 const ref=db.collection('financialSettings').doc('nativeCatalog');
 if(request.method==='GET'){
  const state=(await ref.get()).data()||initial();
  reply({...state,editable});return;
 }
 if(request.method!=='POST')fail('Método não permitido.',405);
 let body;try{body=JSON.parse((await readBody(request)).toString('utf8'));}catch{fail('Dados inválidos.');}
 const saved=await db.runTransaction(async tx=>{
  if(!allowed((await tx.get(userRef)).data()))fail('Acesso revogado.',403);
  const state=(await tx.get(ref)).data()||initial();
  const result=change(state,body);
  const at=new Date().toISOString();
  tx.set(ref,{...result.next,updatedAt:at,updatedBy:uid});
  tx.create(db.collection('financialSettingsAudit').doc(randomUUID()),{group:body.group,before:result.before,after:result.after,reason:result.reason,revision:result.next.revision,uid,at});
  return {...result.next,editable};
 });
 reply(saved);
}
function sameAccount(a,b){
 const code=v=>String(v||'').match(/^(\d+)\s*-/)?.[1];
 return a===b || Boolean(code(a)&&code(b)&&Number(code(a))===Number(code(b)));
}
function assertActiveCategory(state,label){
 const account=state?.items.categories.find(x=>sameAccount(x.label,label));
 if(account&&!account.active)fail('Conta inativada na Manutenção. Revise a recorrência antes de provisionar.',409);
}
module.exports={initial,effective,change,editable,handleMaintenance,sameAccount,assertActiveCategory};
