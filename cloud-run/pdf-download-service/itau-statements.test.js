const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOfx, classifyRows, ACCOUNT } = require('./itau-ofx');
const { createStatementHandler, permitted, interval } = require('./itau-statements');

// Synthetic fixtures only. Real Itaú export still required for bank-format homologation.
const entry = (id, amount = '-1234.56', date = '20260915120000[-3:BRT]') => `<STMTTRN><TRNTYPE>OTHER\n<DTPOSTED>${date}\n<TRNAMT>${amount}\n<FITID>${id}\n<NAME>Fornecedor teste\n<MEMO>Descrição original\n</STMTTRN>`;
const ofx = (entries = entry('FIT-1') + entry('FIT-2', '2000.00')) => `OFXHEADER:100\nENCODING:UTF-8\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL\n<BANKACCTFROM><BANKID>0341\n<BRANCHID>3145\n<ACCTID>099791-6\n<ACCTTYPE>CHECKING\n</BANKACCTFROM><BANKTRANLIST><DTSTART>20260901000000\n<DTEND>20260930235959\n${entries}</BANKTRANLIST><LEDGERBAL><BALAMT>765.44\n<DTASOF>20260930235959\n</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const parse = value => parseOfx(Buffer.from(value));
const operator = { active: true, role: 'operacional', financialPermissions: ['itau.openfinance.read','itau.statement.import'] };

test('preserves cents, source sign, identifiers, descriptions and dated bank balance', () => {
  const result = parse(ofx());
  assert.equal(result.accountId, ACCOUNT);
  assert.equal(result.rows[0].amountCents, -123456);
  assert.equal(result.rows[0].type, 'OTHER');
  assert.equal(result.rows[0].memo, 'Descrição original');
  assert.deepEqual(result.totals, { credits:200000, debits:-123456 });
  assert.deepEqual(result.ledgerBalance, { amountCents:76544, date:'2026-09-30' });
});
test('supports XML leaves, SGML, declared legacy encoding and combined account identity', () => {
  const xml = ofx().replace(/<([A-Z]+)>([^<\n]+)\n/g,'<$1>$2</$1>');
  assert.deepEqual(parse(xml).rows, parse(ofx()).rows);
  assert.equal(parse(ofx().replace('<BRANCHID>3145\n','').replace('099791-6','3145997916')).rows.length,2);
  const latin = ofx().replace('ENCODING:UTF-8','ENCODING:USASCII\nCHARSET:1252');
  assert.equal(parseOfx(Buffer.from(latin,'latin1')).rows[0].memo,'Descrição original');
});
test('refuses wrong or ambiguous bank account and foreign currency', () => {
  for (const value of [ofx().replace('0341','0237'),ofx().replace('3145','3146'),ofx().replace('099791-6','099791-5'),ofx().replace('<BRANCHID>3145\n',''),ofx().replace('BRL','USD'),ofx().replace('CHECKING','SAVINGS')]) assert.throws(() => parse(value));
});
test('refuses invalid amounts, missing identifiers, corrections and malformed transactions', () => {
  for (const value of [ofx().replace('-1234.56','-1.234,56'),ofx().replace('-1234.56','12.345'),ofx().replace('<FITID>FIT-1','<NOID>FIT-1'),ofx().replace('</STMTTRN>',''),ofx(entry('repeat')+entry('repeat')),ofx().replace('<NAME>','<CORRECTFITID>old\n<NAME>'),ofx().replace('<OFX>','<!DOCTYPE x><OFX>')]) assert.throws(() => parse(value));
});
test('refuses invalid dates, dates outside source period, multiple accounts and oversized files', () => {
  for (const value of [ofx().replace('20260915','20260931'),ofx().replace('20260915','20260831'),ofx().replace('20260901000000','20261001000000'),ofx().replace('</STMTRS>',''),ofx().replace('</OFX>',ofx().match(/<STMTRS>[\s\S]*<\/STMTRS>/)[0]+'</OFX>'),ofx(Array.from({length:401},(_,i)=>entry(`id-${i}`)).join(''))]) {
    assert.throws(() => parse(value));
  }
  assert.throws(() => parseOfx(Buffer.alloc(2*1024*1024+1)));
});
test('missing balance is unknown; empty valid statement is accepted', () => {
  assert.equal(parse(ofx('').replace(/<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>/,'')).ledgerBalance,null);
  assert.equal(parse(ofx('')).rows.length,0);
});
test('overlapping imports classify exact matches and divergent FITIDs without replacing them', () => {
  const rows = parse(ofx()).rows;
  const result = classifyRows(rows,[rows[0],{ ...rows[1], fingerprint:'different' }]);
  assert.equal(result.fresh.length,0); assert.equal(result.duplicates.length,1); assert.deepEqual(result.conflicts,['FIT-2']);
});
test('permissions default deny, require explicit active state and separate read/import', () => {
  for (const profile of [null,{}, {...operator,active:false}, {...operator,active:undefined}, {...operator,status:'deleted'}, {...operator,status:'blocked'}]) assert.equal(permitted(profile,'itau.openfinance.read'),false);
  assert.equal(permitted({...operator,financialPermissions:['itau.openfinance.read']},'itau.statement.import'),false);
  assert.equal(permitted({active:true,role:'admin'},'itau.statement.import'),true);
  assert.throws(()=>interval('2026-02-30','2026-03-01'));
  assert.throws(()=>interval('2026-01-01','2026-09-30'));
});

function harness(profile = { ...operator, role: 'admin' }) {
  const store = new Map([['users/u1',profile]]);
  let sequence = 0, queryCount = 0, queue = Promise.resolve();
  const snap = ref => ({ id:ref.path.split('/').pop(), exists:store.has(ref.path), data:()=>store.get(ref.path) });
  const doc = path => ({ path, get:async()=>snap({path}), collection:name=>collection(`${path}/${name}`) });
  const query = (path, filters = [], order = '', direction = 'asc', limit = 100000) => ({
    where:(key,op,value)=>query(path,[...filters,[key,op,value]],order,direction,limit),
    orderBy:(key,dir='asc')=>query(path,filters,key,dir,limit),
    limit:n=>query(path,filters,order,direction,n),
    get:async()=>{
      queryCount++;
      const rows=[...store.entries()].filter(([key])=>key.startsWith(`${path}/`) && key.slice(path.length+1).indexOf('/')===-1).map(([path,v])=>({...v,__mockId:path.split('/').pop()}))
        .filter(r=>filters.every(([key,op,value])=>op==='=='?r[key]===value:op==='>='?r[key]>=value:r[key]<=value))
        .sort((a,b)=>String(a[order]).localeCompare(String(b[order]))*(direction==='desc'?-1:1)).slice(0,limit);
      return {size:rows.length,docs:rows.map(({__mockId,...r})=>({id:__mockId,data:()=>r}))};
    },
  });
  const collection = path => ({ ...query(path), doc:(id)=>doc(`${path}/${id || `audit-${++sequence}`}`), add:async data=>store.set(`${path}/audit-${++sequence}`, data) });
  const db = {
    collection,
    getAll:async(...refs)=>refs.map(snap),
    runTransaction: fn => {
      const run = queue.then(async()=>{
        const writes=[];
        const result=await fn({ get:async ref=>snap(ref), getAll:async(...refs)=>refs.map(snap), create:(ref,data)=>writes.push([ref.path,data,'create']),set:(ref,data)=>writes.push([ref.path,data,'set']),update:(ref,data)=>writes.push([ref.path,{...store.get(ref.path),...data},'set']),delete:ref=>writes.push([ref.path,null,'delete']) });
        for(const [path,,mode] of writes) if(mode==='create') assert.equal(store.has(path),false,'create must not overwrite');
        writes.forEach(([path,data,mode])=>mode==='delete'?store.delete(path):store.set(path,data));
        return result;
      });
      queue=run.catch(()=>{}); return run;
    },
  };
  const handler=createStatementHandler({ getServices:()=>({adminDb:db,adminAuth:{verifyIdToken:async token=>{if(token!=='valid')throw new Error('revoked'); return {uid:'u1'};}}}),readBody:async request=>Buffer.from(JSON.stringify(request.body)),sendJson:(_req,res,status,body)=>Object.assign(res,{status,body}) });
  const call=async(path,body,token='valid',method='POST')=>{const res={};await handler({url:`/api/itau/${path}`,method,headers:{authorization:token?`Bearer ${token}`:''},body},res);return res;};
  return {store,call,getQueryCount:()=>queryCount};
}
const file = (content=ofx())=>({base64:Buffer.from(content).toString('base64'),fileName:'teste.ofx'});
test('HTTP auth denies anonymous, revoked tokens and unauthorized imports before data access', async()=>{
  const h=harness({...operator,financialPermissions:['itau.openfinance.read']});
  assert.equal((await h.call('preview',file(),'')).status,401);
  assert.equal((await h.call('preview',file(),'revoked')).status,401);
  assert.equal((await h.call('preview',file())).status,403);
  const denied=harness({...operator,active:false});
  assert.equal((await denied.call('statements?start=2026-09-01&end=2026-09-30',null,'valid','GET')).status,403);
  assert.equal(denied.getQueryCount(),0);
});
test('preview does not save movements; confirmation is required and replay is idempotent',async()=>{
  const h=harness(); const f=file(); const preview=await h.call('preview',f);
  assert.equal(preview.status,200); assert.equal(preview.body.newCount,2);
  assert.equal([...h.store.keys()].filter(k=>k.includes('/entries/')).length,0);
  assert.equal((await h.call('import',f)).status,400);
  const payload={...f,confirmHash:preview.body.fileHash};
  const [first,second]=await Promise.all([h.call('import',payload),h.call('import',payload)]);
  assert.equal(first.body.inserted,2); assert.equal(second.body.inserted,0); assert.equal(second.body.alreadyImported,true);
  assert.equal([...h.store.keys()].filter(k=>k.includes('/entries/')).length,2);
  assert.equal([...h.store.keys()].filter(k=>k.includes('/imports/')).length,1);
  assert.ok([...h.store.keys()].some(k=>k.startsWith('bankStatementAudit/')));
});
test('overlap adds only new FITIDs; conflict blocks entire import; access revoked after preview blocks commit',async()=>{
  const h=harness(); const initial=file(); const first=await h.call('preview',initial);
  await h.call('import',{...initial,confirmHash:first.body.fileHash});
  const overlap=file(ofx(entry('FIT-1')+entry('FIT-3','10.00'))); const p=await h.call('preview',overlap);
  assert.equal(p.body.duplicateCount,1); assert.equal(p.body.newCount,1);
  assert.equal((await h.call('import',{...overlap,confirmHash:p.body.fileHash})).body.inserted,1);
  const conflict=file(ofx(entry('FIT-1','999.00')+entry('FIT-4'))); const c=await h.call('preview',conflict);
  assert.deepEqual(c.body.conflicts,['FIT-1']);
  assert.equal((await h.call('import',{...conflict,confirmHash:c.body.fileHash})).status,409);
  assert.equal([...h.store.keys()].filter(k=>k.includes('/entries/')).length,3);
  h.store.set('users/u1',{...operator,active:false});
  assert.equal((await h.call('import',{...overlap,confirmHash:p.body.fileHash})).status,403);
});

test('consultation filters dates, audits reads and refuses truncated results',async()=>{
  const h=harness({...operator,role:'admin',financialPermissions:['itau.openfinance.read']});
  h.store.set(`bankStatements/${ACCOUNT}/entries/a`,{date:'2026-09-15',amountCents:100});
  h.store.set(`bankStatements/${ACCOUNT}/entries/b`,{date:'2026-08-15',amountCents:200});
  const result=await h.call('statements?start=2026-09-01&end=2026-09-30',null,'valid','GET');
  assert.equal(result.status,200);assert.equal(result.body.rows.length,1);
  assert.ok([...h.store.values()].some(v=>v.action==='read'&&v.userId==='u1'));
  assert.equal((await h.call('statements?start=2026-09-31&end=2026-10-01',null,'valid','GET')).status,400);
  for(let i=0;i<1001;i++)h.store.set(`bankStatements/${ACCOUNT}/entries/large-${i}`,{date:'2026-09-15'});
  assert.equal((await h.call('statements?start=2026-09-01&end=2026-09-30',null,'valid','GET')).status,400);
});
test('rejects bank error status and unclosed duplicate statement block',()=>{
  assert.throws(()=>parse(ofx().replace('<STMTTRNRS>','<STMTTRNRS><STATUS><CODE>2000<SEVERITY>ERROR</STATUS>')));
  assert.throws(()=>parse(ofx().replace('</OFX>','<STMTRS></OFX>')));
});

test('operational users cannot read bank data even with legacy permissions', async()=>{
  const h=harness(operator);
  for(const route of ['statements?start=2026-09-01&end=2026-09-30','reconciliation?start=2026-09-01&end=2026-09-30']) assert.equal((await h.call(route,null,'valid','GET')).status,403);
  for(const route of ['preview','import','reconciliation']) assert.equal((await h.call(route,file())).status,403);
  assert.equal(h.getQueryCount(),0);
});

const { source, suggest } = require('./reconciliation');
const receivable={movement:'Entrada',type:'Entrada de Caixa / Contas a Receber',dueDate:'2026-09-15',date:'2026-09-01',client:'Cliente teste',totalCobranca:120.50,valueReceived:120.50,status:'Pendente'};
test('suggestions preserve direction, cents, ambiguity and require dated source evidence',()=>{
  const a=source(receivable,'a'), b=source(receivable,'b');
  assert.equal(a.amountCents,12050);
  assert.equal(source({...receivable,dueDate:''},'missing'),null);
  assert.equal(source({...receivable,isExcluded:true},'excluded'),null);
  assert.equal(source({...receivable,type:'Saída de Caixa / Contas a Pagar'},'conflict'),null);
  assert.equal(source({...receivable,totalCobranca:0,valueReceived:0},'empty'),null);
  assert.equal(suggest({date:'2026-09-15',amountCents:12050},[a,b]).length,2);
  assert.equal(suggest({date:'2026-09-15',amountCents:-12050},[a,b]).length,0);
  assert.equal(suggest({date:'2026-09-20',amountCents:12050},[a]).length,0);
  const c=source({...receivable,cpfCnpj:'12.345.678/0001-90'},'c');
  const suggestions=suggest({date:'2026-09-15',amountCents:12500,memo:'CNPJ 12.345.678/0001-90'},[c]);
  assert.equal(suggestions[0].differenceCents,450);
});
async function reconciliationSetup(){
  const h=harness(); const f=file(ofx(entry('FIT-1','120.50')+entry('FIT-2','120.50')));
  const p=await h.call('preview',f);await h.call('import',{...f,confirmHash:p.body.fileHash});
  h.store.set('transactions/receipt',structuredClone(receivable));
  return h;
}
const readReconciliation=h=>h.call('reconciliation?start=2026-09-01&end=2026-09-30',null,'valid','GET');
const confirmation=row=>({action:'confirm',entryId:row.id,transactionId:row.candidates[0].id,bankFingerprint:row.bankFingerprint,sourceFingerprint:row.candidates[0].fingerprint,reason:'Conferido com o comprovante'});
test('reconciliation requires review, prevents concurrent double links and never changes financial source',async()=>{
  const h=await reconciliationSetup(); const before=structuredClone(h.store.get('transactions/receipt'));
  const list=await readReconciliation(h);assert.equal(list.status,200);
  assert.equal(list.body.rows[0].link,null);
  const [a,b]=await Promise.all(list.body.rows.map(row=>h.call('reconciliation',confirmation(row))));
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.deepEqual(h.store.get('transactions/receipt'),before);
  let result=await readReconciliation(h);const linked=result.body.rows.find(r=>r.link);
  assert.equal(result.body.rows.filter(r=>r.link).length,1);
  assert.equal(result.body.rows.find(r=>!r.link).candidates.length,0);
  h.store.set('transactions/receipt',{...before,totalCobranca:130});
  result=await readReconciliation(h);assert.equal(result.body.rows.find(r=>r.link).stale,true);
  assert.equal((await h.call('reconciliation',{action:'undo',entryId:linked.id,reason:'Valor alterado na origem'})).status,200);
  assert.equal([...h.store.keys()].filter(k=>k.startsWith('bankReconciliationLocks/')).length,0);
  assert.ok([...h.store.values()].some(v=>v.action==='reconciliation-undo'));
});
test('changed source, excluded rows, differences and forged confirmations are rejected',async()=>{
  const h=await reconciliationSetup();const list=await readReconciliation(h);const payload=confirmation(list.body.rows[0]);
  assert.equal((await h.call('reconciliation',{...payload,reason:''})).status,400);
  h.store.set('transactions/receipt',{...receivable,totalCobranca:200});
  assert.equal((await h.call('reconciliation',payload)).status,409);
  const changed=source(h.store.get('transactions/receipt'),'receipt');
  assert.equal((await h.call('reconciliation',{...payload,sourceFingerprint:changed.fingerprint})).status,409);
  h.store.set('transactions/receipt',{...receivable,isExcluded:true});
  assert.equal((await h.call('reconciliation',payload)).status,409);
  h.store.set('users/u1',{...operator});
  assert.equal((await h.call('reconciliation',payload)).status,403);
  assert.equal([...h.store.keys()].filter(k=>k.startsWith('bankReconciliationLocks/')).length,0);
});
