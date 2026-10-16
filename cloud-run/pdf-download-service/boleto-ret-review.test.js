const test=require('node:test'),assert=require('node:assert/strict');
const {candidatesFor,classify}=require('./boleto-ret-review');
const r={payerDocument:'11222333000181',amountCents:1000,dueDate:'2026-10-15',bank:'341'};
const row={movement:'Entrada',cpfCnpj:'11.222.333/0001-81',totalCobranca:10,dueDate:r.dueDate,status:'Pendente',bankAccount:''};
test('exact candidates, ambiguity and missing history are distinguished without mutation',()=>{
 const data=structuredClone(row);let candidates=candidatesFor(r,[{id:'a',data}]);assert.equal(classify(r,candidates),'Correspondência única — revisar baixa');assert.deepEqual(data,row);
 candidates=candidatesFor(r,[{id:'a',data},{id:'b',data}]);assert.equal(classify(r,candidates),'Múltiplos lançamentos compatíveis');assert.equal(classify(r,candidates,true),'Consulta parcial — conferir candidatos');assert.equal(classify(null,[]),'Boleto ausente do histórico');
});
test('payables and excluded rows omitted; name/amount alone do not authorize matching',()=>{
 assert.equal(candidatesFor(r,[{id:'a',data:{...row,movement:'Saída'}},{id:'b',data:{...row,isExcluded:true}}]).length,0);
 const c=candidatesFor(r,[{id:'a',data:{...row,cpfCnpj:'other'}}]);assert.ok(c[0].differences.some(x=>x.includes('CPF/CNPJ')));
 assert.equal(classify(r,c),'Divergência — conferir');
});
test('PIX manual receipts remain divergent and visible',()=>{
 const c=candidatesFor(r,[{id:'a',data:{...row,status:'Pago',valueReceived:10,receivableSettlement:{origin:'manual',method:'Pix'}}}]);
 assert.equal(c[0].method,'Pix');assert.ok(c[0].differences.some(x=>x.includes('manual')));
});
