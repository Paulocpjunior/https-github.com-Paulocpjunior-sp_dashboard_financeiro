const test=require('node:test');
const assert=require('node:assert/strict');
const {report,mergeSituation,validateImport,idFor,createHistoryHandler}=require('./boleto-history');
const row=(extra={})=>({token:'synthetic-token-0001',id:idFor('synthetic-token-0001'),createdAt:'2026-09-20',dueDate:'2026-10-05',amountCents:10000,
  paidCents:null,paidAt:null,creditedAt:null,cancelledAt:null,beneficiaryDocument:'11222333000181',beneficiaryName:'Beneficiário A',payerDocument:'52998224725',payerName:'Pagador Teste',number:'001',document:'fatura',...extra});
const payload=records=>({schemaVersion:1,environment:'production',records,exportedAt:'2026-10-09T10:00:00Z',sources:[{name:'synthetic.XLS',sha256:'a'.repeat(64),count:records.length}],
  totals:{count:records.length,amountCents:records.reduce((n,r)=>n+r.amountCents,0),paidCents:records.reduce((n,r)=>n+(r.paidCents||0),0)}});
test('dashboard preserves overlapping open/overdue and nominal versus paid amounts',()=>{
  const rows=[row(),row({id:'2',token:'synthetic-token-0002',dueDate:'2026-10-15'}),row({id:'3',token:'synthetic-token-0003',dueDate:'2026-09-10',paidAt:'2026-10-02',paidCents:10200,cancelledAt:'2026-10-03'})];
  const r=report(rows,new URLSearchParams({month:'2026-10'}),'2026-10-09');
  assert.equal(r.metrics.open.count,2);assert.equal(r.metrics.overdue.count,1);assert.equal(r.metrics.paidMonth.amountCents,10000);assert.equal(r.metrics.paidMonth.paidCents,10200);assert.equal(r.metrics.dueMonth.count,2);
  assert.ok(r.rows.every(r=>!Object.hasOwn(r,'token')));
});
test('scope and search cannot mix beneficiaries; pagination has no truncation',()=>{
  const rows=Array.from({length:63},(_,i)=>row({id:String(i).padStart(3,'0'),beneficiaryDocument:i===62?'other':'11222333000181'}));
  const r=report(rows,new URLSearchParams({view:'all',beneficiary:'11222333000181',page:'3'}),'2026-10-09');
  assert.equal(r.selected.count,62);assert.equal(r.rows.length,2);assert.equal(r.pages,3);
  assert.throws(()=>report(rows,new URLSearchParams({month:'2026-99'})));
});
test('import refuses overlapping tokens, invalid dates, missing amounts and mismatched controls',()=>{
  assert.equal(validateImport(payload([row()])).count,1);
  for(const records of [[row(),row()],[row({dueDate:'2026-02-30'})],[row({amountCents:null})],[row({paidAt:'invalid'})]])assert.throws(()=>validateImport(payload(records)));
  const p=payload([row()]);p.totals.count=2;assert.throws(()=>validateImport(p));
});
test('API mapping rejects token substitution and incomplete payment without erasing history',()=>{
  const old=row();const b={boleto:{token:old.token,situacao:'PAGO',valor:100,vencimento:'2026-10-05',pagamento:{data:'2026-10-06',valor:101,dataCredito:'2026-10-07'}}};
  const next=mergeSituation(old,b,'now');assert.equal(next.paidCents,10100);assert.equal(next.creditedAt,'2026-10-07');assert.equal(old.paidAt,null);
  assert.throws(()=>mergeSituation(old,{boleto:{...b.boleto,token:'other'}},'now'));
  assert.throws(()=>mergeSituation(old,{boleto:{...b.boleto,pagamento:null}},'now'));
});
function fixture(fetchImpl=async()=>{throw new Error('Unexpected provider call');}){
  const data=new Map([['users/u',{active:true,role:'admin'}],['boletoHistory/production',{snapshot:'s'}],['boletoHistorySnapshots/s',{...payload([row()]),complete:true}],['boletoHistorySnapshots/s/chunks/0',{records:[row()]}],['transactions/unchanged',{amount:42}]]);
  let seq=0;
  const snap=p=>({id:p.split('/').at(-1),data:()=>structuredClone(data.get(p))});
  const collection=p=>({doc:(id)=>document(`${p}/${id||++seq}`),get:async()=>({docs:[...data.keys()].filter(k=>k.startsWith(p+'/')&&k.slice(p.length+1).split('/').length===1).map(snap)}),where:(key,op,value)=>({get:async()=>({docs:[...data.keys()].filter(k=>k.startsWith(p+'/')&&k.slice(p.length+1).split('/').length===1&&data.get(k)?.[key]===value).map(snap)})})});
  const document=p=>({path:p,get:async()=>snap(p),collection:n=>collection(`${p}/${n}`)});
  const db={collection,runTransaction:async fn=>{const writes=[];const value=await fn({get:r=>r.get(),set:(r,v)=>writes.push([r.path,v])});for(const [p,v]of writes)data.set(p,v);return value;}};
  const handler=createHistoryHandler({getServices:()=>({adminAuth:{verifyIdToken:async()=>({uid:'u'})},adminDb:db}),env:{BOLETO_CLOUD_ENVIRONMENT:'production',BOLETO_CLOUD_API_KEY:'synthetic-secret'},fetchImpl,sendJson:(_q,r,status,body)=>Object.assign(r,{status,body})});
  return {data,async call(url='/api/boleto-cloud/history',method='GET',auth='Bearer synthetic'){const r={writeHead(status,headers){Object.assign(this,{status,headers});},end(body){this.body=body;}};await handler({url,method,headers:{authorization:auth}},r);return r;}};
}
test('history permission is independent from issuance and rejects inactive or blocked users',async()=>{
  const f=fixture();assert.equal((await f.call(undefined,undefined,'')).status,401);
  for(const p of [{active:false,role:'admin'},{active:true,role:'admin',status:'blocked'},{active:true,role:'operator',financialPermissions:['billing.boleto-cloud.issue']}]){f.data.set('users/u',p);assert.equal((await f.call()).status,403);}
  f.data.set('users/u',{active:true,role:'operator',financialPermissions:['billing.boleto-cloud.history.read']});assert.equal((await f.call()).status,200);
});
test('sync uses only provider GET and updates only the separate history and audit',async()=>{
  const f=fixture(async(url,options)=>{assert.equal(options.method,'GET');assert.ok(url.endsWith('/situacao'));return {ok:true,json:async()=>({boleto:{token:row().token,situacao:'EM_ABERTO',valor:100,vencimento:'2026-10-05'}})};});
  const r=await f.call(`/api/boleto-cloud/history/${row().id}/sync`,'POST');assert.equal(r.status,200);assert.deepEqual(f.data.get('transactions/unchanged'),{amount:42});assert.ok(f.data.has(`boletoHistoryUpdates/${row().id}`));
});
test('failure or revocation during provider call preserves the previous snapshot',async()=>{
  let f=fixture(async()=>({ok:false,status:404}));assert.equal((await f.call(`/api/boleto-cloud/history/${row().id}/sync`,'POST')).status,502);assert.equal(f.data.has(`boletoHistoryUpdates/${row().id}`),false);
  f=fixture(async()=>{f.data.set('users/u',{active:false,role:'admin'});return {ok:true};});assert.equal((await f.call(`/api/boleto-cloud/history/${row().id}/sync`,'POST')).status,403);assert.equal(f.data.has(`boletoHistoryUpdates/${row().id}`),false);
});

