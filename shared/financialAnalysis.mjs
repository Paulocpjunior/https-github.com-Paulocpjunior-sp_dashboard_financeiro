import { getOriginalAmount, getPaidAmount, isEntradaTransaction, isSaidaTransaction, isPaidStatus } from './transactionAmounts.mjs';

export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = key => parts.find(p => p.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function financialDate(value) {
  if (typeof value !== 'string') return null;
  let date = value.trim();
  const br = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (br) date = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}
export function plusDays(date, days) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
const cents = amount => {
  const value = Math.round(amount * 100);
  if (!Number.isSafeInteger(value)) throw new Error('Valor financeiro fora do limite de cálculo.');
  return value;
};
const money = amount => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount / 100);

/** Completo para o recorte recebido. Valores em centavos; nenhuma conta é delegada ao modelo. */
export function analyzeTransactions(transactions, { today = businessDate(), scope = 'all' } = {}) {
  if (!financialDate(today)) throw new Error('Data de referência inválida.');
  const end = plusDays(today, 29);
  const days = Array.from({ length: 30 }, (_, i) => ({ date: plusDays(today, i), expectedReceiptsCents: 0, expectedPaymentsCents: 0, variationCents: 0, cumulativeVariationCents: 0 }));
  const byDay = new Map(days.map(day => [day.date, day]));
  const totals = { receivedCents: 0, paidCents: 0, outstandingReceiptsCents: 0, outstandingPaymentsCents: 0, overdueReceiptsCents: 0, overduePaymentsCents: 0, overdueCount: 0 };
  const debtors = new Map();
  const issues = { invalidDueDate: 0, missingAmount: 0, unknownDirection: 0, paidWithoutPaymentDate: 0 };
  let analyzedCount = 0, excludedCount = 0;
  for (const transaction of transactions) {
    if (transaction.isExcluded) { excludedCount++; continue; }
    analyzedCount++;
    const incoming = isEntradaTransaction(transaction);
    const outgoing = !incoming && isSaidaTransaction(transaction);
    if (!incoming && !outgoing) { issues.unknownDirection++; continue; }
    const original = cents(getOriginalAmount(transaction));
    const paid = cents(getPaidAmount(transaction));
    const outstanding = Math.max(0, original - paid);
    if (original === 0) issues.missingAmount++;
    if (isPaidStatus(transaction.status) && !financialDate(transaction.paymentDate)) issues.paidWithoutPaymentDate++;
    totals[incoming ? 'receivedCents' : 'paidCents'] += paid;
    totals[incoming ? 'outstandingReceiptsCents' : 'outstandingPaymentsCents'] += outstanding;
    if (outstanding <= 0) continue;
    if (incoming) {
      const key = String(transaction.cpfCnpj || '').replace(/\D/g, '') || String(transaction.client || 'Sem identificação').trim();
      const debtor = debtors.get(key) || { client: String(transaction.client || 'Sem identificação'), amountCents: 0 };
      debtor.amountCents += outstanding;
      debtors.set(key, debtor);
    }
    const due = financialDate(transaction.dueDate);
    if (!due) { issues.invalidDueDate++; continue; }
    if (due < today) {
      totals.overdueCount++;
      totals[incoming ? 'overdueReceiptsCents' : 'overduePaymentsCents'] += outstanding;
    }
    const day = byDay.get(due);
    if (day) day[incoming ? 'expectedReceiptsCents' : 'expectedPaymentsCents'] += outstanding;
  }
  let cumulative = 0;
  for (const day of days) {
    day.variationCents = day.expectedReceiptsCents - day.expectedPaymentsCents;
    cumulative += day.variationCents;
    day.cumulativeVariationCents = cumulative;
  }
  const allDebtors = [...debtors.values()].sort((a, b) => b.amountCents - a.amountCents || a.client.localeCompare(b.client, 'pt-BR'));
  const forecast = { start: today, end, days, openingBalance: null, expectedReceiptsCents: days.reduce((n, d) => n + d.expectedReceiptsCents, 0), expectedPaymentsCents: days.reduce((n, d) => n + d.expectedPaymentsCents, 0), variationCents: cumulative };
  for (const value of [...Object.values(totals), ...Object.values(issues), forecast.variationCents, forecast.expectedReceiptsCents, forecast.expectedPaymentsCents, ...days.flatMap(d => [d.expectedReceiptsCents, d.expectedPaymentsCents, d.cumulativeVariationCents])]) {
    if (!Number.isSafeInteger(value)) throw new Error('Total financeiro fora do limite de cálculo.');
  }
  return { referenceDate: today, timeZone: 'America/Sao_Paulo', scope, analyzedCount, excludedCount, totals, forecast, issues, topDebtors: allDebtors.slice(0, 10), debtorCount: allDebtors.length };
}

