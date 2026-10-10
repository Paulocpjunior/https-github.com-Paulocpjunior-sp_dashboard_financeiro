// Read-only projection of immutable payment audit events, never title totals.
function projectPayments(events, start, end) {
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!validDate(start) || !validDate(end) || start > end) throw Object.assign(Error('Informe um período válido.'), {status:400});
  const rows = [], seen = new Set();
  for (const event of events) {
    if (event.action !== 'payment') continue;
    const p = event.after?.payableSettlement;
    if (!p || !validDate(p.date) || !p.requestId || !event.transactionId || !Number.isSafeInteger(p.amountCents) || p.amountCents <= 0)
      throw Object.assign(Error('Histórico de baixa inconsistente. Relatório não totalizado; solicite revisão.'), {status:409});
    const key = `${event.transactionId}:${p.requestId}`;
    if (seen.has(key)) throw Object.assign(Error('Baixa duplicada no histórico. Solicite revisão.'), {status:409});
    seen.add(key);
    if (p.date < start || p.date > end) continue;
    rows.push({id:key, transactionId:event.transactionId, date:p.date, amountCents:p.amountCents,
      supplier:p.supplier || event.after.description || event.after.client || '', bankAccount:p.bankAccount || '',
      method:p.method || '', actor:p.actor || '', recordedAt:p.at || event.at || ''});
  }
  rows.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const totalCents = rows.reduce((sum,row) => sum + row.amountCents,0);
  if (!Number.isSafeInteger(totalCents)) throw Error('Total excede o limite seguro.');
  return {rows,totalCents,coverage:'Baixas registradas pelo módulo nativo. Pagamentos legados sem evento de baixa não estão incluídos.'};
}
async function readPaymentLedger(db, start, end) {
  // Paginate every audit event: recording time cannot bound backdated payments.
  projectPayments([],start,end);
  const events = []; let cursor;
  for (;;) {
    let query = db.collection('payableAudit').orderBy('__name__').limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    events.push(...page.docs.map(d => d.data()));
    if (events.length > 20000) throw Object.assign(Error('Volume de histórico exige processamento dedicado. Nenhum total parcial foi apresentado.'), {status:409});
    if (page.docs.length < 500) break;
    cursor = page.docs.at(-1);
  }
  return projectPayments(events,start,end);
}
module.exports = {projectPayments,readPaymentLedger};