test('baixa uses the bank date or the system date returned by the provider',()=>{
  const body={boleto:{token:row().token,situacao:'BAIXADO',valor:100,vencimento:'2026-10-05',baixa:{dataBanco:'2026-10-07',dataSistema:'2026-10-08'}}};
  assert.equal(mergeSituation(row(),body,'now').cancelledAt,'2026-10-07');
  body.boleto.baixa.dataBanco=null;
  assert.equal(mergeSituation(row(),body,'now').cancelledAt,'2026-10-08');
});

test('new app issues use only the verified account mapping and do not duplicate imported tokens',async()=>{
  const f=fixture(), meta=f.data.get('boletoHistorySnapshots/s');
  meta.issuanceAccounts={verified:{bank:'341',beneficiaryDocument:'11222333000181',beneficiaryName:'Beneficiário A'}};
  const issue={environment:'production',state:'issued',accountFingerprint:'verified',token:'synthetic-new-issue',fields:{'boleto.emissao':'2026-10-09','boleto.vencimento':'2026-10-20','boleto.valor':'120.50','boleto.pagador.nome':'Novo pagador','boleto.pagador.cprf':'52998224725'}};
  f.data.set('boletoIssues/new',issue);f.data.set('boletoIssues/existing',{...issue,token:row().token});
  const r=await f.call('/api/boleto-cloud/history?view=all');
  assert.equal(r.body.selected.count,2);assert.equal(r.body.selected.amountCents,22050);assert.equal(r.body.selected.unidentifiedBeneficiaries,0);
  const other=fixture();other.data.set('boletoIssues/new',issue);
  assert.equal((await other.call('/api/boleto-cloud/history?view=all')).body.selected.unidentifiedBeneficiaries,1);
});

