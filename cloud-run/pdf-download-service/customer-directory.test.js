const test=require('node:test'),assert=require('node:assert/strict');
const {change,resolve,identity,allowed,handle}=require('./customer-directory');
const source={movement:'Entrada',source:'wix',client:'Empresa exemplo - Contato: Ana',valueReceived:0,totalCobranca:237,dueDate:'2026-10-25'};
const target={movement:'Entrada',client:'Empresa exemplo',cpfCnpj:'12.345.678/0001-90',clientNumber:'414',totalCobranca:300,dueDate:'2026-10-26'};
const reason='Cadastro conferido com origem e responsável';
test('vincula identidades, mantém cobranças distintas e permite desfazer vínculo',()=>{
 const old=structuredClone([source,target]),state=change({revision:0,entries:{}},source,target,{action:'merge',reason});
 assert.equal(state.revision,1);assert.equal(resolve(identity(source),state.entries).profile.client,target.client);assert.deepEqual([source,target],old);
 const restored=change(state,source,null,{action:'unlink',reason});assert.equal(restored.entries[identity(source)],undefined);assert.equal(resolve(identity(target),restored.entries).profile.client,target.client);
});
test('edição mantém identidade; bloqueia fusão de documentos conflitantes e ciclos',()=>{
 const state=change({entries:{},revision:0},target,null,{action:'edit',reason,profile:{...target,client:'Nome corrigido'}});
 assert.equal(state.entries[identity(target)].client,'Nome corrigido');
 assert.throws(()=>change(state,target,null,{action:'edit',reason,profile:{...target,clientNumber:'999'}}),/Identificadores/);
 assert.throws(()=>change(state,{...source,cpfCnpj:'98.765.432/0001-10'},target,{action:'merge',reason}),/Documentos diferentes/);
 assert.throws(()=>change(state,target,{...source},{action:'merge',reason}),/destino precisa/);
 assert.throws(()=>resolve('a',{a:{target:'b'},b:{target:'a'}}),/circular/);
});
test('permissões cadastrais não ampliam direitos financeiros',()=>{
 assert.equal(allowed({active:true,role:'operacional'},'POST'),true);assert.equal(allowed({active:true,role:'operacional'},'GET'),true);assert.equal(allowed({active:false,role:'admin'},'POST'),false);
});
function fixture(){
 const store=new Map([['users/u',{active:true,role:'admin',name:'Teste'}],['transactions/a',source],['transactions/b',target]]);
 const doc=path=>({path,get:async()=>({data:()=>structuredClone(store.get(path))})});
 const db={collection:n=>({doc:id=>doc(n+'/'+id),where:(field,op,value)=>({limit:()=>({get:async()=>({docs:[...store.entries()].filter(([k,v])=>k.startsWith(n+'/')&&v[field]===value).map(([k,v])=>({data:()=>v}))})})})}),runTransaction:async fn=>{const writes=[];const result=await fn({get:ref=>ref.get(),set:(ref,v)=>writes.push([ref.path,v]),create:(ref,v)=>{assert.equal(store.has(ref.path),false);writes.push([ref.path,v]);}});writes.forEach(([p,v])=>store.set(p,structuredClone(v)));return result;}};
 return {store,async call(path,body){let result;await handle({request:{method:body?'POST':'GET',body},url:new URL('https://example.test/api/financial-entries/customers/'+path),db,userRef:doc('users/u'),user:store.get('users/u'),uid:'u',readBody:async r=>Buffer.from(JSON.stringify(r.body)),reply:r=>{result=r;}});return result;}};
}
test('prévia sem gravação, confirmação idempotente, versão concorrente e revogação',async()=>{
 const h=fixture(),b={requestId:'11111111-1111-4111-8111-111111111111',revision:0,sourceId:'a',targetId:'b',action:'merge',reason};const old=structuredClone([...h.store]);
 const p=await h.call('preview',b);assert.deepEqual([...h.store],old);const payload={...b,confirmHash:p.reviewHash};await h.call('commit',payload);await h.call('commit',payload);
 assert.deepEqual(h.store.get('transactions/a'),source);assert.deepEqual(h.store.get('transactions/b'),target);assert.equal([...h.store.keys()].filter(k=>k.startsWith('customerAudit')).length,1);
 await assert.rejects(h.call('commit',{...payload,reason:'Outra justificativa de revisão'}),/Tentativa/);
 await assert.rejects(h.call('preview',{...b,requestId:'22222222-2222-4222-8222-222222222222'}),/alterado/);
 h.store.set('users/u',{active:false,role:'admin'});await assert.rejects(h.call('commit',payload),/revogado/);
});

test('unificação preserva regra de faturamento ativa',async()=>{
 const h=fixture();h.store.set('billingProfiles/source',{identityKey:'name-empresa-exemplo-contato-ana',active:true,issueDay:3});
 await assert.rejects(h.call('preview',{requestId:'33333333-3333-4333-8333-333333333333',revision:0,sourceId:'a',targetId:'b',action:'merge',reason}),/regra de faturamento ativa/);
 assert.equal(h.store.has('financialSettings/customerDirectory'),false);
});
