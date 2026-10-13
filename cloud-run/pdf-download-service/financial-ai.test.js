const test=require('node:test');const assert=require('node:assert/strict');
const {createAIHandler,cleanFilters,validateInput,projectRow}=require('./financial-ai');
function harness({profile={active:true,role:'operacional'},enabled=true,generator,records={}}={}) {
 let calls=0,reads=0,now=Date.parse('2026-10-11T12:00:00Z'),usage,profiles=0;
 const db={collection:name=>({doc:id=>({name,id,get:async()=>({exists:true,data:()=>{profiles++;return typeof profile==='function'?profile(profiles):profile;}})})}),getAll:async(...refs)=>{reads+=refs.length;return refs.map(ref=>({id:ref.id,exists:!!records[ref.id],data:()=>records[ref.id]}));},runTransaction:async fn=>fn({get:async()=>({data:()=>usage}),set:(ref,data)=>{assert.equal(ref.name,'financialAIUsage');usage=data;}})};
 const handler=createAIHandler({getServices:()=>({adminDb:db,adminAuth:{verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);if(token!=='ok')throw Error();return{uid:'user'};}}}),enabled:()=>enabled,now:()=>new Date(now),readBody:async req=>Buffer.from(JSON.stringify(req.body)),sendJson:(_req,res,status,body)=>Object.assign(res,{status,body}),generateAnswer:async input=>{calls++;return generator?generator(input):{explanation:'Consulta do recorte.',filters:{}};}});
 return {call:async(body={mode:'filter',query:'Mostrar pendentes'},token='ok',path='query',method='POST')=>{const res={};await handler({url:'/api/financial-ai/'+path,method,headers:{authorization:token?'Bearer '+token:''},body},res);return res;},calls:()=>calls,reads:()=>reads,tick:()=>{now+=4000;}};
}
test('AI denies anonymous, revoked and inactive users before any model or record read',async()=>{
 for(const [profile,token,status] of [[{active:true,role:'admin'},'',401],[{active:true,role:'admin'},'bad',401],[{active:false,role:'admin'},'ok',403],[{active:true,role:'operacional',status:'deleted'},'ok',403]]){
 const h=harness({profile});assert.equal((await h.call(undefined,token)).status,status);assert.equal(h.calls(),0);assert.equal(h.reads(),0);}
});
test('status is authenticated and disabled server never invokes provider',async()=>{const h=harness({enabled:false});assert.equal((await h.call(undefined,'ok','status','GET')).body.enabled,false);assert.equal((await h.call()).status,503);assert.equal(h.calls(),0);});
test('record and question limits reject overflow, path injection and duplicate IDs',()=>{
 for(const transactionIds of [Array(301).fill('a'),['../users'],['a','a']])assert.throws(()=>validateInput({mode:'analysis',query:'q',transactionIds}));
 assert.throws(()=>validateInput({mode:'payment',query:'q'}));assert.throws(()=>validateInput({mode:'filter',query:'x'.repeat(2001)}));
});
test('server rereads selected records and excludes private fields and caller-supplied values',async()=>{
 const h=harness({records:{a:{client:'Cliente fictício',valuePaid:20,cpfCnpj:'secret',observacao:'private',attachments:['secret']}},generator:input=>{assert.equal(input.rows[0].valuePaid,20);assert.equal(input.rows[0].cpfCnpj,undefined);assert.equal(input.rows[0].observacao,undefined);return {explanation:'Registro a.',filters:{status:'Pago'}};}});
 const r=await h.call({mode:'analysis',query:'Resumo',transactionIds:['a'],rows:[{valuePaid:999}]});assert.equal(r.status,200);assert.deepEqual(r.body.filters,{});assert.deepEqual(r.body.source.ids,['a']);assert.equal(h.reads(),1);
});
test('missing or excluded records block incomplete analysis rather than silently dropping data',async()=>{
 for(const records of [{},{a:{isExcluded:true}}]){const h=harness({records});assert.equal((await h.call({mode:'analysis',query:'q',transactionIds:['a']})).status,409);assert.equal(h.calls(),0);}
});
test('revocation during data read or model generation blocks release',async()=>{
 for(const cutoff of [2,3]){const h=harness({profile:count=>({role:'admin',active:count<cutoff})});const r=await h.call();assert.equal(r.status,403);assert.equal(h.calls(),cutoff===2?0:1);}
});
test('atomic quota blocks repeated queries before provider call',async()=>{const h=harness();assert.equal((await h.call()).status,200);assert.equal((await h.call()).status,429);h.tick();assert.equal((await h.call()).status,200);assert.equal(h.calls(),2);});
test('filter output has allowlisted fields and valid dates/status only',()=>{
 assert.deepEqual(cleanFilters({status:'Pago',execute:'payment',bankAccount:'unknown'}),{status:'Pago'});
 for(const value of [{status:'Concluído'},{movement:'DELETE'},{startDate:'2026-02-30'},{startDate:'2026-11-01',endDate:'2026-10-01'}])assert.throws(()=>cleanFilters(value));
});
test('provider failures never expose raw error details and empty answers are refused',async()=>{
 const h=harness({generator:()=>{throw Error('secret-token');}});const r=await h.call();assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('secret-token'));
 assert.equal((await harness({generator:()=>({explanation:''})}).call()).status,502);
});
test('projection preserves partial balance cent units without filling missing values with zero',()=>{
 const row=projectRow({id:'a',exists:true,data:()=>({payableBalance:{version:1,paidCents:1000,remainingCents:2000},valorOriginal:30})});assert.equal(row.payableBalance.remainingCents,2000);assert.equal(row.valuePaid,undefined);
});

test('FiA recebe somente totais do saldo parcial a receber, sem notas',()=>{
 const row=projectRow({id:'r',exists:true,data:()=>({receivableBalance:{version:1,receivedCents:4000,remainingCents:6100,interestCents:200,discountCents:100,note:'privado'}})});
 assert.deepEqual(row.receivableBalance,{receivedCents:4000,remainingCents:6100,interestCents:200,discountCents:100});
});
