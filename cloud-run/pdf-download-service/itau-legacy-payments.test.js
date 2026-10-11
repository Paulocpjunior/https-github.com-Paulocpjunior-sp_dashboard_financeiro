const test=require('node:test');
const assert=require('node:assert/strict');
const {projectLegacy,readLegacyPayments,compareLegacy,paidCents}=require('./itau-legacy-payments');
const BANK=require('./native-entry-catalog.json').banks[0];
const start='2026-10-01',end='2026-10-11';
const row=(id,patch={})=>({id,movement:'Saída',status:'Pago',paymentDate:'2026-10-09',dataPagamento:'09/10/2026',valorPago:'10.01',valuePaid:200,client:'Fornecedor sintético',...patch});
test('legacy uses explicit paid amount, missing bank is evidence gap, never provision fallback',()=>{
 const result=projectLegacy([row('one'),row('two',{bankAccount:BANK,valorPago:'R$ 1.234,56'}),row('no-paid',{valorPago:undefined}),row('other',{bankAccount:'Outro banco'}),row('date-conflict',{dataPagamento:'08/10/2026'}),row('invalid',{paymentDate:'2026-02-30'}),row('pending',{status:'Pendente'}),row('excluded',{isExcluded:true}),row('native',{payableBalance:{version:1}})],start,end);
 assert.equal(result.rows.length,2);assert.equal(result.rows[0].amountCents,1001);assert.equal(result.rows[0].bankEvidence,'missing');assert.equal(result.rows[1].amountCents,123456);
 assert.deepEqual(result.excluded,{native:1,inactiveOrOutsideScope:2,invalidEvidence:3,differentBank:1});
 for(const value of [null,'','1.234','1,234',0,-1,NaN,Infinity,'-10',{},'abc'])assert.equal(paidCents(value),null);
});
test('native/reversed/imported data and conflicting paid flag never become legacy candidates',()=>{
 const rows=[row('native',{source:'native-finance'}),row('reversal',{payableReversals:[{}]}),row('payments',{payablePayments:[{}]}),row('wix',{source:'wix'}),row('flag',{pago:'Não'}),row('entry',{movement:'Entrada'})];
 assert.equal(projectLegacy(rows,start,end).rows.length,0);
});
test('legacy matching preserves ambiguity across movements and excludes credits/date outside margin',()=>{
 const legacy=projectLegacy([row('one'),row('two')],start,end);
 const statement=(id,date='2026-10-09',amountCents=-1001)=>({id,date,amountCents});
 const result=compareLegacy([statement('a'),statement('b'),statement('c','2026-10-01'),statement('credit','2026-10-09',1001)],legacy);
 assert.equal(result.rows.length,3);assert(result.rows[0].ambiguous);assert(result.rows[1].ambiguous);assert.equal(result.rows[2].candidates.length,0);
 const one=compareLegacy([statement('a'),statement('b')],{...legacy,rows:[legacy.rows[0]]});assert(one.rows.every(r=>r.ambiguous));
});
test('reader deduplicates aliases, queries dates in bounded chunks and fails closed at limit',async()=>{
 const calls=[];
 const query={where:(...args)=>{calls.push(args);return query;},limit:n=>{assert.equal(n,5001);return query;},get:async()=>({size:1,docs:[{id:'one',data:()=>row('ignored')}]})};
 const result=await readLegacyPayments({collection:name=>{assert.equal(name,'transactions');return query;}},start,end);
 assert.equal(result.examined,1);assert.equal(result.rows[0].id,'one');assert(calls.some(c=>c[0]==='dataPagamento'&&c[1]==='in'&&c[2].includes('09/10/2026')));
 query.get=async()=>({size:5001,docs:[]});await assert.rejects(()=>readLegacyPayments({collection:()=>query},start,end),/parcial/);
 await assert.rejects(()=>readLegacyPayments({collection:()=>query},'2026-02-30',end),/Período/);
});
test('too many possible correspondences fail closed instead of rendering a truncated review',()=>{
 const rows=Array.from({length:5000},(_,i)=>({id:String(i),date:'2026-10-09',amountCents:1001}));
 assert.throws(()=>compareLegacy([{id:'a',date:'2026-10-09',amountCents:-1001},{id:'b',date:'2026-10-09',amountCents:-1001}],{rows}),/parcial/);
});
