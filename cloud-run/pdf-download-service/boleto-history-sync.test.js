const test = require('node:test');
const assert = require('node:assert/strict');
const { runHistorySync, candidates } = require('./boleto-history-sync');
const { idFor } = require('./boleto-history');
const env = { BOLETO_CLOUD_ENVIRONMENT:'production', BOLETO_CLOUD_API_KEY:'synthetic',
  BOLETO_CLOUD_CUTOVER_DATE:'2026-01-01', BOLETO_CLOUD_RETURN_ENABLED:'true' };
const row = n => ({token:`synthetic-token-${n}`,number:String(n),createdAt:'2026-01-01',dueDate:'2026-10-09',amountCents:1000,paidAt:null,cancelledAt:null});
function fixture(n=1) {
  const records=Array.from({length:n},(_,i)=>row(i));
  const data=new Map([['boletoHistory/production',{snapshot:'s1'}],['boletoHistorySnapshots/s1',{complete:true,exportedAt:'2026-10-09T00:00:00Z',totals:{count:n}}],['boletoHistorySnapshots/s1/chunks/1',{records}],['transactions/legacy',{status:'Pendente',valueReceived:0}]]);
  const snap=p=>({id:p.split('/').at(-1),data:()=>structuredClone(data.get(p))});
  const doc=p=>({path:p,get:async()=>snap(p)});
  const collection=p=>({doc:id=>doc(`${p}/${id}`),get:async()=>({docs:[...data.keys()].filter(k=>k.startsWith(p+'/')&&k.slice(p.length+1).split('/').length===1).map(snap)})});
  let queue=Promise.resolve();
  const db={collection,runTransaction(fn){const work=queue.then(async()=>{let wrote=false;const writes=[];const result=await fn({get:r=>{assert.equal(wrote,false);return r.get();},set:(r,v)=>{wrote=true;writes.push(()=>data.set(r.path,structuredClone(v)));},update:(r,v)=>{wrote=true;writes.push(()=>data.set(r.path,{...data.get(r.path),...structuredClone(v)}));}});writes.forEach(f=>f());return result;});queue=work.catch(()=>{});return work;}};
  const urls=[];
  const fetchImpl=async(url,opts)=>{urls.push(url);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');const token=decodeURIComponent(url.split('/').at(-2));return {ok:true,json:async()=>({boleto:{token,numero:token.split('-').at(-1),valor:10,vencimento:'2026-10-09',situacao:'PAGO',pagamento:{data:new Date().toISOString().slice(0,10),valor:10,origem:'BANCO',marcadoComoPago:false}}})};};
  return {data,db,records,urls,fetchImpl,run:opts=>runHistorySync({db,env,fetchImpl,...opts})};
}
test('updates historical state without financial writes, preserves native tokens, and leases concurrent runs',async()=>{
 const f=fixture(3);f.data.set('boletoIssues/native',{environment:'production',token:f.records[0].token});
 const results=await Promise.all([f.run(),f.run()]);assert.equal(results.filter(r=>r.busy).length,1);assert.equal(f.urls.length,2);
 assert.deepEqual(f.data.get('transactions/legacy'),{status:'Pendente',valueReceived:0});
 assert.equal([...f.data.keys()].some(k=>k.startsWith('boletoSettlementAudit/')),false);
 assert.equal(f.data.has('boletoHistoryUpdates/'+idFor(f.records[0].token)),false);
 assert.equal(f.data.get('boletoReturnJobs/history-production').remaining,0);
 await f.run();assert.equal([...f.data.keys()].filter(k=>k.startsWith('boletoHistoryUpdates/')).length,2);
});
test('pagination completes all 65 records and resumes without starving the tail',async()=>{
 const f=fixture(65);assert.equal((await f.run()).updated,60);assert.equal(f.data.get('boletoReturnJobs/history-production').remaining,5);
 assert.equal((await f.run()).updated,5);assert.equal(new Set(f.urls).size,65);assert.ok(f.data.get('boletoReturnJobs/history-production').lastCycleSuccessfulAt);
});
test('provider errors preserve history and retry on the following cycle',async()=>{
 const f=fixture();const id=idFor(f.records[0].token);f.data.set('boletoHistoryUpdates/'+id,{syncedAt:'2026-10-09T01:00:00Z',record:f.records[0]});
 const before=structuredClone(f.data.get('boletoHistoryUpdates/'+id));
 assert.equal((await f.run({fetchImpl:async()=>({ok:false,status:429})})).errors,1);
 assert.deepEqual(f.data.get('boletoHistoryUpdates/'+id),before);assert.equal(f.data.get('boletoReturnJobs/history-production').lastCycleErrors,1);
 assert.equal((await f.run()).updated,1);assert.equal(f.data.get('boletoReturnJobs/history-production').lastCycleErrors,0);
});
test('rejects mismatched token, preserves newer response and resets cursor when snapshot changes',async()=>{
 const f=fixture();assert.equal((await f.run({fetchImpl:async()=>({ok:true,json:async()=>({boleto:{token:'wrong'}})})})).errors,1);
 assert.equal(f.data.has('boletoHistoryUpdates/'+idFor(f.records[0].token)),false);
 f.data.set('boletoHistoryUpdates/'+idFor(f.records[0].token),{syncedAt:'2999-01-01T00:00:00Z',record:f.records[0]});
 assert.equal((await f.run()).superseded,1);
 f.data.delete('boletoHistoryUpdates/'+idFor(f.records[0].token));f.data.set('boletoReturnJobs/history-production',{snapshot:'old',cursor:'zzzz'});
 assert.equal((await f.run()).updated,1);
});
test('snapshot changed during request or incomplete chunks cannot overwrite data',async()=>{
 const f=fixture();await assert.rejects(()=>f.run({fetchImpl:async(...args)=>{f.data.set('boletoHistory/production',{snapshot:'new'});return f.fetchImpl(...args);}}),/HISTORY_SYNC_FAILED/);
 assert.equal(f.data.has('boletoHistoryUpdates/'+idFor(f.records[0].token)),false);
 const g=fixture();g.data.get('boletoHistorySnapshots/s1').totals.count=2;await assert.rejects(()=>g.run(),/HISTORY_SYNC_FAILED/);assert.equal(g.urls.length,0);
});
test('dry run performs no writes; deadline leaves progress available and disabled mode does not query',async()=>{
 const f=fixture();const before=structuredClone(f.data);assert.equal((await f.run({dryRun:true})).updated,1);assert.deepEqual(f.data,before);
 assert.equal((await f.run({deadline:Date.now()})).scanned,0);assert.equal(f.data.get('boletoReturnJobs/history-production').remaining,1);
 assert.deepEqual(await f.run({env:{...env,BOLETO_CLOUD_RETURN_ENABLED:'false'}}),{disabled:true});
});
test('candidate selection includes recent settlements for credit but excludes long-closed records',()=>{
 const old={...row(1),paidAt:'2020-01-01'};const recent={...row(2),paidAt:'2026-10-09'};const cancelled={...row(3),cancelledAt:'2020-01-01'};
 assert.deepEqual(candidates([old,recent,cancelled,row(4)],new Map(),new Set(),'2026-01-01',Date.parse('2026-10-10T12:00:00Z')).map(r=>r.number).sort(),['2','4']);
});
