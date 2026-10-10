#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, chmodSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { restoreTypedFields } from './firestore-backup-types.mjs';
import { verifyFinancialBackup } from './verify-financial-backup.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function emulatorEndpoint(host) {
 if (!/^127\.0\.0\.1:\d{2,5}$/.test(host || '')) throw Error('Restauração permitida somente no emulador 127.0.0.1:porta.');
 return `http://${host}/v1/projects/demo-financeiro-restore/databases/(default)/documents/`;
}
export function verifyManifest(path) {
 const root=dirname(resolve(path)), bytes=readFileSync(path);
 if(hash(bytes)!==readFileSync(resolve(root,'manifest.sha256'),'utf8').trim())throw Error('Manifesto adulterado.');
 const manifest=JSON.parse(bytes);
 for(const f of manifest.files){
  const target=resolve(root,f.file);
  if(!target.startsWith(root+sep))throw Error('Caminho fora do pacote.');
  const data=readFileSync(target);
  if(data.length!==f.size||hash(data)!==f.sha256)throw Error('Arquivo divergente: '+f.file);
 }
 if(!manifest.files.some(f=>f.file==='firestore.json'))throw Error('Backup Firestore ausente.');
 return {root,manifest};
}
export function canonicalFields(value) {
 if(Array.isArray(value)) return value.map(canonicalFields);
 if(!value || typeof value!=='object')return value;
 if('timestampValue' in value)return {timestampValue:value.timestampValue.replace(/\.(\d*?)0+Z$/,(_,digits)=>digits?'.'+digits+'Z':'Z')};
 if('arrayValue' in value)return {arrayValue:{values:canonicalFields(value.arrayValue.values||[])}};
 if('mapValue' in value)return {mapValue:{fields:canonicalFields(value.mapValue.fields||{})}};
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonicalFields(v)]));
}
async function main(){
 const input=process.argv[2];if(!input)throw Error('Informe manifest.json ou backup Firestore JSON.');
 const base=emulatorEndpoint(process.env.FIRESTORE_EMULATOR_HOST);
 let snapshot,packageData;
 if(input.endsWith('manifest.json')) {packageData=verifyManifest(input);snapshot=JSON.parse(readFileSync(resolve(packageData.root,'firestore.json'),'utf8'));}
 else {const b=readFileSync(input);if(hash(b)!==readFileSync(input+'.sha256','utf8').split(/\s/)[0])throw Error('Checksum divergente');snapshot=JSON.parse(b);}
 verifyFinancialBackup(snapshot);
 if(!snapshot.preservesFirestoreTypes)throw Error('Exige backup tipado.');
 // Amostra de até três documentos de CADA coleção/subcoleção, nunca produção.
 const selected=snapshot.collections.flatMap(c=>c.documents.slice(0,3));
 let count=0;
 for(const d of selected){
  const relative=d.path.split('/documents/')[1];
  const url=base+relative.split('/').map(encodeURIComponent).join('/');
  const fields=restoreTypedFields(d);
  const response=await fetch(url+'?currentDocument.exists=false',{method:'PATCH',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({fields})});
  if(!response.ok)throw Error('Emulador recusou criação: HTTP '+response.status);
  const check=await fetch(url,{redirect:'error',headers:{Authorization:'Bearer owner'}});
  if(!check.ok)throw Error('Leitura restaurada indisponível.');
  const restored=(await check.json()).fields||{};
  if(!isDeepStrictEqual(canonicalFields(restored),canonicalFields(fields)))throw Error('Conteúdo restaurado divergente: '+Object.keys(fields).filter(k=>!isDeepStrictEqual(canonicalFields(restored[k]),canonicalFields(fields[k]))).join(', '));
  count++;
 }
 let authAccounts=0;
 if(packageData){
  emulatorEndpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const authBase=`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/demo-financeiro-restore/`;
  const users=JSON.parse(readFileSync(resolve(packageData.root,'auth-users.json'),'utf8')).users;
  if(users.length>1000)throw Error('Ensaio Auth limitado a 1000 contas; exige importação paginada para esta base.');
  const {algorithm,...hashConfig}=JSON.parse(readFileSync(resolve(packageData.root,'auth-config.json'),'utf8')).signIn.hashConfig;
  const headers={'Content-Type':'application/json',Authorization:'Bearer owner'};
  // Nada é enviado a um provedor externo. Não sobrescreve usuários do emulador.
  const response=await fetch(authBase+'accounts:batchCreate',{method:'POST',redirect:'error',headers,body:JSON.stringify({users,hashAlgorithm:algorithm,...hashConfig,allowOverwrite:false,sanityCheck:true})});
  const result=await response.json();
  if(!response.ok||result.error?.length)throw Error('Importação Auth no emulador falhou.');
  const read=await fetch(authBase+'accounts:batchGet?maxResults=1000',{headers,redirect:'error'});
  if(!read.ok)throw Error('Consulta Auth no emulador falhou.');
  const actual=(await read.json()).users||[];
  if(actual.length!==users.length)throw Error('Contagem Auth divergente.');
  for(const user of users){
   const restored=actual.find(x=>x.localId===user.localId);
   if(!restored || ['email','disabled','emailVerified','displayName'].some(k=> (restored[k]??(k==='disabled'||k==='emailVerified'?false:''))!==(user[k]??(k==='disabled'||k==='emailVerified'?false:''))))throw Error('Identidade Auth divergente.');
  }
  authAccounts=users.length;
 }
 let files=0;
 if(packageData){
  const dest=mkdtempSync(resolve(tmpdir(),'financeiro-restore-files-'));chmodSync(dest,0o700);
  for(const item of packageData.manifest.storage.objects){
   const source=resolve(packageData.root,item.file);
   if(!source.startsWith(packageData.root+sep))throw Error('Caminho inválido');
   const target=resolve(dest,hash(item.name));copyFileSync(source,target);chmodSync(target,0o600);
   if(hash(readFileSync(target))!==item.sha256)throw Error('Arquivo restaurado divergente');files++;
  }
 }
 const report={verifiedAt:new Date().toISOString(),firestoreReadTime:snapshot.readTime,selectedDocuments:count,totalDocuments:snapshot.counts.totalDocuments,scope:'Até 3 documentos por coleção/subcoleção; arquivos locais do pacote',restoredFiles:files,restoredAuthAccounts:authAccounts,productionWrites:0,authCredentialRestoreTested:false};
 writeFileSync(input+'.restore-drill.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)main().catch(e=>{console.error(e.message);process.exitCode=1;});
