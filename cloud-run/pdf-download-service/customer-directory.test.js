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
 const db={collection:n=>({doc:id=>doc(n+'/'+id),where:(field,op,value)=>({limit:()=>({get:async()=>({docs:[...store.entries()].filter(([k,v])=>k.startsWith(n+'/')&&v[field]===value).map(([k,v])=>({id:k.slice(n.length+1),data:()=>v}))})})})}),runTransaction:async fn=>{const writes=[];const result=await fn({get:ref=>ref.get(),set:(ref,v)=>writes.push([ref.path,v]),create:(ref,v)=>{assert.equal(store.has(ref.path),false);writes.push([ref.path,v]);}});writes.forEach(([p,v])=>store.set(p,structuredClone(v)));return result;}};
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

const radio={movement:'Entrada',client:'RADIO SB FM LTDA',cpfCnpj:'07.147.345/0001-11',clientNumber:'170',totalCobranca:500,dueDate:'2026-10-05'};
const rule={groupName:'',billingMethod:'Boleto Itaú',issueDay:24,issueMonthOffset:-1,dueDay:5,deliveryChannels:['email'],billingEmail:'marlene@example.test',whatsapp:'',printedDeliveryDetails:'',billingInstructions:''};
function billing(){
 const h=fixture();h.store.set('users/u',{active:true,role:'operacional',name:'Colaboradora'});h.store.set('transactions/r',radio);
 h.store.set('billingProfiles/doc-07147345000111',{id:'doc-07147345000111',identityKey:'doc-07147345000111',client:radio.client,active:true,issueDay:20,createdAt:'2026-01-01T00:00:00.000Z'});
 h.store.set('clientRegistry/x',{cpfCnpjDigits:'11222333000181',clientNumber:'414',clientNumberNormalized:'414',client:'Outra Empresa'});
 let n=0;h.save=body=>h.call('billing-profile',{requestId:`44444444-4444-4444-8444-${String(++n).padStart(12,'0')}`,revision:0,sourceId:'r',profileId:'doc-07147345000111',identityKey:'doc-07147345000111',rule,customer:{client:radio.client,cpfCnpj:radio.cpfCnpj,clientNumber:'170'},reason:'',...body});
 return h;
}
test('colaboradora corrige empresa, CNPJ e N.Cliente com motivo; regra acompanha e tudo fica auditado',async()=>{
 const h=billing(),customer={client:'RÁDIO SB FM LTDA',cpfCnpj:'12.345.678/0001-95',clientNumber:'0171'};
 await assert.rejects(h.save({customer}),/motivo/);
 const r=await h.save({customer,reason:'CNPJ conferido no cartão CNPJ e no Checklist'});
 assert.equal(r.identityChanged,true);assert.deepEqual(h.store.get('transactions/r'),radio);
 assert.deepEqual(h.store.get('financialSettings/customerDirectory').entries['doc:07147345000111'],{client:'RÁDIO SB FM LTDA',cpfCnpj:'12345678000195',clientNumber:'0171'});
 const moved=h.store.get('billingProfiles/doc-12345678000195');assert.equal(moved.active,true);assert.equal(moved.issueDay,24);assert.equal(moved.createdAt,'2026-01-01T00:00:00.000Z');assert.equal(moved.updatedBy,'Colaboradora');
 assert.equal(h.store.get('billingProfiles/doc-07147345000111').active,false);assert.equal(h.store.get('billingProfiles/doc-07147345000111').movedTo,'doc-12345678000195');
 const audit=[...h.store].find(([k])=>k.startsWith('billingProfileAudit/'))[1];
 assert.equal(audit.actor,'Colaboradora');assert.equal(audit.before.customer.cpfCnpj,'07147345000111');assert.equal(audit.after.customer.cpfCnpj,'12345678000195');assert.match(audit.reason,/cartão CNPJ/);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('customerAudit/')).length,1);
});
test('regra sem mudança de identificação dispensa motivo e mesmo assim gera histórico',async()=>{
 const h=billing();await h.save({});
 assert.equal(h.store.get('billingProfiles/doc-07147345000111').issueDay,24);assert.equal(h.store.has('financialSettings/customerDirectory'),false);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('billingProfileAudit/')).length,1);
});
test('regra aceita mais de um e-mail de faturamento e recusa endereço inválido',async()=>{
 const h=billing();
 await h.save({rule:{...rule,billingEmail:'Enilda@Example.test;  jjunior@example.test, enilda@example.test'}});
 assert.equal(h.store.get('billingProfiles/doc-07147345000111').billingEmail,'enilda@example.test; jjunior@example.test');
 await assert.rejects(h.save({revision:1,rule:{...rule,billingEmail:'enilda@example.test; jjunior'}}),/E-mail de faturamento inválido: jjunior/);
});
test('bloqueia CNPJ inválido, documento ou número de outro cliente e documento em branco',async()=>{
 const h=billing(),reason='Correção conferida com o cliente';
 await assert.rejects(h.save({reason,customer:{client:radio.client,cpfCnpj:'12.345.678/0001-90',clientNumber:'170'}}),/dígitos verificadores/);
 await assert.rejects(h.save({reason,customer:{client:radio.client,cpfCnpj:'11.222.333/0001-81',clientNumber:'170'}}),/CPF\/CNPJ já pertence a Outra Empresa/);
 await assert.rejects(h.save({reason,customer:{client:radio.client,cpfCnpj:radio.cpfCnpj,clientNumber:'00414'}}),/N.Cliente já pertence a Outra Empresa/);
 await assert.rejects(h.save({reason,customer:{client:radio.client,cpfCnpj:'',clientNumber:'170'}}),/não pode ficar em branco/);
 await assert.rejects(h.save({identityKey:'doc-99999999999999'}),/Atualize a tela/);
 assert.equal(h.store.get('billingProfiles/doc-07147345000111').issueDay,20);
});

