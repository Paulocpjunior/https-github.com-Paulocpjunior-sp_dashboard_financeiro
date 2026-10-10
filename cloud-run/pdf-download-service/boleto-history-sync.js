const { randomUUID } = require('node:crypto');
const { config } = require('./boleto-cloud');
const { idFor, mergeSituation } = require('./boleto-history');
const PAGE_SIZE = 60;
const RECENT_MS = 7 * 86400000;

// History synchronization never writes transactions or creates settlement evidence.
function candidates(records, updates, nativeTokens, exportedAt, now) {
  return records.map(record => {
    const id = idFor(record.token), update = updates.get(id);
    return { ...record, ...(update?.syncedAt > exportedAt ? update.record : {}), id };
  }).filter(r => !nativeTokens.has(r.token) && (
    (!r.paidAt && !r.cancelledAt) ||
    [r.paidAt, r.cancelledAt].some(d => d && Date.parse(d + 'T00:00:00-03:00') >= now - RECENT_MS)
  )).sort((a, b) => a.id.localeCompare(b.id));
}
async function runHistorySync({ db, env = process.env, fetchImpl = fetch, dryRun = false,
  deadline = Date.now() + 8 * 60000 }) {
  if (env.BOLETO_CLOUD_RETURN_ENABLED !== 'true' && !dryRun) return { disabled: true };
  const cfg = config(env);
  if (cfg.environment !== 'production' || !cfg.apiKey) throw Error('HISTORY_CONFIGURATION_INVALID');
  const pointerRef = db.collection('boletoHistory').doc('production');
  const pointer = (await pointerRef.get()).data();
  if (!pointer?.snapshot) return { skipped: true, reason: 'NO_HISTORY' };
  const snapshot = pointer.snapshot;
  const meta = (await db.collection('boletoHistorySnapshots').doc(snapshot).get()).data();
  if (!meta?.complete) return { skipped: true, reason: 'INCOMPLETE_HISTORY' };
  const jobRef = db.collection('boletoReturnJobs').doc('history-production');
  const lease = randomUUID();
  let prior = {};
  if (!dryRun) {
    const claimed = await db.runTransaction(async tx => {
      prior = (await tx.get(jobRef)).data() || {};
      if (prior.leaseUntil > Date.now()) return false;
      tx.set(jobRef, { ...prior, lease, leaseUntil: Date.now() + 15 * 60000,
        state: 'running', startedAt: new Date().toISOString() });
      return true;
    });
    if (!claimed) return { busy: true };
  }
  const counts = { scanned: 0, updated: 0, errors: 0, superseded: 0 };
  const attention = [];
  try {
    const chunks = await db.collection(`boletoHistorySnapshots/${snapshot}/chunks`).get();
    const records = chunks.docs.flatMap(d => d.data().records || []);
    if (records.length !== meta.totals?.count || new Set(records.map(r => r.token)).size !== records.length)
      throw Error('HISTORY_COUNT_MISMATCH');
    const changes = await db.collection('boletoHistoryUpdates').get();
    const issues = await db.collection('boletoIssues').get();
    const nativeTokens = new Set(issues.docs.map(d => d.data()).filter(i => i.environment === 'production' && i.token).map(i => i.token));
    const rows = candidates(records, new Map(changes.docs.map(d => [d.id, d.data()])), nativeTokens, meta.exportedAt, Date.now());
    const sameCycle = prior.snapshot === snapshot && Boolean(prior.cursor);
    const cursor = sameCycle ? prior.cursor : '';
    const remaining = rows.filter(r => r.id > cursor);
    let processed = 0, last = cursor;
    for (const record of remaining.slice(0, PAGE_SIZE)) {
      if (Date.now() + 20000 >= deadline) break;
      const at = new Date().toISOString();
      counts.scanned++; processed++; last = record.id;
      try {
        const response = await fetchImpl(`${cfg.base}/boletos/${encodeURIComponent(record.token)}/situacao`, {
          method: 'GET', headers: { Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:token`).toString('base64')}`, Accept: 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw Error('PROVIDER_UNAVAILABLE');
        const next = mergeSituation(record, await response.json(), at);
        if (!dryRun) {
          const updated = await db.runTransaction(async tx => {
            const owner = (await tx.get(jobRef)).data();
            const currentPointer = (await tx.get(pointerRef)).data();
            const ref = db.collection('boletoHistoryUpdates').doc(record.id);
            const previous = (await tx.get(ref)).data();
            if (owner?.lease !== lease || owner.leaseUntil <= Date.now()) throw Error('LEASE_LOST');
            if (currentPointer?.snapshot !== snapshot) throw Error('HISTORY_CHANGED');
            if (previous?.syncedAt >= at) return false;
            tx.set(ref, { record: next, syncedAt: at, source: 'automatic-history-api', snapshot });
            return true;
          });
          if (!updated) { counts.superseded++; continue; }
        }
        counts.updated++;
      } catch (e) {
        if (['LEASE_LOST', 'HISTORY_CHANGED'].includes(e.message)) throw e;
        counts.errors++;
        attention.push({ number: record.number || 'Sem número', checkedAt: at,
          reason: 'Consulta não concluída. Histórico preservado; nova tentativa na próxima volta.' });
        // Do not hammer a rate-limited or unavailable credential; retain progress for the next run.
        if (e.message === 'PROVIDER_UNAVAILABLE') break;
      }
    }
    const complete = processed === remaining.length;
    const cycleErrors = (sameCycle ? prior.cycleErrors || 0 : 0) + counts.errors;
    const at = new Date().toISOString();
    if (!dryRun) await db.runTransaction(async tx => {
      const current = (await tx.get(jobRef)).data();
      if (current?.lease !== lease || current.leaseUntil <= Date.now()) throw Error('LEASE_LOST');
      tx.update(jobRef, { snapshot, leaseUntil: 0, cursor: complete ? '' : last,
        state: counts.errors ? 'error' : 'complete', finishedAt: at, counts, attention,
        candidateCount: rows.length, remaining: Math.max(0, remaining.length - processed), cycleErrors,
        cycleStartedAt: sameCycle ? prior.cycleStartedAt || at : at,
        ...(counts.errors ? {} : { lastSuccessAt: at }),
        ...(complete ? { lastCycleCompletedAt: at, lastCycleErrors: cycleErrors,
          ...(cycleErrors ? {} : { lastCycleSuccessfulAt: at }) } : {}) });
    });
    return { dryRun, ...counts, candidates: rows.length, more: !complete };
  } catch (e) {
    if (!dryRun) await db.runTransaction(async tx => {
      const current = (await tx.get(jobRef)).data();
      if (current?.lease === lease) tx.update(jobRef, { leaseUntil: 0, state: 'error',
        finishedAt: new Date().toISOString(), counts });
    });
    throw Error('HISTORY_SYNC_FAILED');
  }
}
module.exports = { candidates, runHistorySync };
