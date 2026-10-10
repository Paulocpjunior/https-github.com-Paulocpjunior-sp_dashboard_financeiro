const test=require('node:test'),assert=require('node:assert/strict');
const {statement,composition}=require('./receivable-statement');
const {artifacts}=require('./boleto-invite');
const row={source:'native-finance',client:'Cliente de teste',description:'Serviços contábeis',dueDate:'2026-11-10',honorarios:100,valorOriginal:125.5,totalCobranca:125.5,extraItems:[{account:'1-ECD',amount:25.5}]};
test('statement preserves composition and refuses mismatching totals',async()=>{
 assert.equal(composition(row).total,125.5);
 assert.equal(await statement({}),null);
 assert.throws(()=>composition({...row,totalCobranca:126}),/diverge/);
 assert.throws(()=>composition({...row,extraItems:[{account:'',amount:25.5}]}),/inválida/);
 assert.throws(()=>composition({...row,extraItems:[{account:'ECD',amount:-25.5}]}),/inválida/);
 const pdf=await statement(row);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 const a=artifacts({numero:'123',valor:125.5,vencimento:'2026-11-10',token:'test'},Buffer.from('%PDF-test'),new Date(),pdf);
 assert.equal((a.ics.match(/ATTACH;/g)||[]).length,2);
 assert.match(a.email,/demonstrativo-123.pdf/);
 assert.match(a.email,/boleto-123.pdf/);
});
