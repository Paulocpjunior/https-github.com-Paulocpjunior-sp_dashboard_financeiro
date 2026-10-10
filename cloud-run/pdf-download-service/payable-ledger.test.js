const {test} = require('node:test');
const assert = require('node:assert/strict');
const {projectPayments,readPaymentLedger} = require('./payable-ledger');
const event = (id,date,amountCents) => ({action:'payment',transactionId:'title',at:'2026-12-01',after:{payableSettlement:{requestId:id,date,amountCents}}});
test('separates partial settlements across months regardless of recording date',()=>{
 const events=[event('a','2026-10-10',50000),event('b','2026-11-10',49500)];
 assert.equal(projectPayments(events,'2026-10-01','2026-10-31').totalCents,50000);
 assert.equal(projectPayments(events,'2026-11-01','2026-11-30').totalCents,49500);
 assert.equal(projectPayments(events,'2026-10-01','2026-11-30').rows.length,2);
});
test('rejects invalid periods, incomplete audit and duplicate payments instead of wrong totals',()=>{
 assert.throws(()=>projectPayments([],'2026-02-30','2026-03-01'));
 assert.throws(()=>projectPayments([],'2026-11-01','2026-10-01'));
 assert.throws(()=>projectPayments([{action:'payment'}],'2026-10-01','2026-10-31'));
 const e=event('a','2026-10-10',1000);
 assert.throws(()=>projectPayments([e,e],'2026-10-01','2026-10-31'));
});
test('reads all pages including old backdated entries and ignores provisioning events',async()=>{
 const docs=Array.from({length:501},(_,i)=>({data:()=>i===500?event('last','2026-10-01',10):{action:'provision'}}));
 const db={collection(){return {orderBy(){return this},limit(){return this},startAfter(c){this.cursor=c;return this},async get(){return {docs:this.cursor?docs.slice(500):docs.slice(0,500)}}}}};
 assert.equal((await readPaymentLedger(db,'2026-10-01','2026-10-01')).totalCents,10);
});
test('reversed payments are excluded even when reversal is recorded outside requested period',()=>{
 const a=event('a','2026-10-10',1000),b=event('b','2026-10-11',500);
 const reversal={action:'payment-reversal',transactionId:'title',at:'2026-11-01',reversal:{paymentRequestId:'a',amountCents:1000}};
 assert.equal(projectPayments([reversal,b,a],'2026-10-01','2026-10-31').totalCents,500);
 assert.throws(()=>projectPayments([reversal,b],'2026-10-01','2026-10-31'));
 assert.throws(()=>projectPayments([reversal,a,reversal],'2026-10-01','2026-10-31'));
});
