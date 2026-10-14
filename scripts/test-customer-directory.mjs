import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),backend=require('../cloud-run/pdf-download-service/customer-directory');
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
 const {applyCustomerDirectory}=await server.ssrLoadModule('/services/customerDirectory.ts');
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
