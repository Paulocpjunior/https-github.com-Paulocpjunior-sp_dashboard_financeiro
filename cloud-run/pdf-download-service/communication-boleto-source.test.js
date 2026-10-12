const test=require('node:test');const assert=require('node:assert/strict');
const {createBoletoSource}=require('./communication-boleto-source');
function fixture(){
 let bank={token:'test-token',numero:'1',valor:10,vencimento:'2099-12-31',situacao:'EM_ABERTO',registro:{situacao:'REGISTRO_CONFIRMADO'},pagador:{nome:'Fictício',cprf:'52998224725'}};
 let binding={active:true,revision:'1',token:bank.token,expected:{token:bank.token,number:'1',amountCents:1000,dueDate:bank.vencimento,payerDocument:bank.pagador.cprf},recipient:{email:'test@example.com',confirmedBy:'admin',confirmedAt:'2026-10-11T12:00:00Z'}};
 let reads=0,pdf=Buffer.from('%PDF-1.4 synthetic'),onPdf=()=>{},calls=[];
 const source=createBoletoSource({base:'https://app.boletocloud.com/api/v1',apiKey:'synthetic-secret',loadBinding:async()=>structuredClone(binding),now:()=>new Date('2026-10-12T14:00:00Z'),fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/situacao')){reads++;return {ok:true,json:async()=>({boleto:structuredClone(bank)})};}onPdf();return {ok:true,arrayBuffer:async()=>pdf};}});
 return {source,calls,bank,binding,setPdf:v=>pdf=v,setOnPdf:f=>onPdf=f,job:async()=>({source:await source.readSource({id:'row1',kind:'receivable'}),recipient:{email:'test@example.com'}})};
}
test('prepares exact PDF with GET only, stable revision and no tokens in returned artifacts',async()=>{
 const f=fixture(),job=await f.job(),result=await f.source.prepare(job);
 assert.equal(result.attachments.length,2);assert.match(result.attachments[1].content.toString(),/BEGIN:VCALENDAR/);assert.match(result.text,/R\$\s10,00/);assert.ok(!JSON.stringify(result).includes('test-token'));
 assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'));
});
test('paid, partial, cancelled, unregistered and changed identity never prepare',async()=>{
 for(const patch of [{situacao:'PAGO'},{pagamento:{valor:1}},{baixa:{}},{registro:null},{valor:11},{pagador:{nome:'Outro',cprf:'123'}}]){const f=fixture();Object.assign(f.bank,patch);await assert.rejects(f.job());}
});
test('payment or administrative recipient change while downloading blocks artifacts',async()=>{
 for(const change of [f=>f.bank.pagamento={valor:10},f=>f.binding.recipient.email='other@example.com']){
  const f=fixture(),job=await f.job();f.setOnPdf(()=>change(f));await assert.rejects(f.source.prepare(job));
 }
});
test('changed recipient before preparation, missing binding and invalid PDF fail closed',async()=>{
 const f=fixture(),job=await f.job();f.binding.recipient.email='other@example.com';await assert.rejects(f.source.prepare(job));
 const g=fixture(),j=await g.job();g.setPdf(Buffer.from('<html>error</html>'));await assert.rejects(g.source.prepare(j));g.binding.active=false;await assert.rejects(g.job());
});
test('unconfirmed contacts and arbitrary provider URLs are rejected',async()=>{
 const f=fixture();delete f.binding.recipient.confirmedAt;await assert.rejects(f.job());
 assert.throws(()=>createBoletoSource({base:'https://evil.invalid',apiKey:'secret',loadBinding:async()=>null}));
});
