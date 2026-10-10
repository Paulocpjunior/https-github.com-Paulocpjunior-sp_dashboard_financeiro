const PDFDocument = require('pdfkit');
function composition(row) {
  if (!row || row.source !== 'native-finance' || !Array.isArray(row.extraItems))
    return null; // Legacy records have no verified item-level composition.
  const cents = value => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
      throw new Error('Composição da cobrança inválida.');
    return Math.round(value * 100);
  };
  if (row.extraItems.length > 30) throw new Error('Composição da cobrança inválida.');
  const items = [{account: 'Honorários', amount: row.honorarios}, ...row.extraItems];
  for (const item of items)
    if (typeof item.account !== 'string' || !item.account.trim() || item.account.length > 160)
      throw new Error('Composição da cobrança inválida.');
  const total = items.reduce((sum, item) => sum + cents(item.amount), 0);
  if (total !== cents(Number(row.valorOriginal)) || total !== cents(row.totalCobranca))
    throw new Error('A composição diverge do total da cobrança.');
  return {items, total: total / 100};
}
async function statement(row) {
  const data = composition(row);
  if (!data) return null;
  const doc = new PDFDocument({size:'A4', margin:45, info:{Title:'Demonstrativo da cobrança'}});
  const chunks = [];
  const finished = new Promise((resolve,reject) => {doc.on('data', x=>chunks.push(x));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const money = value => value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function header() {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#163456').text('Demonstrativo da cobrança');
    doc.moveDown(0.4).font('Helvetica').fontSize(10).fillColor('#333333').text('SP Assessoria Contábil · Documento informativo');
    doc.moveDown();
  }
  header();
  doc.fontSize(11).text(String(row.client || ''));
  doc.text('Vencimento: ' + String(row.dueDate || '').split('-').reverse().join('/'));
  doc.moveDown().text(String(row.description || ''));
  doc.moveDown();
  for (const item of data.items) {
    const height = Math.max(doc.heightOfString(item.account,{width:365}),18)+12;
    if (doc.y + height > 715) {doc.addPage();header();}
    const y=doc.y;
    doc.text(item.account,45,y,{width:365});
    doc.text(money(item.amount),425,y,{width:125,align:'right'});
    doc.y=y+height;
  }
  if (doc.y > 680) {doc.addPage();header();}
  doc.moveDown().font('Helvetica-Bold').fontSize(13).text('Total: '+money(data.total),45,doc.y,{width:505,align:'right'});
  doc.moveDown().font('Helvetica').fontSize(9).text('Este demonstrativo não substitui o boleto e não comprova pagamento. Utilize o boleto original para pagar.',45,doc.y,{width:505,align:'left'});
  doc.end();
  return finished;
}
module.exports={composition,statement};
