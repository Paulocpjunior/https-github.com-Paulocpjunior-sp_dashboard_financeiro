// Suggestions only. Equal amount/date do not establish payee identity or reconciliation.
const BANK = require('./native-entry-catalog.json').banks[0];
const day = value => Date.parse(value + 'T00:00:00Z') / 86400000;
function comparePayments(statements, payments) {
  const eligible = payments.filter(p => p.bankAccount === BANK);
  const links = new Map();
  const rows = statements.map(row => {
    const candidates = row.amountCents < 0 ? eligible.filter(p => p.amountCents === -row.amountCents && Math.abs(day(p.date)-day(row.date)) <= 3) : [];
    for(const p of candidates) links.set(p.id,(links.get(p.id)||0)+1);
    return {statement:row,candidates};
  }).map(row => ({...row,status:row.statement.amountCents >= 0 ? 'outside-scope' : !row.candidates.length ? 'no-candidate' : row.candidates.length>1 || links.get(row.candidates[0].id)>1 ? 'ambiguous' : 'suggestion'}));
  const counts = Object.fromEntries(['suggestion','ambiguous','no-candidate','outside-scope'].map(s=>[s,rows.filter(r=>r.status===s).length]));
  return {rows,counts,paymentCount:eligible.length,unmatchedPayments:eligible.filter(p=>!links.has(p.id)),
    coverage:'Somente baixas nativas de contas a pagar da conta Itaú 3145 / 99791-6, sem estornos. Pagamentos legados, contas pendentes, recebimentos e pagamentos agrupados não são conciliados nesta etapa.',
    criterion:'Mesmo valor efetivamente pago, mesma conta bancária e diferença de até 3 dias corridos. Sugestões não confirmam identidade do favorecido nem registram conciliação.'};
}
module.exports={comparePayments};
