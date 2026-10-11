const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOfx, classifyRows, ACCOUNT } = require('./itau-ofx');
const { createStatementHandler, permitted, interval } = require('./itau-statements');

// Synthetic fixtures only. Never commit real bank exports or counterparties.
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

function harness(profile = operator, readLedger) {
  const store = new Map([['users/u1',profile]]);
  let sequence = 0, queryCount = 0, queue = Promise.resolve();
  const snap = ref => ({ exists:store.has(ref.path), data:()=>store.get(ref.path) });
  const doc = path => ({ path, get:async()=>snap({path}), collection:name=>collection(`${path}/${name}`) });
  const query = (path, filters = [], order = '', direction = 'asc', limit = 100000) => ({
    where:(key,op,value)=>query(path,[...filters,[key,op,value]],order,direction,limit),
    orderBy:(key,dir='asc')=>query(path,filters,key,dir,limit),
    limit:n=>query(path,filters,order,direction,n),
    get:async()=>{
      queryCount++;
      const rows=[...store.entries()].filter(([key])=>key.startsWith(`${path}/`) && key.slice(path.length+1).indexOf('/')===-1).map(([,v])=>v)
        .filter(r=>filters.every(([key,op,value])=>op==='>='?r[key]>=value:r[key]<=value))
        .sort((a,b)=>String(a[order]).localeCompare(String(b[order]))*(direction==='desc'?-1:1)).slice(0,limit);
      return {size:rows.length,docs:rows.map(r=>({data:()=>r}))};
    },
  });
  const collection = path => ({ ...query(path), doc:(id)=>doc(`${path}/${id || `audit-${++sequence}`}`), add:async data=>store.set(`${path}/audit-${++sequence}`, data) });
  const db = {
    collection,
    getAll:async(...refs)=>refs.map(snap),
    runTransaction: fn => {
      const run = queue.then(async()=>{
        const writes=[];
        const result=await fn({ get:async ref=>snap(ref), getAll:async(...refs)=>refs.map(snap), create:(ref,data)=>writes.push([ref.path,data]) });
        for(const [path] of writes) assert.equal(store.has(path),false,'create must not overwrite');
        writes.forEach(([path,data])=>store.set(path,data));
        return result;
      });
      queue=run.catch(()=>{}); return run;
    },
  };
  const handler=createStatementHandler({ readLedger, getServices:()=>({adminDb:db,adminAuth:{verifyIdToken:async token=>{if(token!=='valid')throw new Error('revoked'); return {uid:'u1'};}}}),readBody:async request=>Buffer.from(JSON.stringify(request.body)),sendJson:(_req,res,status,body)=>Object.assign(res,{status,body}) });
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
  const h=harness({...operator,financialPermissions:['itau.openfinance.read']});
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
const {comparePayments}=require('./itau-payment-comparison');
const bankAccount=require('./native-entry-catalog.json').banks[0];
const payment=(id,date='2026-09-15',amountCents=123456)=>({id,transactionId:'account-'+id,date,amountCents,bankAccount,supplier:'Credor fictício'});
test('comparison respects paid cents, account, direction and 3 calendar days without claiming reconciliation',()=>{
 const bank=parse(ofx()).rows;
 const p=payment('a','2026-09-18');
 const r=comparePayments(bank,[p,payment('late','2026-09-19'),{...payment('wrong-bank'),bankAccount:'Outra conta'},payment('different-amount','2026-09-15',1)]);
 assert.equal(r.rows[0].status,'suggestion');assert.deepEqual(r.rows[0].candidates,[p]);assert.equal(r.rows[1].status,'outside-scope');
 assert.equal(r.unmatchedPayments.length,2);assert.equal(r.paymentCount,3);
 assert.deepEqual(bank,parse(ofx()).rows);
});
test('one-to-many and many-to-one matches are ambiguous; no-candidate is explicit',()=>{
 const bank=parse(ofx(entry('one')+entry('two'))).rows;
 assert(comparePayments(bank,[payment('a')]).rows.every(r=>r.status==='ambiguous'));
 assert.equal(comparePayments([bank[0]],[payment('a'),payment('b')]).rows[0].status,'ambiguous');
 assert.equal(comparePayments([bank[0]],[]).rows[0].status,'no-candidate');
});
test('comparison requires bank and payable access, expands payment dates and only writes read audit',async()=>{
 let calls=0;const reader=async(_db,start,end)=>{calls++;assert.equal(start,'2026-08-29');assert.equal(end,'2026-10-03');return {rows:[payment('a')]};};
 const denied=harness(operator,reader);
 assert.equal((await denied.call('payment-comparison?start=2026-09-01&end=2026-09-30',null,'valid','GET')).status,403);assert.equal(calls,0);
 const h=harness({...operator,financialPermissions:['itau.openfinance.read','payables.read']},reader);
 h.store.set(`bankStatements/${ACCOUNT}/entries/one`,parse(ofx()).rows[0]);
 const before=[...h.store.entries()];
 const r=await h.call('payment-comparison?start=2026-09-01&end=2026-09-30',null,'valid','GET');
 assert.equal(r.status,200);assert.equal(r.body.rows[0].status,'suggestion');
 for(const [key,value] of before)assert.deepEqual(h.store.get(key),value);
 assert([...h.store.keys()].filter(k=>!before.some(([p])=>p===k)).every(k=>k.startsWith('bankStatementAudit/')));
});
test('comparison rechecks revocation and refuses incomplete bank coverage',async()=>{
 const profile={...operator,financialPermissions:['itau.openfinance.read','payables.read']};
 let h;h=harness(profile,async()=>{h.store.set('users/u1',{...profile,active:false});return {rows:[payment('a')]};});
 assert.equal((await h.call('payment-comparison?start=2026-09-01&end=2026-09-30',null,'valid','GET')).status,403);
 const full=harness(profile,async()=>({rows:[]}));
 for(let i=0;i<1001;i++)full.store.set(`bankStatements/${ACCOUNT}/entries/${i}`,{date:'2026-09-15'});
 assert.equal((await full.call('payment-comparison?start=2026-09-01&end=2026-09-30',null,'valid','GET')).status,400);
});

test('Itaú balance pseudo-entries are preserved separately, including opening before DTSTART', () => {
  const balance = (id, label, amount, date) => entry(id,amount,date).replace('Descrição original',label).replace('OTHER','CREDIT');
  const text=ofx(balance('open','SALDO ANTERIOR','100.00','20260831100000[-03:EST]')+entry('debit','-10.00')+balance('day','SALDO TOTAL DISPONÍVEL DIA','90.00','20260915100000[-03:EST]'));
  const parsed=parse(text);
  assert.equal(parsed.rows.length,1);
  assert.deepEqual(parsed.totals,{credits:0,debits:-1000});
  assert.deepEqual(parsed.balanceRows.map(r=>[r.kind,r.amountCents,r.date]),[['opening',10000,'2026-08-31'],['available',9000,'2026-09-15']]);
  assert.equal(parsed.balanceRows[0].memo,'SALDO ANTERIOR');
  assert.throws(()=>parse(text.replace('SALDO ANTERIOR','SALDO DESCONHECIDO')));
  assert.throws(()=>parse(text.replace('SALDO TOTAL DISPONÍVEL DIA','SALDO TOTAL DISPONÍVEL DIA AJUSTADO')));
  assert.throws(()=>parse(ofx(balance('a','SALDO ANTERIOR','100.00','20260831100000')+balance('b','SALDO ANTERIOR','100.00','20260831100000'))));
  assert.throws(()=>parse(ofx(balance('x','SALDO TOTAL DISPONÍVEL DIA','100.00','20260831100000'))));
});
test('import stores balance references only in import metadata; replay never creates balance credits',async()=>{
  const h=harness();
  const text=ofx(entry('opening','100.00','20260831100000').replace('Descrição original','SALDO ANTERIOR')+entry('real','-10.00'));
  const file={base64:Buffer.from(text).toString('base64'),fileName:'ficticio.ofx'};
  const preview=await h.call('preview',file);
  assert.equal(preview.status,200);
  const commit=await h.call('import',{...file,confirmHash:parse(text).fileHash});
  assert.equal(commit.status,200);
  const imported=[...h.store.entries()].filter(([k])=>k.includes('/imports/'))[0][1];
  assert.equal(imported.balanceRows.length,1);
  assert.equal([...h.store.keys()].filter(k=>k.includes('/entries/')).length,1);
  await h.call('import',{...file,confirmHash:parse(text).fileHash});
  assert.equal([...h.store.keys()].filter(k=>k.includes('/entries/')).length,1);
});

test('UTF-8 Itaú bytes override an inaccurate 1252 header without mojibake',()=>{
  const text=ofx(entry('balance','100.00').replace('Descrição original','SALDO TOTAL DISPONÍVEL DIA')).replace('ENCODING:UTF-8','ENCODING:USASCII\nCHARSET:1252');
  const result=parse(text);
  assert.equal(result.rows.length,0);
  assert.equal(result.balanceRows[0].memo,'SALDO TOTAL DISPONÍVEL DIA');
  assert.equal(parseOfx(Buffer.from(text,'latin1')).balanceRows[0].memo,'SALDO TOTAL DISPONÍVEL DIA');
});


test('review hints explain fees and SISPAG without creating financial matches', () => {
  const {comparePayments}=require('./itau-payment-comparison');
  const rows=[
    {id:'fee',amountCents:-710,name:'TAR/CUSTAS COBRANÇA'},
    {id:'batch',amountCents:-10000,name:'SISPAG SALARIOS'},
    {id:'ordinary',amountCents:-20000,name:'PIX ENVIADO'},
    {id:'credit',amountCents:710,name:'ESTORNO TARIFA'},
  ];
  const before=JSON.stringify(rows);
  const result=comparePayments(rows,[]);
  assert.match(result.rows[0].reviewHint,/sugere tarifa/);
  assert.match(result.rows[1].reviewHint,/Pode representar um lote/);
  assert.match(result.rows[2].reviewHint,/Jotform/);
  assert.match(result.rows[3].reviewHint,/Recebimento fora/);
  assert.equal(result.counts['no-candidate'],3);
  assert.equal(result.counts['outside-scope'],1);
  assert.equal(result.paymentCount,0);
  assert.ok(result.rows.every(row=>row.candidates.length===0));
  assert.equal(JSON.stringify(rows),before);
});
