const test=require('node:test');const assert=require('node:assert/strict');
const {validateSituation,artifacts,prepareInvite}=require('./boleto-invite');
const pdf=Buffer.from('%PDF-1.4\nsynthetic fixture only\n%%EOF');
const b=()=>({token:'private-provider-token',numero:'001-0',valor:10.01,vencimento:'2099-12-31',situacao:'EM_ABERTO',registro:{situacao:'REGISTRO_CONFIRMADO'},pagador:{nome:'Cliente fictício',cprf:'52998224725'}});
const expected=()=>({token:b().token,number:'001-0',amountCents:1001,dueDate:'2099-12-31',payerDocument:'52998224725'});
const unfold=s=>s.replace(/\r\n /g,'');
test('calendar carries exact PDF bytes, one event, civil due date, reminder and no private credential',()=>{
 const {ics,email}=artifacts(b(),pdf);const flat=unfold(ics);
 assert.equal((flat.match(/BEGIN:VEVENT/g)||[]).length,1);assert.match(flat,/DTSTART;VALUE=DATE:20991231/);assert.match(flat,/DTEND;VALUE=DATE:21000101/);assert.match(flat,/TRIGGER:-PT15H/);
 const encoded=flat.match(/ATTACH;FMTTYPE=application\/pdf;ENCODING=BASE64;VALUE=BINARY:([^\r]+)/)[1];assert.deepEqual(Buffer.from(encoded,'base64'),pdf);
 assert.ok(!ics.includes(b().token));assert.ok(ics.split('\r\n').every(l=>Buffer.byteLength(l)<=75));
 assert.match(email,/X-Unsent: 1/);assert.match(email,/filename="boleto-001-0.pdf"/);assert.match(email,/filename="vencimento-001-0.ics"/);assert.ok(!/^To:|^From:/m.test(email));
 const parts=email.split('Content-Transfer-Encoding: base64\r\n\r\n').slice(1).map(p=>Buffer.from(p.split('\r\n--')[0].replace(/\r\n/g,''),'base64'));
 assert.deepEqual(parts[1],pdf);assert.equal(parts[2].toString(),ics);
});
test('UID stable on downloads, and hostile title input cannot inject properties',()=>{
 const first=unfold(artifacts(b(),pdf).ics);const other=unfold(artifacts({...b(),valor:99},pdf).ics);
 assert.equal(first.match(/UID:([^\r]+)/)[1],other.match(/UID:([^\r]+)/)[1]);
 const bad=unfold(artifacts({...b(),numero:'X\r\nATTENDEE:bad'},pdf).ics);assert.ok(!bad.includes('\r\nATTENDEE:'));
});
test('blocks paid, cancelled, expired, unregistered, wrong identity and changed amount',()=>{
 for(const patch of [{situacao:'PAGO'},{situacao:'BAIXADO'},{pagamento:{valor:10.01}},{baixa:{situacao:'SOLICITADA'}},{registro:null},{registro:{situacao:'REGISTRO_CONFIRMADO',erro:'rejeitado'}},{valor:10},{vencimento:'2020-01-01'},{pagador:{nome:'Outro',cprf:'123'}},{token:'wrong'}])assert.throws(()=>validateSituation({...b(),...patch},expected()));
 assert.equal(validateSituation(b(),expected()).numero,'001-0');
 assert.throws(()=>artifacts(b(),Buffer.from('not pdf')));assert.throws(()=>artifacts(b(),Buffer.concat([pdf,Buffer.alloc(3_000_000)])));
});
test('only provider GET, rechecks bank before returning and rejects races/errors',async()=>{
 let calls=[];let read=0;
 const fetchImpl=async(url,o)=>{calls.push({url,o});return url.endsWith('/situacao')?{ok:true,json:async()=>({boleto:b()})}:{ok:true,arrayBuffer:async()=>pdf};};
 const input={token:b().token,base:'https://provider.invalid/api/v1',apiKey:'secret',expected:expected(),fetchImpl};
 assert.match((await prepareInvite(input)).ics,/BEGIN:VCALENDAR/);assert.equal(calls.length,3);assert.ok(calls[1].url.endsWith('/atualizado/vencimento/2099-12-31'));assert.ok(calls.every(c=>c.o.method==='GET'&&c.o.redirect==='error'));
 await assert.rejects(prepareInvite({...input,fetchImpl:async url=>url.endsWith('/situacao')?{ok:true,json:async()=>({boleto:++read===1?b():{...b(),situacao:'PAGO'}})}:{ok:true,arrayBuffer:async()=>pdf}}),/em aberto/);
 await assert.rejects(prepareInvite({...input,fetchImpl:async()=>({ok:false})}),/Nenhum convite/);
});
