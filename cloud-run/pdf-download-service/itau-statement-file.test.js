const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { parseStatementFile, money, bankDate } = require('./itau-statement-file');
function excel(bookType='xlsx', change=()=>{}) {
  const grid=[['Agência:','3145'],['Conta:','0099791-6'],['Periodo:','11/10/2026 até 14/10/2026'],['Data','Lançamento','Razão Social','CPF/CNPJ','Valor (R$)','Saldo (R$)'],['13/10/2026','PIX RECEBIDO','CLIENTE FICTICIO','',123.45,''],['14/10/2026','TARIFA','','',-2.34,'']];
  change(grid);
  const sheet=XLSX.utils.aoa_to_sheet(grid),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,'Lançamentos');
  return XLSX.write(book,{type:'buffer',bookType});
}
for(const format of ['xls','xlsx']) test(`${format}: reads credits/debits and stable identifiers`,async()=>{
  const r=await parseStatementFile(excel(format),'test.'+format);
  assert.deepEqual(r.totals,{credits:12345,debits:-234});assert.equal(r.rows.length,2);assert.equal(r.ledgerBalance,null);
  assert.match(r.rows[0].fitid,/^ARQUIVO:/);
  assert.deepEqual(r.rows,(await parseStatementFile(excel('xlsx'),'test.xlsx')).rows);
});
test('rejects foreign account, unknown columns, malformed dates, empty amounts and formulas',async()=>{
  for(const mutate of [g=>g[0][1]='9999',g=>g[3][4]='Saldo',g=>g[4][0]='31/02/2026',g=>g[4][4]='',g=>g[4][4]={t:'n',v:123.45,f:'1+1'}]) await assert.rejects(parseStatementFile(excel('xlsx',mutate),'test.xlsx'));
});
test('keeps equal real movements separate and excludes balance references',async()=>{
 const r=await parseStatementFile(excel('xlsx',g=>{g.push([...g[4]]);g.push(['11/10/2026','SALDO ANTERIOR','','',1000,'']);}),'test.xlsx');
 assert.equal(r.rows.length,3);assert.equal(new Set(r.rows.map(r=>r.id)).size,3);assert.equal(r.balanceRows.length,1);assert.equal(r.totals.credits,24690);
});
test('money/date parsing rejects ambiguity and preserves debit suffix',()=>{
 assert.equal(money('1.234,56 D'),-123456);assert.equal(money('-2,34'),-234);assert.equal(money('2,34 C'),234);
 for(const value of ['1,234','',NaN,'1.234','-1,00 C']) assert.throws(()=>money(value));
 assert.throws(()=>bankDate('31/02/2026'));
});
async function pdfFile(textOnly=false) {
 const doc=new PDFDocument({size:'A4',margin:0});const chunks=[];const finished=new Promise(resolve=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));});
 if(!textOnly){doc.fontSize(9).text('Agência 3145 Conta 0099791-6',30,30);doc.text('Lançamentos do período: 11/10/2026 até 14/10/2026',30,50);
 const xs=[30,90,225,365,470,525];['Data','Lançamentos','Razão Social','CNPJ/CPF','Valor (R$)','Saldo (R$)'].forEach((s,i)=>doc.text(s,xs[i],80,{lineBreak:false}));
 ['13/10/2026','PIX RECEBIDO','CLIENTE FICTICIO','','123,45',''].forEach((s,i)=>doc.text(s,xs[i],100,{lineBreak:false}));doc.text('aviso:',30,130);}
 doc.end();return finished;
}
test('PDF parses columns and rejects image-only/empty PDF',async()=>{
 const r=await parseStatementFile(await pdfFile(),'test.pdf');assert.equal(r.rows.length,1);assert.equal(r.rows[0].memo,'PIX RECEBIDO CLIENTE FICTICIO');assert.equal(r.totals.credits,12345);
 await assert.rejects(parseStatementFile(await pdfFile(true),'test.pdf'));
});
test('rejects renamed or oversized files',async()=>{
 await assert.rejects(parseStatementFile(excel(),'test.pdf'));
 await assert.rejects(parseStatementFile(Buffer.alloc(2*1024*1024+1),'test.xlsx'));
 await assert.rejects(parseStatementFile(Buffer.from('hello'),'test.xls'));
});
test('reads cells beyond incorrect declared Excel dimension, as exported by Itaú',async()=>{
 const bytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'test-fixtures/itau-short-dimension.xlsx'));
 const r=await parseStatementFile(bytes,'test.xlsx');assert.equal(r.rows.length,2);assert.equal(r.totals.credits,30000);
});
