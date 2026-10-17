const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('scheduled job allows only RET processing to settle; status refresh cannot bypass a RET exception',async()=>{
 const calls=[];let finish;
 const finished=new Promise(resolve=>finish=resolve);
 const modules={
  'firebase-admin/app':{initializeApp(){}},'firebase-admin/firestore':{getFirestore:()=>({})},
  './boleto-ret-files':{runRetFiles:async o=>{calls.push(['ret',o]);return {review:1};}},
  './boleto-returns':{runReturns:async o=>{calls.push(['native',o]);return {};}},
  './boleto-reconciliation':{runReconciliations:async o=>{calls.push(['historical',o]);return {};}},
  './boleto-history-sync':{runHistorySync:async o=>{calls.push(['history',o]);return {};}}
 };
 vm.runInNewContext(fs.readFileSync(__dirname+'/boleto-return-job.js','utf8'),{require:n=>modules[n],process:{argv:[],env:{BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED:'true'}},Date,console:{log:finish,error:e=>{throw Error(e);}}});
 await finished;
 assert.equal(calls.length,4);assert.equal(calls[0][0],'ret');assert.equal(calls[0][1].env,undefined);
 for(const [kind,o] of calls.filter(([k])=>['native','historical'].includes(k)))assert.equal(o.env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED,'false',kind);
});
