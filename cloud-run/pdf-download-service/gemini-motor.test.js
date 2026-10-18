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

// Codex no #95 (P1): pensamento compatível com o Gemini 3+ e modelo recusado não derruba a FiA.
test('Gemini 3+ recebe thinkingLevel; antes do 3, thinkingBudget 0',async()=>{
 const {versaoDoModelo}=await import('./gemini-modelo.mjs');
 assert.deepEqual(motor.configDePensamento('gemini-3.8-flash',versaoDoModelo),{thinkingLevel:'low'});
 assert.deepEqual(motor.configDePensamento('gemini-4.1-flash',versaoDoModelo),{thinkingLevel:'low'});
 assert.deepEqual(motor.configDePensamento('gemini-2.5-flash',versaoDoModelo),{thinkingBudget:0});
});
test('400 tenta de novo sem configuração de pensamento, no mesmo modelo',async()=>{
 const chamadas=[];const chamar=async(m,p)=>{chamadas.push([m,p]);return p?{ok:false,status:400}:{ok:true,status:200};};
 const r=await motor.gerarComReserva({modelo:'gemini-3.8-flash',chamar,agora:T0});
 assert.equal(r.ok,true);
 assert.deepEqual(chamadas,[['gemini-3.8-flash',{thinkingLevel:'low'}],['gemini-3.8-flash',null]]);
});
test('modelo novo recusado (403) cai no ID conferido na MESMA consulta e sai da escolha por 6 h',async()=>{
 const lista=[...VERTEX,{name:'publishers/google/models/gemini-4.1-flash'}];const fetchImpl=async()=>ok({publisherModels:lista});
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0}),'gemini-4.1-flash');
 const chamar=async m=>m==='gemini-4.1-flash'?{ok:false,status:403}:{ok:true,status:200};
 const r=await motor.gerarComReserva({modelo:'gemini-4.1-flash',chamar,agora:T0});
 assert.equal(r.ok,true);
 assert.equal(motor.estadoMotor().modelo,motor.MODELO_CONFERIDO);
 // Depois de 5 min a lista é lida de novo, mas o recusado continua fora.
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0+motor.TTL_FALHA_MS+1}),'gemini-3.8-flash');
 // Passadas as 6 h, volta a ser candidato.
 assert.equal(await motor.modeloFiA({...base,fetchImpl,agora:T0+motor.TTL_MS+motor.TTL_FALHA_MS+2}),'gemini-4.1-flash');
});
test('erro 5xx do modelo não tira ninguém da escolha nem troca de modelo',async()=>{
 const chamadas=[];const chamar=async m=>{chamadas.push(m);return {ok:false,status:503};};
 const r=await motor.gerarComReserva({modelo:'gemini-3.8-flash',chamar,agora:T0});
 assert.equal(r.status,503);assert.deepEqual(chamadas,['gemini-3.8-flash']);
});
// Família é piso (Codex no sp-plataforma #16): geração seguinte também atende.
test('versaoAtendeAlvo trata a família como piso',async()=>{
 const {versaoAtendeAlvo}=await import('./gemini-modelo.mjs');
 assert.equal(versaoAtendeAlvo('gemini-5-xenon','4'),true);
 assert.equal(versaoAtendeAlvo('gemini-4.1-flash-001','4'),true);
 assert.equal(versaoAtendeAlvo('gemini-3.8-flash','4'),false);
 assert.equal(versaoAtendeAlvo('gemini-3.10-pro','3.8'),true);
});
