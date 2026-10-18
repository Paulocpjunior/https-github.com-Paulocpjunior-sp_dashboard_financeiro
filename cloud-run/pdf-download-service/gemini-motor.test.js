const test=require('node:test');const assert=require('node:assert/strict');
const motor=require('./gemini-motor');
// Lista no formato do Vertex (nome completo do publisher). O relógio entra por parâmetro.
const T0=Date.parse('2026-10-18T12:00:00Z');
const ok=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const VERTEX=[{name:'publishers/google/models/gemini-4-argon'},{name:'publishers/google/models/gemini-3.8-flash'},{name:'publishers/google/models/gemini-3.8-flash-tts'},{name:'publishers/google/models/gemini-3.5-flash-lite'},{name:'publishers/google/models/gemini-2.5-flash'}];
const base={obterToken:async()=>'t',env:{}};
test.beforeEach(()=>{motor._zerarMotorParaTeste();test.mock.method(console,'log',()=>{});});
test('FiA fica na linha Flash: o mais novo Flash da lista, nunca o Argon nem tts/lite',async()=>{
 assert.equal(await motor.modeloFiA({...base,fetchImpl:async()=>ok({publisherModels:VERTEX}),agora:T0}),'gemini-3.8-flash');
 assert.equal(motor.estadoMotor().origem,'vertex');
});
test('Flash novo publicado entra sem deploy na próxima pergunta (6 h)',async()=>{
 let lista=VERTEX;const fetchImpl=async()=>ok({publisherModels:lista});
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0}),'gemini-3.8-flash');
 lista=[...VERTEX,{name:'publishers/google/models/gemini-4.1-flash'}];
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0+60000}),'gemini-3.8-flash');
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0+motor.TTL_MS+1}),'gemini-4.1-flash');
});
test('lista que falha cai no ID conferido, diz o motivo e pergunta de novo em 5 min',async()=>{
 let falha=true;const fetchImpl=async()=>falha?ok({},403):ok({publisherModels:[...VERTEX,{name:'publishers/google/models/gemini-4.1-flash'}]});
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0}),motor.MODELO_CONFERIDO);
 assert.match(motor.estadoMotor().erroDaLista,/403/);
 falha=false;
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0+motor.TTL_FALHA_MS+1}),'gemini-4.1-flash');
});
test('o env FINANCIAL_AI_MODEL vence e não consulta a lista',async()=>{
 let chamadas=0;const fetchImpl=async()=>{chamadas++;return ok({publisherModels:VERTEX});};
 assert.equal(await motor.modeloFiA({...base,env:{FINANCIAL_AI_MODEL:'gemini-2.5-flash'},fetchImpl,agora:T0}),'gemini-2.5-flash');
 assert.equal(chamadas,0);
});
test('segue a paginação e manda o token',async()=>{
 const pedidos=[];const fetchImpl=async(url,init)=>{pedidos.push({url,auth:init.headers.Authorization});return pedidos.length===1?ok({publisherModels:[VERTEX[0]],nextPageToken:'p2'}):ok({publisherModels:[VERTEX[1]]});};
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0}),'gemini-3.8-flash');
 assert.match(pedidos[1].url,/pageToken=p2/);assert.equal(pedidos[0].auth,'Bearer t');
});
