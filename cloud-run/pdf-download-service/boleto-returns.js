const { createHash, randomUUID } = require('node:crypto');
const { config, amount } = require('./boleto-cloud');
const { idFor, mergeSituation } = require('./boleto-history');
const catalog = require('./native-entry-catalog.json');
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const digits = v => String(v || '').replace(/\D/g, '');
const cents = v => Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : NaN;
const dateValid = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const localDay = at => new Date(at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const LEASE_MS = 15 * 60 * 1000;
const PAGE_SIZE = 20;

// Only explicit links created during issuance are eligible. Never match by name or amount.
function evaluate(issueId, issue, row, body, cfg, at) {
  const review = reason => ({ state: 'review', reason });
  const f = issue?.fields || {}, b = body?.boleto;
  if (!issue || issue.environment !== 'production' || issue.state !== 'issued' || !issue.transactionId ||
      issueId !== hash(['production', issue.transactionId]) || issue.accountFingerprint !== cfg.accountFingerprint)
    return review('Vínculo de emissão ou conta divergente.');
  if (!b || b.token !== issue.token || !issue.control || b.tokenControleUsuario !== issue.control ||
      String(b.numero) !== String(issue.number) || digits(b.pagador?.cprf) !== digits(f['boleto.pagador.cprf']) ||
      cents(b.valor) !== cents(f['boleto.valor']) || b.vencimento !== f['boleto.vencimento'] || b.emissao !== f['boleto.emissao'])
    return review('Os dados retornados não correspondem à emissão original.');
  if (!row || row.source !== 'native-finance' || row.nativeEntry?.kind !== 'receber' || row.movement !== 'Entrada' ||
      row.isExcluded || row.deletedAt || row.wixInvoiceNumber || row.wixEntityId)
    return review('Lançamento ausente, excluído ou fora do escopo nativo de contas a receber.');
  if (row.bankAccount !== catalog.banks[0] || digits(row.cpfCnpj) !== digits(f['boleto.pagador.cprf']) ||
      row.dueDate !== f['boleto.vencimento'] || cents(amount(row)) !== cents(f['boleto.valor']) || cents(row.valorOriginal) !== cents(f['boleto.valor']))
    return review('Identidade, conta, vencimento ou valor do lançamento foram alterados.');
  if (b.situacao !== 'PAGO') {
    if (row.boletoSettlement) return review('Situação bancária mudou após a baixa; conferir sem estornar automaticamente.');
    if (b.situacao === 'BAIXADO') return review('Boleto cancelado no emissor; lançamento preservado.');
    if (b.situacao !== 'EM_ABERTO' || b.pagamento != null) return review('Situação bancária inconsistente.');
    if (b.registro?.situacao === 'REGISTRO_REJEITADO') return review('Registro rejeitado no emissor.');
    return { state: 'waiting', reason: 'Aguardando confirmação bancária do pagamento.' };
  }
  const p = b.pagamento;
  if (!p || p.situacao !== 'PAGAMENTO_INFORMADO' || p.origem !== 'BANCO' || p.marcadoComoPago !== false)
    return review('Pagamento sem confirmação de origem bancária; marcação manual não gera baixa.');
  if (!dateValid(p.data) || p.data < f['boleto.emissao'] || p.data > localDay(at) ||
      (p.dataCredito != null && (!dateValid(p.dataCredito) || p.dataCredito < p.data)))
    return review('Data de pagamento ou de crédito inválida.');
  if (typeof p.valor !== 'number' || cents(p.valor) !== cents(f['boleto.valor']) || p.valor <= 0 ||
      ['multa', 'juros', 'desconto'].some(k => p[k] != null && p[k] !== 0))
    return review('Valor pago, encargos ou desconto exigem conferência.');
  const evidence = { issueId, boletoId: idFor(issue.token), number: String(b.numero), paymentDate: p.data,
    paidCents: cents(p.valor), origin: 'BANCO' };
  const evidenceId = hash(evidence);
  if (row.boletoSettlement) {
    if (row.boletoSettlement.evidenceId === evidenceId && row.status === 'Pago' && row.paymentDate === p.data && cents(row.valueReceived) === cents(p.valor))
      return { state: 'settled', reason: 'Baixa bancária já registrada.', evidence, evidenceId };
    return review('Pagamento atual diverge da baixa já registrada.');
  }
  if (!['Pendente', 'Agendado', 'Vencida'].includes(row.status) || !['Não', '', undefined].includes(row.pago) ||
      Number(row.valueReceived || 0) !== 0 || Number(row.valorPago || 0) !== 0 || Number(row.valuePaid || 0) !== 0 || row.paymentDate || row.dataPagamento)
    return review('Lançamento já possui pagamento ou situação que exige revisão.');
  return { state: 'ready', reason: 'Pagamento bancário conferido.', evidence, evidenceId };
}

function historyRow(issue, account) {
  const f = issue.fields;
  return { id: idFor(issue.token), token: issue.token, createdAt: f['boleto.emissao'], dueDate: f['boleto.vencimento'],
    amountCents: cents(f['boleto.valor']), number: issue.number || '', document: f['boleto.documento'] || '',
    payerName: f['boleto.pagador.nome'], payerDocument: digits(f['boleto.pagador.cprf']), bank: account?.bank || '',
    beneficiaryDocument: account?.beneficiaryDocument || null, beneficiaryName: account?.beneficiaryName || 'Beneficiário a conferir',
    paidAt: null, paidCents: null, creditedAt: null, cancelledAt: null };
}

async function processIssue({ db, issueDoc, cfg, account, fetchImpl, at, dryRun, lease, settlementEnabled }) {
  const issue = issueDoc.data();
  if (issue.state !== 'issued' || !issue.token) return { state: 'skipped' };
  const response = await fetchImpl(`${cfg.base}/boletos/${encodeURIComponent(issue.token)}/situacao`, {
    method: 'GET', headers: { Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:token`).toString('base64')}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('PROVIDER_UNAVAILABLE');
  const body = await response.json();
  const rowRef = db.collection('transactions').doc(issue.transactionId);
  if (dryRun) return evaluate(issueDoc.id, issue, (await rowRef.get()).data(), body, cfg, at);
  return db.runTransaction(async tx => {
    const leaseRef = db.collection('boletoReturnJobs').doc('production');
    const owner = (await tx.get(leaseRef)).data();
    if (owner?.lease !== lease || owner.leaseUntil <= Date.now()) throw new Error('LEASE_LOST');
    const current = (await tx.get(issueDoc.ref)).data();
    if (hash(current) !== hash(issue)) throw new Error('ISSUE_CHANGED');
    const row = (await tx.get(rowRef)).data();
    let result = evaluate(issueDoc.id, current, row, body, cfg, at);
    const updateRef = db.collection('boletoHistoryUpdates').doc(idFor(issue.token));
    const previous = (await tx.get(updateRef)).data();
    if (previous?.syncedAt > at || current.returnSync?.checkedAt > at) throw new Error('STALE_RESPONSE');
    // Validate history independently; a malformed response must never reach financial writes.
    let next;
    if (body?.boleto?.token === issue.token) next = mergeSituation(historyRow(issue, account), body, at);
    const auditRef = result.evidenceId ? db.collection('boletoSettlementAudit').doc(result.evidenceId) : null;
    const audit = auditRef ? (await tx.get(auditRef)).data() : null;
    if (result.state === 'ready' && audit) result = { state: 'review', reason: 'Auditoria de baixa existente; conferir lançamento antes de reaplicar.' };
    if (result.state === 'ready' && !settlementEnabled) result = { state: 'review', reason: 'Pagamento confirmado; baixa automática ainda desativada.' };
    if (result.state === 'ready') {
      const settlement = { ...result.evidence, evidenceId: result.evidenceId, appliedAt: at, creditedAt: body.boleto.pagamento.dataCredito || null };
      const payment = { status: 'Pago', pago: 'Pago', paymentDate: result.evidence.paymentDate,
        dataPagamento: result.evidence.paymentDate.split('-').reverse().join('/'), valueReceived: result.evidence.paidCents / 100,
        valorPago: (result.evidence.paidCents / 100).toFixed(2), updatedAt: at, boletoSettlement: settlement };
      tx.update(rowRef, payment);
      tx.create(auditRef, { action: 'bank-return-settlement', transactionId: issue.transactionId, ...settlement,
        before: Object.fromEntries(['status', 'pago', 'paymentDate', 'dataPagamento', 'valueReceived', 'valorPago'].map(k => [k, row[k] ?? null])), after: payment });
      result = { ...result, state: 'settled', reason: 'Baixa registrada a partir da confirmação bancária.' };
    }
    // History can reflect a divergent bank response; the receivable remains unchanged and marked for review.
    if (next) tx.set(updateRef, { record: next, syncedAt: at });
    tx.update(issueDoc.ref, { returnSync: { state: result.state, reason: result.reason, checkedAt: at },
      registration: { registeredAt: next?.registeredAt || null, rejected: body?.boleto?.registro?.situacao === 'REGISTRO_REJEITADO', checkedAt: at } });
    return result;
  });
}

async function runReturns({ db, env = process.env, fetchImpl = fetch, dryRun = false }) {
  if (env.BOLETO_CLOUD_RETURN_ENABLED !== 'true' && !dryRun) return { disabled: true };
  const cfg = config(env);
  if (cfg.environment !== 'production' || !cfg.apiKey || !cfg.accountToken) throw new Error('RETURN_CONFIGURATION_INVALID');
  const settlementEnabled = env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED === 'true';
  const jobRef = db.collection('boletoReturnJobs').doc('production'), lease = randomUUID();
  let cursor = '';
  if (!dryRun) {
    const claimed = await db.runTransaction(async tx => {
      const old = (await tx.get(jobRef)).data() || {};
      if (old.leaseUntil > Date.now()) return false;
      cursor = old.cursor || '';
      tx.set(jobRef, { ...old, lease, leaseUntil: Date.now() + LEASE_MS, startedAt: new Date().toISOString(), state: 'running', settlementEnabled });
      return true;
    });
    if (!claimed) return { busy: true };
  }
  const counts = { scanned: 0, waiting: 0, settled: 0, review: 0, errors: 0, skipped: 0, ready: 0 };
  try {
    const pointer = (await db.collection('boletoHistory').doc('production').get()).data();
    const meta = pointer?.snapshot ? (await db.collection('boletoHistorySnapshots').doc(pointer.snapshot).get()).data() : null;
    let query = db.collection('boletoIssues').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const issueDoc of page.docs) {
      const issue = issueDoc.data(); counts.scanned++;
      if (issue.environment !== 'production' || issue.state !== 'issued') { counts.skipped++; continue; }
      const at = new Date().toISOString();
      try {
        const result = await processIssue({ db, issueDoc, cfg, account: meta?.issuanceAccounts?.[issue.accountFingerprint], fetchImpl, at, dryRun, lease, settlementEnabled });
        counts[result.state]++;
      } catch (e) {
        if (e.message === 'LEASE_LOST') throw e;
        counts.errors++;
        if (!dryRun) await db.runTransaction(async tx => {
          const owner = (await tx.get(jobRef)).data();
          if (owner?.lease !== lease || owner.leaseUntil <= Date.now()) throw new Error('LEASE_LOST');
          const current = (await tx.get(issueDoc.ref)).data();
          if (current && (!current.returnSync?.checkedAt || current.returnSync.checkedAt <= at)) tx.update(issueDoc.ref, { returnSync: {
            state: 'error', reason: 'Consulta não concluída. Os dados financeiros foram preservados; haverá nova tentativa.', checkedAt: at } });
        });
      }
    }
    const nextCursor = page.docs.length === PAGE_SIZE ? page.docs.at(-1).id : '';
    if (!dryRun) await db.runTransaction(async tx => {
      const current = (await tx.get(jobRef)).data();
      if (current?.lease !== lease || current.leaseUntil <= Date.now()) throw new Error('LEASE_LOST');
      const finishedAt = new Date().toISOString();
      tx.update(jobRef, { leaseUntil: 0, cursor: nextCursor, finishedAt, state: counts.errors ? 'error' : 'complete', counts,
        ...(counts.errors ? {} : { lastSuccessAt: finishedAt }) });
    });
    return { dryRun, ...counts, more: Boolean(nextCursor) };
  } catch (e) {
    if (!dryRun) await db.runTransaction(async tx => {
      const current = (await tx.get(jobRef)).data();
      if (current?.lease === lease) tx.update(jobRef, { leaseUntil: 0, state: 'error', finishedAt: new Date().toISOString() });
    });
    throw new Error('RETURN_JOB_FAILED');
  }
}
module.exports = { evaluate, runReturns, processIssue, hash };