test('correção alcança identidades já corrigidas para o mesmo cadastro e os lançamentos nativos dele',async()=>{
 const h=billing(),old={client:radio.client,cpfCnpj:'07147345000111',clientNumber:'170'};
 h.store.set('financialSettings/customerDirectory',{revision:3,entries:{'name:wix:radio sb':old}});
 h.store.set('transactions/w',{movement:'Entrada',source:'wix',client:'Radio SB'});
 const customer={client:radio.client,cpfCnpj:'12.345.678/0001-95',clientNumber:'170'},reason='CNPJ conferido no cartão CNPJ';
 await h.save({revision:3,customer,reason});
 let entries=h.store.get('financialSettings/customerDirectory').entries;
 assert.equal(entries['doc:07147345000111'].cpfCnpj,'12345678000195');assert.equal(entries['name:wix:radio sb'].cpfCnpj,'12345678000195');
 const g=billing();g.store.set('financialSettings/customerDirectory',{revision:3,entries:{'name:wix:radio sb':old}});g.store.set('transactions/w',{movement:'Entrada',source:'wix',client:'Radio SB'});
 await g.save({revision:3,sourceId:'w',customer,reason});
 entries=g.store.get('financialSettings/customerDirectory').entries;
 assert.equal(entries['doc:07147345000111'].cpfCnpj,'12345678000195');assert.equal(entries['name:wix:radio sb'].cpfCnpj,'12345678000195');
});

test('colaboradora corrige endereço de cobrança: validado, idempotente e com log de antes e depois',async()=>{
 const h=billing(),address={cep:'04538-133',uf:'sp',localidade:'São Paulo',bairro:'Itaim Bibi',logradouro:'Av. Brigadeiro Faria Lima',numero:'3477',complemento:''};
 const call=(body)=>h.call('billing-address',{requestId:'55555555-5555-4555-8555-555555555555',sourceId:'r',address,origin:'lote',...body});
 await assert.rejects(call({address:{...address,cep:'123'}}),/CEP|endereço/);
 const saved=await call();
 assert.equal(saved.identityKey,'doc-07147345000111');assert.equal(saved.address.cep,'04538133');assert.equal(saved.address.uf,'SP');
 await call();
 const doc=h.store.get('billingAddresses/doc-07147345000111');assert.equal(doc.address.logradouro,'Av. Brigadeiro Faria Lima');assert.equal(doc.updatedBy,'Colaboradora');
 const audits=[...h.store].filter(([k])=>k.startsWith('billingAddressAudit/'));assert.equal(audits.length,1);assert.equal(audits[0][1].before,null);assert.equal(audits[0][1].after.numero,'3477');assert.equal(audits[0][1].origin,'lote');
 await assert.rejects(call({address:{...address,numero:'1'}}),/Tentativa/);
 await h.call('billing-address',{requestId:'66666666-6666-4666-8666-666666666666',sourceId:'r',address:{...address,numero:'100'}});
 const second=[...h.store].filter(([k])=>k.startsWith('billingAddressAudit/')).map(([,v])=>v).find(v=>v.after.numero==='100');assert.equal(second.before.numero,'3477');
 assert.deepEqual(h.store.get('transactions/r'),radio);
 const read=await h.call('billing-address?sourceId=r');assert.equal(read.address.numero,'100');
 h.store.set('users/u',{active:false});await assert.rejects(h.call('billing-address',{requestId:'77777777-7777-4777-8777-777777777777',sourceId:'r',address}),/revogado/);
});
