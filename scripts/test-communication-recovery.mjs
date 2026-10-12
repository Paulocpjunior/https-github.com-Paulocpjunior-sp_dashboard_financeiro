// Integration/restore drill: synthetic data, localhost emulator only. Never uses production credentials.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {emulatorEndpoint} from './restore-financial-drill.mjs';
import {collectTypeOverrides} from './firestore-backup-types.mjs';
const base=emulatorEndpoint(process.env.FIRESTORE_EMULATOR_HOST);
const require=createRequire(new URL('../cloud-run/pdf-download-service/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
initializeApp({projectId:'demo-financeiro-restore'});const db=getFirestore();
const {createWorkflow}=require('./communication-workflow'),{compile,importCatalog}=require('./communication-catalog');
const sha=v=>createHash('sha256').update(v).digest('hex');
const userRef=db.collection('users').doc('communication-drill-admin');await userRef.create({active:true,role:'admin'});
const pdf=Buffer.from('%PDF-synthetic-restoration');
const entry={movement:'Saída',status:'Pendente',valorOriginal:20,dueDate:'2099-12-31',description:'Fornecedor fictício',attachments:[{type:'application/pdf',sha256:sha(pdf)}]};
await db.collection('transactions').doc('communication-drill-payable').create(entry);
await db.collection('financialSettings').doc('communicationRule').create({revision:1,offsets:[],payableRecipients:['internal@example.com'],enabled:false});
const catalog={format:'boleto-payers-v1',sourceName:'synthetic.xls',sourceSha256:sha('synthetic'),rows:[{name:'Fictício',document:'52998224725',emails:['a@example.com','b@example.com']}]};
const allowed=p=>p?.active===true&&p.role==='admin',now=()=>new Date('2026-10-12T15:00:00Z');
await importCatalog({db,input:catalog,uid:userRef.id,userRef,allowed,reason:'Cadastro fictício para restauração',expectedRevision:null,reviewToken:compile(catalog).revision,now});
const id='a'.repeat(64),bank={token:'synthetic-token',numero:'1',valor:10,vencimento:'2099-12-31',situacao:'EM_ABERTO',registro:{situacao:'REGISTRO_CONFIRMADO'},pagador:{nome:'Fictício',cprf:'52998224725'}};
const env={BOLETO_CLOUD_ENVIRONMENT:'production',BOLETO_CLOUD_CUTOVER_DATE:'2026-01-01',BOLETO_CLOUD_API_KEY:'synthetic',BOLETO_CLOUD_ACCOUNT_TOKEN:'synthetic',NATIVE_ENTRY_ATTACHMENT_BUCKET:'synthetic'};
const hashJSON=v=>sha(JSON.stringify(v));
const workflow=createWorkflow({db,env,allowed,now,getBucket:()=>({file:()=>({download:async()=>[pdf]})}),fetchImpl:async url=>url.endsWith('/situacao')?{ok:true,json:async()=>({boleto:bank})}:{ok:true,arrayBuffer:async()=>pdf},readHistory:async()=>({rows:[{id,token:bank.token,number:'1',payerName:'Fictício',payerDocument:'52998224725',amountCents:1000,dueDate:bank.vencimento,beneficiaryDocument:'12345678000199',bank:'341'}],meta:{issuanceAccounts:{[hashJSON('synthetic')]:{beneficiaryDocument:'12345678000199',bank:'341'}}}})});
for(const [kind,historyId,emails] of [['receivable',id,['a@example.com','b@example.com']],['payable','communication-drill-payable',['internal@example.com']]]){
 const p=await workflow.preview({kind,historyId,emails},userRef.id);assert.equal(p.planned[0].scheduledAt,null);await workflow.saveDraft(p,userRef.id,userRef,'Confirmação fictícia para ensaio');
 const validation=await workflow.validate(p.planned[0].id,userRef.id,userRef);assert.equal(validation.status,'ready');assert.equal(validation.attachments.length,2);
 await workflow.manage(p.planned[0].id,'cancel',userRef.id,userRef,'Cancelamento fictício no ensaio');assert.equal((await workflow.process(p.planned[0].id)).status,'disabled');
}
assert.deepEqual((await db.collection('transactions').doc('communication-drill-payable').get()).data(),entry);
const names=['financialSettings','financialCommunicationContacts','financialCommunications','financialCommunicationEvents'];
const decode=v=>'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'nullValue'in v?null:'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'arrayValue'in v?(v.arrayValue.values||[]).map(decode):'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):v.timestampValue;
const collections=[];
for(const name of names){const docs=(await db.collection(name).get()).docs;const documents=[];for(const doc of docs){const r=await fetch(base+name+'/'+doc.id);assert(r.ok);const raw=await r.json();documents.push({path:raw.name,data:Object.fromEntries(Object.entries(raw.fields).map(([k,v])=>[k,decode(v)])),typeOverrides:collectTypeOverrides(raw.fields)});}collections.push({name,count:documents.length,documents});}
const snapshot={schemaVersion:2,preservesFirestoreTypes:true,projectId:'demo-financeiro-restore',database:'(default)',readTime:now().toISOString(),scope:{firestore:names},counts:{collections:collections.length,totalDocuments:collections.reduce((n,c)=>n+c.count,0)},collections};
const out=resolve(mkdtempSync(resolve(tmpdir(),'communication-recovery-')),'snapshot.json'),bytes=JSON.stringify(snapshot);writeFileSync(out,bytes,{mode:0o600});writeFileSync(out+'.sha256',sha(bytes),{mode:0o600});
// Remove only synthetic documents just captured, from the validated local emulator.
for(const c of collections)for(const d of c.documents){const response=await fetch(base+c.name+'/'+d.path.split('/').at(-1),{method:'DELETE'});assert(response.ok);}
const run=spawnSync(process.execPath,['scripts/restore-financial-drill.mjs',out],{encoding:'utf8',env:process.env});assert.equal(run.status,0,run.stderr);console.log(run.stdout.trim());
console.log(JSON.stringify({integration:'passed',sources:['receivable','payable'],financialDataUnchanged:true,emailsSent:0,backup:out,productionWrites:0}));await db.terminate();
