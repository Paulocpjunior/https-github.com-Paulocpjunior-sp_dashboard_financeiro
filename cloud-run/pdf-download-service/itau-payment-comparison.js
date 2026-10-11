// Suggestions only. Equal amount/date do not establish payee identity or reconciliation.
const BANK = require('./native-entry-catalog.json').banks[0];
const day = value => Date.parse(value + 'T00:00:00Z') / 86400000;
function reviewHint(statement) {
  const description = `${statement.name || ''} ${statement.memo || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (statement.amountCents >= 0) return 'Recebimento fora desta comparação. Confira o vínculo com a cobrança e o retorno do emissor; não registre outra baixa pelo extrato.';
  if (/\b(TAR|TARIFA|TARIFAS|CUSTAS)\b/.test(description)) return 'Descrição sugere tarifa bancária. Confira o extrato e o plano de contas antes de cadastrar uma despesa.';
  if (/\bSISPAG\b/.test(description)) return 'Pagamento SISPAG: confira o comprovante e os favorecidos. Pode representar um lote; não distribua o valor por suposição.';
  return 'Confira favorecido, comprovante e pagamentos antigos. Baixas do Jotform não participam desta comparação.';
}
function comparePayments(statements, payments) {
  const eligible = payments.filter(p => p.bankAccount === BANK);
  const links = new Map();
  const rows = statements.map(row => {
    const candidates = row.amountCents < 0 ? eligible.filter(p => p.amountCents === -row.amountCents && Math.abs(day(p.date)-day(row.date)) <= 3) : [];
    for(const p of candidates) links.set(p.id,(links.get(p.id)||0)+1);
    return {statement:row,candidates,reviewHint:reviewHint(row)};
  }).map(row => ({...row,status:row.statement.amountCents >= 0 ? 'outside-scope' : !row.candidates.length ? 'no-candidate' : row.candidates.length>1 || links.get(row.candidates[0].id)>1 ? 'ambiguous' : 'suggestion'}));
  const counts = Object.fromEntries(['suggestion','ambiguous','no-candidate','outside-scope'].map(s=>[s,rows.filter(r=>r.status===s).length]));
  return {rows,counts,paymentCount:eligible.length,unmatchedPayments:eligible.filter(p=>!links.has(p.id)),
    coverage:'Sugestões individuais de baixas nativas da conta Itaú 3145 / 99791-6, sem estornos. Grupos exigem seleção e conferência manual. Pagamentos antigos têm revisão separada; contas pendentes e recebimentos ficam fora desta comparação.',
    criterion:'Mesmo valor efetivamente pago, mesma conta bancária e diferença de até 3 dias corridos. Sugestões não confirmam identidade do favorecido nem registram conciliação.'};
}
module.exports={comparePayments,reviewHint};
