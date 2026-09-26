const { createHash } = require('node:crypto');
const ACCOUNT = 'itau-3145-997916';
const MAX_ROWS = 400;
class StatementError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new StatementError(message); };
function field(text, tag, optional = false) {
  const matches = [...text.matchAll(new RegExp(`<${tag}\\s*>([^<]*)`, 'gi'))];
  if (matches.length > 1) fail(`Campo ${tag} repetido no OFX.`);
  const value = matches[0]?.[1].trim() || '';
  if (!optional && !value) fail(`Campo ${tag} ausente no OFX.`);
  if (value.length > 1000) fail(`Campo ${tag} excede o tamanho permitido.`);
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function block(text, tag, optional = false) {
  const matches = [...text.matchAll(new RegExp(`<${tag}\\s*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi'))];
  const openings = (text.match(new RegExp(`<${tag}\\s*>`, 'gi')) || []).length;
  if (openings !== matches.length) fail(`Bloco ${tag} incompleto.`);
  if (matches.length !== 1) {
    if (optional && matches.length === 0) return '';
    fail(`É necessário exatamente um bloco ${tag} completo.`);
  }
  return matches[0][1];
}
function date(value) {
  if (!/^\d{8}(?:\d{6}(?:\.\d+)?(?:\[[^\]\r\n]+\])?)?$/.test(value)) fail('Data OFX inválida.');
  const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== iso) fail('Data OFX inexistente.');
  return iso;
}
function cents(value) {
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(value)) fail('Valor monetário inválido no OFX. Use o arquivo original do banco.');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > 1e12) fail('Valor fora do limite de importação.');
  return value.startsWith('-') ? -amount : amount;
}
function digits(value) {
  if (!/^[\d .-]+$/.test(value)) fail('Identificação bancária inválida.');
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}
function decodeOfx(bytes) {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) fail('Selecione um OFX de até 2 MB.');
  const header = bytes.subarray(0, 400).toString('ascii');
  const legacy = /(?:CHARSET\s*:\s*(?:1252|8859-1)|encoding\s*=\s*["'](?:windows-1252|iso-8859-1))/i.test(header);
  const text = new TextDecoder(legacy ? 'windows-1252' : 'utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\uFFFD')) fail('Codificação do OFX não reconhecida.');
  return text;
}
function parseOfx(bytes) {
  let text;
  try { text = decodeOfx(bytes); } catch (e) { if (e instanceof StatementError) throw e; fail('Codificação do OFX não reconhecida.'); }
  if (/<!DOCTYPE|<!ENTITY|<CORRECTFITID|<CORRECTACTION|<STMTTRNP|<INVBANKTRAN/i.test(text)) fail('OFX com correções ou formato não suportado; requer revisão.');
  block(text, 'OFX');
  const statement = block(text, 'STMTRS');
  const statusCodes = [...text.matchAll(/<STATUS\s*>[\s\S]*?<CODE\s*>([^<\s]+)/gi)];
  if (statusCodes.some(match => match[1] !== '0')) fail('OFX informa falha na resposta do banco.');
  if (field(statement, 'CURDEF') !== 'BRL') fail('A conta aceita apenas extratos em BRL.');
  const account = block(statement, 'BANKACCTFROM');
  const bank = digits(field(account, 'BANKID'));
  const rawAccount = digits(field(account, 'ACCTID'));
  const branchText = field(account, 'BRANCHID', true);
  const branch = branchText ? digits(branchText) : '';
  const matchesAccount = branch ? branch === '3145' && rawAccount === '997916' : rawAccount === '3145997916';
  if (bank !== '341' || !matchesAccount) fail('OFX de outra conta ou sem identificação completa. Esperado: Itaú 3145 / 99791-6.');
  if (field(account, 'ACCTTYPE') !== 'CHECKING') fail('Importe um extrato de conta corrente.');
  const list = block(statement, 'BANKTRANLIST');
  const start = date(field(list, 'DTSTART'));
  const end = date(field(list, 'DTEND'));
  if (start > end) fail('Período do OFX invertido.');
  const txBlocks = [...list.matchAll(/<STMTTRN\s*>([\s\S]*?)<\/STMTTRN\s*>/gi)];
  if ((text.match(/<STMTTRN\s*>/gi) || []).length !== txBlocks.length) fail('Movimentação fora do bloco de extrato ou incompleta.');
  if ((list.match(/<STMTTRN\s*>/gi) || []).length !== txBlocks.length) fail('Movimentação incompleta no OFX.');
  if (txBlocks.length > MAX_ROWS) fail(`Importe um período menor: máximo de ${MAX_ROWS} movimentações por arquivo.`);
  const seen = new Set();
  const rows = txBlocks.map(([_, value]) => {
    const fitid = field(value, 'FITID');
    if (seen.has(fitid)) fail('FITID repetido dentro do arquivo; nenhuma movimentação será importada.');
    seen.add(fitid);
    const bookedAt = date(field(value, 'DTPOSTED'));
    if (bookedAt < start || bookedAt > end) fail('Movimentação fora do período declarado no OFX.');
    const amountCents = cents(field(value, 'TRNAMT'));
    const type = field(value, 'TRNTYPE');
    const name = field(value, 'NAME', true);
    const memo = field(value, 'MEMO', true);
    const row = { fitid, date: bookedAt, amountCents, type, name, memo, checknum: field(value, 'CHECKNUM', true) };
    return { ...row, id: hash(`${ACCOUNT}:${fitid}`), fingerprint: hash(JSON.stringify(row)) };
  });
  const ledger = block(statement, 'LEDGERBAL', true);
  const ledgerBalance = ledger ? { amountCents: cents(field(ledger, 'BALAMT')), date: date(field(ledger, 'DTASOF')) } : null;
  const totals = rows.reduce((sum, r) => ({ credits: sum.credits + Math.max(r.amountCents, 0), debits: sum.debits + Math.min(r.amountCents, 0) }), { credits: 0, debits: 0 });
  return { accountId: ACCOUNT, currency: 'BRL', start, end, rows, ledgerBalance, totals, fileHash: hash(bytes) };
}
function classifyRows(rows, existing) {
  const duplicates = [], fresh = [], conflicts = [];
  rows.forEach((row, i) => {
    if (!existing[i]) fresh.push(row);
    else if (existing[i].fingerprint === row.fingerprint) duplicates.push(row.id);
    else conflicts.push(row.fitid);
  });
  return { fresh, duplicates, conflicts };
}
module.exports = { ACCOUNT, MAX_ROWS, StatementError, parseOfx, classifyRows, date };
