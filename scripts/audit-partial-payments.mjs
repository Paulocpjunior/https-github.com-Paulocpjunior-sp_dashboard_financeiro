// Recognize a coherent native partial balance; dates alone never prove settlement.
export function hasCoherentPartialPayment(row) {
  const direction = String(row.movement || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!['entrada', 'saida'].includes(direction) || /^(pago|sim|true)$/i.test(String(row.pago || ''))) return false;
  const receivable = direction === 'entrada';
  const b = receivable ? row.receivableBalance : row.payableBalance;
  const last = receivable ? row.receivableSettlement : row.payableSettlement;
  const paid = receivable ? b?.receivedCents : b?.paidCents;
  const nominal = Number(row.valorOriginal || row.totalCobranca || (receivable ? row.valueReceived : row.valuePaid));
  if (!b || b.version !== 1 || !last?.requestId || last.date !== row.paymentDate) return false;
  const parts = [paid, b.remainingCents, b.interestCents, b.discountCents, receivable ? 0 : b.fineCents];
  if (!parts.every(v => Number.isSafeInteger(v) && v >= 0) || paid <= 0 || b.remainingCents <= 0) return false;
  return last.remainingCents === b.remainingCents && Number.isFinite(nominal) && nominal > 0
    && Math.round(nominal * 100) + b.interestCents + (receivable ? 0 : b.fineCents) - b.discountCents - paid === b.remainingCents;
}
