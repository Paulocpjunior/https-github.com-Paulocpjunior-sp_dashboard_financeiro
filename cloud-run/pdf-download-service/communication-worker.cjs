// Prepared entry point for a future scheduled job. No scheduler is provisioned by this file.
const {createWorkflow}=require('./communication-workflow');
const {allowed}=require('./native-entries');
async function run({db,env=process.env,now=()=>new Date(),fetchImpl=fetch}){
 if(env.FINANCEIRO_COMMUNICATION_SEND_ENABLED!=='true')return {status:'disabled',processed:0};
 if((await db.collection('financialSettings').doc('communicationRule').get()).data()?.enabled!==true)return {status:'disabled',processed:0};
 const pending=await db.collection('financialCommunications').where('status','in',['queued','sending']).where('scheduledAt','<=',now().toISOString()).orderBy('scheduledAt').limit(50).get();
 const workflow=createWorkflow({db,env,allowed,now,fetchImpl}),counts={};
 for(const item of pending.docs){const result=await workflow.process(item.id);counts[result.status]=(counts[result.status]||0)+1;}
 return {status:'completed',processed:pending.docs.length,counts};
}
if(require.main===module){
 if(process.env.FINANCEIRO_COMMUNICATION_SEND_ENABLED!=='true')console.log(JSON.stringify({status:'disabled',processed:0}));
 else{const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');initializeApp();run({db:getFirestore()}).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Processamento não concluído. Consulte a auditoria antes de repetir.');process.exitCode=1;});}
}
module.exports={run};
