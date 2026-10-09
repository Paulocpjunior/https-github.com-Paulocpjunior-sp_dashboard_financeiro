// Immutable, independently reconcilable history. Never writes transactions.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {validateImport}=require('../cloud-run/pdf-download-service/boleto-history.js');
const args=process.argv.slice(2), file=args.find(a=>!a.startsWith('--'));
if(!file)throw new Error('Usage: node scripts/import-boleto-history.mjs payload.json [--apply] [--activate]');
for(const a of args)if(a!==file&&!['--apply','--activate'].includes(a))throw new Error('Unknown argument');
if(args.includes('--activate')&&!args.includes('--apply'))throw new Error('--activate requires --apply');
const bytes=readFileSync(file), payload=JSON.parse(bytes), totals=validateImport(payload);
const snapshot=createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({snapshot,totals,mode:args.includes('--apply')?'apply':'preview'}));
if(!args.includes('--apply'))process.exit(0);
const root='projects/gen-lang-client-0888019226/databases/(default)/documents';
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
function encode(v){
  if(v===null)return {nullValue:null};
  if(typeof v==='boolean')return {booleanValue:v};
  if(typeof v==='number')return Number.isSafeInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(typeof v==='string')return {stringValue:v};
  if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
}
async function call(path,method='GET',body){
  const r=await fetch(`https://firestore.googleapis.com/v1/${root}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`Firestore ${method} failed: HTTP ${r.status}`);
  return r.json();
}
const prefix=`/boletoHistorySnapshots/${snapshot}`;
const meta={schemaVersion:1,environment:'production',sources:payload.sources,issuanceAccounts:payload.issuanceAccounts || {},totals:payload.totals,exportedAt:payload.exportedAt,complete:true};
const old=await call(prefix);
if(!old?.fields?.complete?.booleanValue){
  const chunks=[];
  for(let i=0;i<payload.records.length;i+=250){
    const index=String(i/250).padStart(5,'0'), records=payload.records.slice(i,i+250);
    const path=`${prefix}/chunks/${index}`, data={records};
    const existing=await call(path), fields=encode(data).mapValue.fields;
    if(existing){if(JSON.stringify(existing.fields)!==JSON.stringify(fields)){
      // Firestore may reorder object keys. Compare the canonical record tokens and the stored payload digest instead.
      const digest=createHash('sha256').update(JSON.stringify(records)).digest('hex');
      if(existing.fields?.digest?.stringValue!==digest)throw new Error('Existing chunk differs; preserve snapshot and investigate');
    }}else chunks.push({update:{name:root+path,fields:{...fields,digest:{stringValue:createHash('sha256').update(JSON.stringify(records)).digest('hex')}}},currentDocument:{exists:false}});
  }
  for(let i=0;i<chunks.length;i+=10){await call(':commit','POST',{writes:chunks.slice(i,i+10)});console.log(`Chunks saved: ${Math.min(i+10,chunks.length)}/${chunks.length}`);}
  // Read every chunk back before publishing the completed marker or switching the pointer.
  let count=0,amountCents=0,paidCents=0;
  for(let i=0;i<payload.records.length;i+=250){
    const chunk=await call(`${prefix}/chunks/${String(i/250).padStart(5,'0')}`);
    if(!chunk)throw new Error('Missing chunk');
    for(const entry of chunk.fields.records.arrayValue.values){const f=entry.mapValue.fields;count++;amountCents+=Number(f.amountCents.integerValue);paidCents+=Number(f.paidCents.integerValue||0);}
  }
  if(count!==totals.count||amountCents!==totals.amountCents||paidCents!==totals.paidCents)throw new Error('Persisted totals differ; snapshot not activated');
  await call(':commit','POST',{writes:[{update:{name:root+prefix,fields:encode(meta).mapValue.fields},currentDocument:{exists:false}}]});
}
if(args.includes('--activate')){
  const previous=await call('/boletoHistory/production');
  const previousAt=previous?.fields?.exportedAt?.stringValue;
  if(previousAt && previousAt>payload.exportedAt)throw new Error('Refusing to replace a newer history');
  await call(':commit','POST',{writes:[{update:{name:root+'/boletoHistory/production',fields:encode({snapshot,exportedAt:payload.exportedAt,previousSnapshot:previous?.fields?.snapshot?.stringValue||null}).mapValue.fields},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}}]});
  console.log('History pointer activated; financial transactions were not modified.');
}else console.log('Snapshot saved and verified; not activated.');
