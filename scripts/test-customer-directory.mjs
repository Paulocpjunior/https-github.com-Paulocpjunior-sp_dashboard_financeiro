import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),backend=require('../cloud-run/pdf-download-service/customer-directory');
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
 const {applyCustomerDirectory,createCustomerApi}=await server.ssrLoadModule('/services/customerDirectory.ts');
 // Reproduce a restored application profile while Firebase is still initializing.
 let restore, calls=0;
 const mockAuth={currentUser:null,authStateReady:()=>new Promise(resolve=>{restore=resolve;})};
 const api=createCustomerApi(mockAuth,async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer synthetic-token');return {ok:true,json:async()=>({revision:0,entries:{}})};});
 const loading=api('mappings');
 await Promise.resolve();assert.equal(calls,0);
 mockAuth.currentUser={getIdToken:async()=> 'synthetic-token'};restore();
 assert.deepEqual(await loading,{revision:0,entries:{}});assert.equal(calls,1);
 await assert.rejects(createCustomerApi({currentUser:null,authStateReady:async()=>{}},async()=>{throw Error('must not fetch');})('mappings'),e=>e.status===401);
 const denied=createCustomerApi({currentUser:mockAuth.currentUser,authStateReady:async()=>{}},async()=>({ok:false,status:403,json:async()=>({error:'Usuário inativo'})}));
 await assert.rejects(denied('mappings'),e=>e.status===403);
 console.log('OK: aguarda restauração da sessão; ausência real de login e recusa do servidor continuam bloqueadas.');
 const {getOriginalAmount,getOutstandingAmount}=await server.ssrLoadModule('/utils/transactionAmounts.ts');
 const source={id:'a',client:'Cliente – Contato',source:'wix',movement:'Entrada',type:'Entrada',valorOriginal:237,valueReceived:0,valuePaid:0,status:'Pendente',date:'2026-09-25',dueDate:'2026-10-25'};
 const target={id:'b',client:'Cliente',source:'jotform',movement:'Entrada',type:'Entrada',clientNumber:'414',totalCobranca:300,valueReceived:0,valuePaid:0,status:'Pendente',date:'2026-09-17',dueDate:'2026-10-26'};
 const state=backend.change({revision:0,entries:{}},source,target,{action:'merge',reason:'Identificação conferida com a origem'});
 const rows=[structuredClone(source),structuredClone(target)];const before=rows.map(r=>[r.id,r.date,r.dueDate,getOriginalAmount(r),getOutstandingAmount(r)]);
 rows.forEach(r=>applyCustomerDirectory(r,state));
 assert.equal(rows[0].client,'Cliente');assert.equal(rows[0].clientNumber,'414');assert.equal(rows[0].customerOriginal.client,source.client);
 assert.deepEqual(rows.map(r=>[r.id,r.date,r.dueDate,getOriginalAmount(r),getOutstandingAmount(r)]),before);
 rows.forEach(r=>applyCustomerDirectory(r,state));assert.equal(rows[0].customerOriginal.client,source.client);
 const outgoing={...source,movement:'Saída'};applyCustomerDirectory(outgoing,state);assert.equal(outgoing.client,source.client);
 console.log('OK: identidade canônica consistente com servidor; valores, vencimentos, origens e lançamentos preservados.');
}finally{await server.close();}
