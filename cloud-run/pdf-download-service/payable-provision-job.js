const {createHash} = require('node:crypto');
const key = (ruleId,month) => createHash('sha256').update(JSON.stringify(['payable-recurring',ruleId,month])).digest('hex');
function monthsThrough(start,end) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start||'') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(end||'')) throw Error('Vigência inválida.');
  const result=[]; let month=start;
  while(month<=end) {
    if(result.length>=240) throw Error('Mais de 240 competências: revisão necessária.');
    result.push(month); const [y,m]=month.split('-').map(Number);
    month=`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}`;
  }
  return result;
}
async function provisionPending(db, ruleId, month) {
  return db.runTransaction(async tx=>{
    const rule=(await tx.get(db.collection('payableRecurrences').doc(ruleId))).data();
    if(!rule?.active || rule.schedule!=='continuous' || rule.monthlyDrafts!==true || month<rule.start) return false;
    const source=(await tx.get(db.collection('transactions').doc(ruleId))).data();
    if(!source || source.isExcluded || String(source.dueDate).slice(0,7)===month) return false;
    const id=key(ruleId,month), ref=db.collection('payableMonthlyDrafts').doc(id);
    const existing=await tx.get(ref);
    const issued=await tx.get(db.collection('transactions').doc('native-'+id));
    if(existing.exists || issued.exists) return false;
    tx.create(ref,{ruleId,month,description:rule.description||'',status:'awaiting-amount',amount:null,createdAt:new Date().toISOString()});
    return true;
  });
}
async function run(db, month) {
  const rules=await db.collection('payableRecurrences').limit(501).get();
  if(rules.docs.length>500) throw Error('Mais de 500 regras: revisão necessária.');
  let created=0;
  for(const doc of rules.docs) {
    const r=doc.data();
    if(!r.active || r.schedule!=='continuous' || r.monthlyDrafts!==true) continue;
    for(const m of monthsThrough(r.start,month)) if(await provisionPending(db,doc.id,m)) created++;
  }
  await db.collection('payableAutomationStatus').doc('monthly').set({lastSuccessAt:new Date().toISOString(),month,created});
  return created;
}
if(require.main===module) {
  if(process.env.PAYABLE_MONTHLY_DRAFTS_ENABLED!=='true') throw Error('Geração mensal não ativada.');
  const admin=require('firebase-admin');admin.initializeApp();
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date());
  run(admin.firestore(),month).then(n=>console.log(JSON.stringify({created:n,month}))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={run,provisionPending,monthsThrough,key};
