const {test}=require('node:test'),assert=require('node:assert/strict');
const {monthsThrough,provisionPending,key}=require('./payable-provision-job');
function fixture(){
 const records=new Map([['payableRecurrences/r',{active:true,schedule:'continuous',monthlyDrafts:true,start:'2026-10',description:'Luz'}],['transactions/r',{dueDate:'2026-09-10',valuePaid:999}]]);
 let tail=Promise.resolve();
 const db={collection:c=>({doc:id=>`${c}/${id}`}),runTransaction:fn=>{const p=tail.then(()=>fn({get:async ref=>({exists:records.has(ref),data:()=>records.get(ref)}),create:(ref,data)=>{assert.ok(!records.has(ref));records.set(ref,data);}}));tail=p.catch(()=>{});return p;}};
 return {records,db};
}
test('catch-up enumerates all missed months across year boundaries',()=>{
 assert.deepEqual(monthsThrough('2026-11','2027-02'),['2026-11','2026-12','2027-01','2027-02']);
 assert.deepEqual(monthsThrough('2027-01','2026-12'),[]);
 assert.throws(()=>monthsThrough('2026-13','2027-01'));
});
test('concurrent scheduler repeats create one blank draft without copying previous value or a financial title',async()=>{
 const {db,records}=fixture();
 const result=await Promise.all([provisionPending(db,'r','2026-10'),provisionPending(db,'r','2026-10')]);
 assert.deepEqual(result,[true,false]);
 const d=records.get('payableMonthlyDrafts/'+key('r','2026-10'));
 assert.equal(d.amount,null);assert.equal(d.status,'awaiting-amount');assert.equal(d.valuePaid,undefined);
 assert.equal([...records.keys()].filter(k=>k.startsWith('transactions/')).length,1);
});
test('paused, unactivated, source month and already issued titles never create drafts',async()=>{
 for(const kind of ['paused','unactivated','source','issued']){
 const {db,records}=fixture(),rule=records.get('payableRecurrences/r');
 if(kind==='paused')rule.active=false;
 if(kind==='unactivated')rule.monthlyDrafts=false;
 if(kind==='source')records.get('transactions/r').dueDate='2026-10-10';
 if(kind==='issued')records.set('transactions/native-'+key('r','2026-10'),{});
 assert.equal(await provisionPending(db,'r','2026-10'),false);
 }
});