export function renderFinancialAnswer(analysis, mode = 'analysis') {
  const scope = analysis.scope === 'selection' ? 'seleção dos filtros atuais' : 'toda a base financeira da SP';
  const lines = [`Referência: ${analysis.referenceDate} (horário de São Paulo).`, `Escopo: ${scope}; ${analysis.analyzedCount} lançamentos analisados, ${analysis.excludedCount} excluídos desconsiderados.`];
  if (mode === 'forecast') {
    const f = analysis.forecast;
    lines.push(`Projeção de vencimentos: ${f.start} a ${f.end} (30 dias).`, `Recebimentos previstos: ${money(f.expectedReceiptsCents)}.`, `Pagamentos previstos: ${money(f.expectedPaymentsCents)}.`, `Variação prevista: ${money(f.variationCents)}.`, 'Saldo inicial não informado: esta variação não representa saldo bancário nem dinheiro disponível.', 'Os títulos são considerados nas datas de vencimento; recebimentos não são garantidos. Títulos já quitados ficam fora da projeção.', 'Vencimentos por dia:');
    for (const day of f.days) {
      if (day.expectedReceiptsCents || day.expectedPaymentsCents) lines.push(`${day.date}: receber ${money(day.expectedReceiptsCents)}; pagar ${money(day.expectedPaymentsCents)}; variação acumulada ${money(day.cumulativeVariationCents)}.`);
    }
    lines.push(`Atrasados anteriores à projeção: receber ${money(analysis.totals.overdueReceiptsCents)}; pagar ${money(analysis.totals.overduePaymentsCents)}. Não foi presumida uma nova data de liquidação.`);
  } else {
    const t = analysis.totals;
    lines.push(`Recebido nos registros selecionados: ${money(t.receivedCents)}.`, `Pago nos registros selecionados: ${money(t.paidCents)}.`, `Em aberto a receber: ${money(t.outstandingReceiptsCents)}.`, `Em aberto a pagar: ${money(t.outstandingPaymentsCents)}.`, `Vencidos: ${t.overdueCount} títulos; receber ${money(t.overdueReceiptsCents)}; pagar ${money(t.overduePaymentsCents)}.`, 'Esses totais não representam saldo bancário atual.');
    if (analysis.topDebtors.length) {
      lines.push(`Maiores valores em aberto a receber (mostrando ${analysis.topDebtors.length} de ${analysis.debtorCount} clientes):`);
      for (const debtor of analysis.topDebtors) lines.push(`${debtor.client}: ${money(debtor.amountCents)}.`);
    }
  }
  const i = analysis.issues;
  if (i.invalidDueDate) lines.push(`Atenção: ${i.invalidDueDate} títulos em aberto sem vencimento válido não entraram na projeção nem no cálculo de atraso.`);
  if (i.missingAmount) lines.push(`Atenção: ${i.missingAmount} registros sem valor positivo reconhecido exigem conferência; ausência de valor não comprova valor zero.`);
  if (i.unknownDirection) lines.push(`Atenção: ${i.unknownDirection} registros sem direção reconhecida ficaram fora dos totais.`);
  if (i.paidWithoutPaymentDate) lines.push(`Atenção: ${i.paidWithoutPaymentDate} registros quitados sem data de pagamento válida; os totais acima são por registros, não por período de liquidação.`);
  return lines.join('\n');
}
