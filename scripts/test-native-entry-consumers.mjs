import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
const require=createRequire(import.meta.url);
const {buildEntry}=require('../cloud-run/pdf-download-service/native-entries.js');
const {payload}=require('../cloud-run/pdf-download-service/boleto-cloud.js');
const catalog=require('../cloud-run/pdf-download-service/native-entry-catalog.json');
const server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true},appType:'custom',logLevel:'error'});
try{
 const {getOriginalAmount,getPaidAmount,getOutstandingAmount}=await server.ssrLoadModule('/utils/transactionAmounts.ts');
 const client={status:'ready',client:'Cliente fictício',clientNumber:'007',cpfCnpjDigits:'52998224725'};
 const base={kind:'receber',clientRegistryId:'c',bankAccount:catalog.banks[0],date:'2026-10-09',dueDate:'2099-11-20',description:'Serviço fictício',paid:false,paidAmount:'0',honorarios:'100.10',extras:'0.20',extraItems:[{account:catalog.extras[0],amount:'0.10'},{account:catalog.extras[1],amount:'0.10'}],interestRate:'0',deliveryMethod:catalog.deliveryMethods[0]};
 const actor={uid:'test',name:'Teste'};
 for(const kind of ['receber','pagar'])for(const paid of [false,true]){
 const input={...base,kind,paid,paidAmount:paid?'100.30':'0',paymentDate:paid?'2026-10-09':'',amount:'100.30',category:catalog.categories[0],paidBy:catalog.paidBy[0],authorizedBy:catalog.authorizedBy[0],personType:'PJ',paymentMethod:catalog.paymentMethods[0]};
 const row={id:'native-fixture',...buildEntry(input,client,actor).record};
 assert.equal(getOriginalAmount(row),100.3);assert.equal(getPaidAmount(row),paid?100.3:0);assert.equal(getOutstandingAmount(row),paid?0:100.3);
 if(kind==='receber'&&!paid){const fields=payload(row,{cep:'01001000',uf:'SP',localidade:'São Paulo',bairro:'Sé',logradouro:'Praça da Sé',numero:'1',complemento:''});assert.equal(fields['boleto.valor'],'100.30');assert.equal(fields['boleto.pagador.cprf'],client.cpfCnpjDigits);}
 }
 console.log('PASS: recebíveis e despesas nativos compatíveis com total, pago, saldo e payload Boleto Cloud. Sem gravações ou chamadas ao banco.');
}finally{await server.close()}