test('protest dates and cancellation status remain distinct from payment status',()=>{
  const b={boleto:{token:row().token,situacao:'EM_ABERTO',valor:100,vencimento:'2026-10-05',protesto:{situacao:'CANCELAMENTO_CONFIRMADO',dataBanco:'2026-10-08',dataSistema:'2026-10-09'}}};
  const r=mergeSituation(row(),b,'now');assert.equal(r.protestedAt,'2026-10-08');assert.equal(r.protestStatus,'CANCELAMENTO_CONFIRMADO');assert.equal(r.cancelledAt,null);
});
test('automation reports stale state and attention without exposing internal identifiers',async()=>{
  const f=fixture();f.data.set('boletoReturnJobs/production',{state:'error',startedAt:'2020-01-01T00:00:00Z',settlementEnabled:true,lease:'secret-lease'});
  f.data.set('boletoIssues/problem',{environment:'production',state:'draft',number:'123',token:'private-token',returnSync:{state:'review',reason:'Conferir valor.',checkedAt:'2026-10-09T10:00:00Z',internal:'private-value'}});
  const r=await f.call();assert.equal(r.body.automation.stale,true);assert.equal(r.body.automation.attentionCount,1);
  assert.equal(r.body.automation.attention[0].reason,'Conferir valor.');
  assert.ok(!JSON.stringify(r.body).includes('private'));assert.ok(!JSON.stringify(r.body).includes('secret-lease'));
});


test('INVITE authenticates, returns the attached PDF and does not write financial data',async()=>{
 const record=row({dueDate:'2099-12-31'});
 const f=fixture(async url=>url.endsWith('/situacao')?{ok:true,json:async()=>({boleto:{token:record.token,numero:record.number,valor:100,vencimento:record.dueDate,situacao:'EM_ABERTO',registro:{situacao:'REGISTRO_CONFIRMADO'},pagador:{nome:record.payerName,cprf:record.payerDocument}}})}:{ok:true,arrayBuffer:async()=>Buffer.from('%PDF-1.4 synthetic')});
 f.data.set('boletoHistorySnapshots/s/chunks/0',{records:[record]});
 const route=`/api/boleto-cloud/history/${record.id}/invite`;
 assert.equal((await f.call(route,'GET','')).status,401);
 const before=structuredClone([...f.data]);const response=await f.call(route);
 assert.equal(response.status,200);assert.match(response.headers['Content-Type'],/text\/calendar/);assert.match(response.body,/ATTACH;FMTTYPE=application\/pdf/);assert.deepEqual([...f.data],before);
 const draft=await f.call(route+'-email');assert.equal(draft.status,200);assert.match(draft.body,/X-Unsent: 1/);
 f.data.set('users/u',{active:false,role:'admin'});assert.equal((await f.call(route)).status,403);
});

test('INVITE history blocks excluded linked transactions without contacting provider',async()=>{
 const f=fixture();const record=row({dueDate:'2099-12-31',transactionId:'excluded'});
 f.data.set('boletoHistorySnapshots/s/chunks/0',{records:[record]});f.data.set('transactions/excluded',{isExcluded:true});
 assert.equal((await f.call(`/api/boleto-cloud/history/${record.id}/invite`)).status,409);
});
