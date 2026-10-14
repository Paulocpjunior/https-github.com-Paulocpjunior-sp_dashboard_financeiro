const { createHash } = require('node:crypto');
const XLSX = require('xlsx');
const { ACCOUNT, MAX_ROWS, StatementError, parseOfx, date } = require('./itau-ofx');
const hash = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const key = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const fail = message => { throw new StatementError(message); };
function bankDate(value) {
  const m = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) fail('Data não reconhecida no extrato. Exporte novamente com ano completo.');
  return date(m[3] + m[2] + m[1]);
}
function money(value) {
  if (typeof value === 'number') {
    const n = Math.round(value * 100);
    if (!Number.isFinite(value) || Math.abs(value * 100 - n) > 0.00001 || Math.abs(n) > 1e12) fail('Valor monetário inválido.');
    return n;
  }
  let s = clean(value).replace(/^R\$\s*/, '');
  const suffix = s.match(/\s*([CD])$/i)?.[1]?.toUpperCase();
  if (suffix) s = s.replace(/\s*[CD]$/i, '');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(s)) fail('Valor monetário ausente ou ambíguo no extrato.');
  const n = Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12 || (suffix === 'C' && n < 0) || (suffix === 'D' && s.startsWith('+'))) fail('Sinal ou valor monetário inválido.');
  return suffix === 'D' ? -Math.abs(n) : n;
}
function metadata(text) {
  const t = key(text);
  const agency = t.match(/AGENCIA\s*:?\s*(\d+)/)?.[1];
  const account = t.match(/CONTA\s*:?\s*([\d.-]+)/)?.[1]?.replace(/\D/g, '').replace(/^0+/, '');
  if (agency !== '3145' || account !== '997916') fail('Extrato de outra conta ou sem identificação completa. Esperado: Itaú 3145 / 99791-6.');
  const period = t.match(/PERIODO\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*(?:ATE|A|-)\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!period) fail('Período do extrato não reconhecido. Use o arquivo original do banco.');
  const start = bankDate(period[1]), end = bankDate(period[2]);
  if (start > end) fail('Período do extrato invertido.');
  return { start, end };
}
function normalize(bytes, format, meta, records) {
  if (!records.length || records.length > MAX_ROWS) fail(`Extrato sem movimentos reconhecidos ou com mais de ${MAX_ROWS} linhas. Reduza o período ou utilize OFX.`);
  const occurrences = new Map(), rows = [], balanceRows = [];
  for (const record of records) {
    const bookedAt = bankDate(record[0]);
    const memo = record.slice(1, 4).map(clean).filter(Boolean).join(' ');
    if (!memo) fail('Movimentação sem descrição.');
    const amountCents = money(record[4]);
    const label = key(record[1]);
    const balanceKind = label === 'SALDO ANTERIOR' ? 'opening' : label === 'SALDO TOTAL DISPONIVEL DIA' ? 'available' : null;
    if (/^(SALDO|SDO)\b/.test(label) && !balanceKind) fail('Referência de saldo não reconhecida; utilize OFX para conferência.');
    if (bookedAt > meta.end || (balanceKind === 'opening' ? bookedAt > meta.start : bookedAt < meta.start)) fail('Data fora do período declarado no extrato.');
    const signature = hash(JSON.stringify([bookedAt, amountCents, key(memo)]));
    const ordinal = (occurrences.get(signature) || 0) + 1; occurrences.set(signature, ordinal);
    // Synthetic identifiers are explicitly marked and never represented as bank FITIDs.
    const fitid = `ARQUIVO:${signature}:${ordinal}`;
    const row = { fitid, date: bookedAt, amountCents, type: amountCents < 0 ? 'DEBIT' : 'CREDIT', name: '', memo, checknum: '' };
    if (balanceKind) balanceRows.push({ ...row, kind: balanceKind });
    else rows.push({ ...row, id: hash(`${ACCOUNT}:${fitid}`), fingerprint: hash(JSON.stringify(row)) });
  }
  return { accountId: ACCOUNT, currency: 'BRL', format, ...meta, rows, balanceRows, ledgerBalance: null,
    totals: rows.reduce((s, r) => ({ credits: s.credits + Math.max(r.amountCents, 0), debits: s.debits + Math.min(r.amountCents, 0) }), { credits: 0, debits: 0 }), fileHash: hash(bytes) };
}
function spreadsheet(bytes, format) {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellDates: false, nodim: true });
  const candidates = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    if (range.e.r > 5000 || range.e.c > 100) fail('Planilha excede o limite de leitura. Exporte um período menor.');
    for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith('!') && cell.f) fail('Planilhas com fórmulas não são aceitas. Use a exportação original do banco.');
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const header = grid.findIndex(r => key(r[0]) === 'DATA' && /^LANCAMENTOS?$/.test(key(r[1])));
    if (header < 0) continue;
    if (key(grid[header][2]) !== 'RAZAO SOCIAL' || !['CPF/CNPJ','CNPJ/CPF'].includes(key(grid[header][3])) || key(grid[header][4]) !== 'VALOR (R$)' || key(grid[header][5]) !== 'SALDO (R$)') fail('Colunas da planilha não reconhecidas. Utilize OFX ou solicite revisão deste layout.');
    const meta = metadata(grid.slice(0, header).map(r => r.map(clean).join(' ')).join('\n'));
    const records = grid.slice(header + 1).filter(r => r.some(v => clean(v)));
    candidates.push(normalize(bytes, format, meta, records));
  }
  if (candidates.length !== 1) fail('É necessário exatamente um extrato reconhecido na planilha.');
  return candidates[0];
}
async function pdf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, stopAtErrors: true });
  try {
    const document = await task.promise;
    if (document.numPages > 20) fail('PDF com mais de 20 páginas. Exporte um período menor.');
    let meta; const records = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const items = (await page.getTextContent()).items.filter(i => clean(i.str)).map(i => ({ text: clean(i.str), x: i.transform[4], y: i.transform[5] }));
      if (!items.length) fail('PDF sem texto selecionável. Use OFX ou Excel; imagens digitalizadas não são aceitas.');
      const text = items.map(i => i.text).join(' ');
      if (pageNumber === 1) meta = metadata(text);
      else if (/AGENCIA|PERIODO/.test(key(text))) {
        const pageMeta = metadata(text);
        if (pageMeta.start !== meta.start || pageMeta.end !== meta.end) fail('PDF contém períodos diferentes. Exporte um extrato por arquivo.');
      }
      const headings = ['DATA','LANCAMENTOS','RAZAO SOCIAL','CNPJ/CPF','VALOR (R$)','SALDO (R$)'];
      const columns = headings.map(h => items.find(i => key(i.text) === h));
      if (columns.some(c => !c) || columns.some(c => Math.abs(c.y - columns[0].y) > 2) || columns.some((c, i) => i && c.x <= columns[i-1].x)) fail('Layout do PDF não reconhecido. Utilize OFX ou solicite revisão do modelo.');
      const footer = items.filter(i => /^(AVISO:|ATUALIZADO EM)/.test(key(i.text))).map(i => i.y);
      const bottom = footer.length ? Math.max(...footer) + 3 : 30;
      const body = items.filter(i => i.y < columns[0].y - 3 && i.y > bottom);
      const anchors = body.filter(i => i.x < columns[1].x - 2 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.text)).sort((a,b) => b.y-a.y);
      if (!anchors.length) fail('Página sem linhas de extrato reconhecidas. Utilize OFX.');
      for (let n = 0; n < anchors.length; n++) {
        const upper = n ? (anchors[n-1].y + anchors[n].y) / 2 : columns[0].y - 3;
        const lower = n + 1 < anchors.length ? (anchors[n+1].y + anchors[n].y) / 2 : bottom;
        const cells = columns.map((c, index) => body.filter(i => i.y <= upper && i.y > lower && i.x >= c.x - 2 && (index === columns.length-1 || i.x < columns[index+1].x - 2)).sort((a,b) => Math.abs(a.y-b.y)>2 ? b.y-a.y : a.x-b.x).map(i=>i.text).join(' '));
        records.push(cells);
      }
    }
    return normalize(bytes, 'pdf', meta, records);
  } finally { await task.destroy(); }
}
async function parseStatementFile(bytes, fileName = 'extrato.ofx') {
  const format = String(fileName).split('.').pop().toLowerCase();
  if (!['ofx','pdf','xls','xlsx'].includes(format) || !bytes.length || bytes.length > 2*1024*1024) fail('Selecione OFX, PDF, XLS ou XLSX de até 2 MB.');
  try {
    if (format === 'ofx') return { ...parseOfx(bytes), format };
    if (format === 'pdf') {
      if (bytes.subarray(0,5).toString() !== '%PDF-') fail('O conteúdo não corresponde a um PDF.');
      return await pdf(bytes);
    }
    const magic = bytes.subarray(0,8).toString('hex');
    if (format === 'xlsx' ? !magic.startsWith('504b0304') : magic !== 'd0cf11e0a1b11ae1') fail('O conteúdo não corresponde ao formato Excel selecionado.');
    return spreadsheet(bytes, format);
  } catch (error) {
    if (error instanceof StatementError) throw error;
    fail('Não foi possível ler o arquivo. Use o original sem senha, ou exporte em OFX.');
  }
}
module.exports = { parseStatementFile, money, bankDate, metadata, normalize };
