const assert=require('node:assert/strict');
const {financialWritePrecondition}=require('./index');
const original=global.fetch;
(async()=>{try{
 for(const marker of ['payableSettlement','payableRecurrence']){
 global.fetch=async()=>({ok:true,json:async()=>({fields:{[marker]:{mapValue:{fields:{}}}},updateTime:'2026-01-01T00:00:00Z'})});
 await assert.rejects(financialWritePrecondition('synthetic','token'),/FINANCEIRO_NATIVE_OWNER/);
 }
 global.fetch=async()=>({ok:true,json:async()=>({fields:{},updateTime:'2026-01-01T00:00:00Z'})});
 assert.equal(await financialWritePrecondition('synthetic','token'),'currentDocument.updateTime=2026-01-01T00%3A00%3A00Z');
 global.fetch=async()=>({status:404});assert.equal(await financialWritePrecondition('synthetic','token'),'currentDocument.exists=false');
 global.fetch=async()=>({ok:false,status:503});await assert.rejects(financialWritePrecondition('synthetic','token'));
 console.log('PASS: native payable ownership, existing-version fencing, create-only precondition and failed reads. No network or financial writes.');
 }finally{global.fetch=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
