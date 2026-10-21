// Boleto Cloud's recognized CNAB occurrences. Never infer individual payments from bank totals.
const { randomUUID } = require('node:crypto');
const { config, amount, money } = require('./boleto-cloud');
const { hash, processIssue } = require('./boleto-returns');
const { idFor } = require('./boleto-history');
const reconciliation = require('./boleto-reconciliation');
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const validDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const dayOffset = (v, n) => new Date(Date.parse(v + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const cents = v => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : NaN;
const digits = v => String(v || '').replace(/\D/g, '');
const AUTO_LINK_UID = 'system:ret-auto-link', AUTO_LINK_RULE = 'cpf-cnpj+valor+vencimento-unico';
// The RET file and the individual query already prove the payment; only the receivable is located here.
function recordFrom(event, body) {
    const b = body?.boleto, record = { id: idFor(event.token), token: event.token, number: String(b?.numero ?? ''), payerDocument: digits(b?.pagador?.cprf),
        amountCents: cents(b?.valor), dueDate: b?.vencimento, createdAt: b?.emissao, bank: '341', beneficiaryDocument: null };
    return [11, 14].includes(record.payerDocument.length) && record.amountCents > 0 && validDay(record.dueDate) && validDay(record.createdAt) ? record : null;
}
// Exactly one active receivable with the same CPF/CNPJ, value and due date. Never by name or approximation.
async function autoLinkCandidate(db, record) {
    const docs = (await db.collection('transactions').where('dueDate', '==', record.dueDate).get()).docs.filter(d => {
        const r = d.data();
        return !r.isExcluded && !r.deletedAt && r.movement === 'Entrada' && digits(r.cpfCnpj) === record.payerDocument &&
            Math.round(money(amount(r)) * 100) === record.amountCents;
    });
    if (docs.length > 1) return { reason: 'Mais de um lançamento com o mesmo CPF/CNPJ, valor e vencimento; conferir vínculo.' };
    if (!docs.length) return { reason: 'Boleto sem vínculo individual confirmado com Contas a Receber.' };
    return { id: docs[0].id, row: docs[0].data() };
}
async function get(cfg, path, fetchImpl) {
    const response = await fetchImpl(`${cfg.base}/${path}`, { method: 'GET', headers: { Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:token`).toString('base64')}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok)
        throw Error('RETURN_PROVIDER_UNAVAILABLE');
    return response.json();
}
function filesFrom(body, cfg, date) {
    const r = body?.retornos;
    if (r?.meta?.conta !== cfg.accountToken || r.meta.data !== date || !Array.isArray(r.arquivos) || r.arquivos.some(f => typeof f.token !== 'string' || !f.token))
        throw Error('RETURN_LIST_INVALID');
    return [...new Set(r.arquivos.map(f => f.token))];
}
function eventsFrom(body, token) {
    const a = body?.arquivo;
    if (a?.meta?.token !== token || String(a.protocolo?.banco?.codigo) !== '341' || !Array.isArray(a.titulos))
        throw Error('RETURN_FILE_INVALID');
    const events = [];
    for (const title of a.titulos) {
        if (!Array.isArray(title.ocorrencias))
            throw Error('RETURN_OCCURRENCES_INVALID');
        for (const occurrence of title.ocorrencias) {
            const event = { token: title.token || null, number: String(title.numero || ''), occurrence };
            // Stable occurrence identity does not include current boleto value/due date supplied by the API.
            events.push({ ...event, id: hash(canonical([token, event])) });
        }
    }
    return { events, protocol: a.protocolo, createdAt: a.meta.criado || null };
}
// Only credit-date enrichment is mutable. Every other occurrence field is evidence.
function eventCore(event) {
    const occurrence = structuredClone(event.occurrence);
    if (occurrence?.info && typeof occurrence.info === 'object')
        delete occurrence.info.dataDeCredito;
    return hash(canonical({ number: event.number, boletoId: event.boletoId ?? (event.token ? idFor(event.token) : null), occurrence }));
}
function manifestFor(events) {
    const manifest = {};
    for (const event of events) {
        const key = eventCore(event), credit = event.occurrence?.info?.dataDeCredito || null;
        if (Object.hasOwn(manifest, key)) throw Error('RETURN_AMBIGUOUS_OCCURRENCE');
        if (credit && !validDay(credit)) throw Error('RETURN_CREDIT_DATE_INVALID');
        manifest[key] = credit;
    }
    return manifest;
}
function validateRevision(previous, current) {
    for (const [key, credit] of Object.entries(previous)) {
        if (!Object.hasOwn(current, key) || (credit && current[key] !== credit))
            throw Error('RETURN_EVIDENCE_CONFLICT');
    }
}
// Quarantine the individual title, preserving the original evidence. Unrelated titles continue.
const titleKey = event => hash([event.boletoId ?? (event.token ? idFor(event.token) : null), event.number]);
function revisionConflicts(previous, current, priorEvents) {
    const blocked = new Set();
    for (const [key, credit] of Object.entries(previous)) {
        if (Object.hasOwn(current, key) && (!credit || current[key] === credit)) continue;
        const original = priorEvents.find(e => eventCore(e) === key);
        if (!original) throw Error('RETURN_BASELINE_INCOMPLETE');
        blocked.add(titleKey(original));
    }
    // A previously quarantined title cannot become automatic just because the provider changes back.
    for (const event of priorEvents) if (event.evidenceConflict) blocked.add(titleKey(event));
    return blocked;
}
const errorCode = e => /^RETURN_[A-Z_]+$/.test(e?.message || '') ? e.message : 'RETURN_PROCESSING_FAILED';
function paymentMatches(event, body) {
    const info = event.occurrence?.info, p = body?.boleto?.pagamento;
    return event.occurrence?.situacao === 'LIQUIDACAO' && info?.situacao === 'LIQUIDACAO' &&
        body?.boleto?.token === event.token && String(body.boleto.numero) === event.number &&
        validDay(info.dataDePagamento) && p?.data === info.dataDePagamento &&
        cents(info.valorPago) > 0 && cents(p?.valor) === cents(info.valorPago) && cents(info.jurosMora ?? 0) === 0 &&
        (!info.dataDeCredito || (validDay(info.dataDeCredito) && p.dataCredito === info.dataDeCredito));
}
async function settleEvent({ db, cfg, env, fetchImpl, event, provenance, lease, jobRef, at, dryRun }) {
    if (event.occurrence.situacao !== 'LIQUIDACAO')
        return { state: 'informational', reason: 'Ocorrência sem liquidação; nenhuma baixa.' };
    if (!event.token)
        return { state: 'review', reason: 'Retorno sem boleto identificado no emissor; conferir vínculo.' };
    const body = await get(cfg, `boletos/${encodeURIComponent(event.token)}/situacao`, fetchImpl);
    if (!paymentMatches(event, body))
        return { state: 'review', reason: 'Liquidação do arquivo diverge da situação individual do boleto.' };
    const matches = await db.collection('boletoIssues').where('token', '==', event.token).limit(2).get();
    if (matches.docs.length > 1)
        return { state: 'review', reason: 'Mais de um vínculo de emissão para o boleto.' };
    if (matches.docs.length === 1) {
        const pointer = (await db.collection('boletoHistory').doc('production').get()).data();
        const meta = pointer?.snapshot ? (await db.collection('boletoHistorySnapshots').doc(pointer.snapshot).get()).data() : null;
        return processIssue({ db, issueDoc: matches.docs[0], cfg, account: meta?.issuanceAccounts?.[cfg.accountFingerprint], fetchImpl: async () => ({ ok: true, json: async () => body }), at, dryRun, lease, leaseJob: 'cnab-production', returnEvidence: provenance, settlementEnabled: env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED === 'true' });
    }
    const linkRef = db.collection('boletoReconciliations').doc(idFor(event.token));
    const autoLink = env.BOLETO_CLOUD_RETURN_AUTO_LINK_ENABLED === 'true', record = autoLink ? recordFrom(event, body) : null;
    const candidate = record && !(await linkRef.get()).data() ? await autoLinkCandidate(db, record) : null;
    const perform = async (tx) => {
        if (!dryRun) {
            const owner = (await tx.get(jobRef)).data();
            if (owner?.lease !== lease || owner.leaseUntil <= Date.now())
                throw Error('LEASE_LOST');
        }
        const manual = (await tx.get(db.collection('boletoManualResolutions').doc(idFor(event.token)))).data();
        if (manual) return {state:'review', reason:'Boleto com tratamento manual registrado. Confira o histórico; não reaplicar automaticamente.'};
        const link = (await tx.get(linkRef)).data();
        if (!link && candidate?.id)
            return linkAutomatically(tx);
        if (!link || link.record?.token !== event.token || link.accountFingerprint !== cfg.accountFingerprint)
            return { state: 'review', reason: candidate?.reason || 'Boleto sem vínculo individual confirmado com Contas a Receber.' };
        const rowRef = db.collection('transactions').doc(link.transactionId), row = (await tx.get(rowRef)).data();
        const native = (await tx.get(db.collection('boletoIssues').doc(hash(['production', link.transactionId])))).data();
        if (native)
            return { state: 'review', reason: 'Emissão nativa vinculada ao lançamento; conferir antes de aplicar retorno histórico.' };
        if (row?.boletoSettlement?.boletoId === idFor(event.token))
            return row.status === 'Pago' && row.paymentDate === body.boleto.pagamento.data && cents(row.valueReceived) === cents(body.boleto.pagamento.valor) ? { state: 'settled', reason: 'Baixa existente preservada; nenhuma nova baixa.' } : { state: 'review', reason: 'Baixa existente diverge do retorno; conferir sem reaplicar.' };
        if (link.state === 'already-paid' && row?.boletoReconciliation?.boletoId === idFor(event.token) && reconciliation.revision(row) === link.baseline) {
            const audited = await reconciliation.manualEvidence(db, tx, link.transactionId, row);
            const checked = reconciliation.evaluate(link.record, row, body, at, audited);
            return checked.state === 'already-paid'
                ? { state: 'settled', reason: 'Recebimento existente conferido com o RET; nenhuma nova baixa.' }
                : { state: 'review', reason: checked.reason };
        }
        if (link.state !== 'waiting' || !row || reconciliation.revision(row) !== link.baseline)
            return { state: 'review', reason: 'Vínculo ou lançamento alterado, ou recebimento manual existente. Conferir sem duplicar.' };
        const decision = reconciliation.evaluate(link.record, row, body, at);
        if (decision.state !== 'ready')
            return { ...decision, state: decision.state === 'already-paid' ? 'review' : decision.state };
        if (env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED !== 'true')
            return { state: 'review', reason: 'Liquidação confirmada; baixa automática desativada.' };
        if (!dryRun)
            await reconciliation.apply(tx, db, rowRef, row, linkRef, link, { ...decision, returnEvidence: provenance }, at, body);
        return { state: dryRun ? 'ready' : 'settled', reason: 'Liquidação individual conferida.' };
    };
    const linkAutomatically = async (tx) => {
        const rowRef = db.collection('transactions').doc(candidate.id), row = (await tx.get(rowRef)).data();
        if (!row || reconciliation.revision(row) !== reconciliation.revision(candidate.row))
            return { state: 'review', reason: 'Lançamento alterado durante a conferência; nova tentativa no próximo ciclo.' };
        if (row.boletoReconciliation)
            return { state: 'review', reason: 'Lançamento já vinculado a outro boleto; conferir sem duplicar.' };
        if ((await tx.get(db.collection('boletoIssues').doc(hash(['production', candidate.id])))).data())
            return { state: 'review', reason: 'Emissão nativa vinculada ao lançamento; conferir antes de aplicar retorno.' };
        const decision = reconciliation.evaluate(record, row, body, at, await reconciliation.manualEvidence(db, tx, candidate.id, row), true);
        if (!['ready', 'already-paid'].includes(decision.state))
            return { state: 'review', reason: decision.reason };
        if (decision.state === 'ready' && env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED !== 'true')
            return { state: 'review', reason: 'Liquidação confirmada; baixa automática desativada.' };
        const link = { record, accountFingerprint: cfg.accountFingerprint, transactionId: candidate.id, uid: AUTO_LINK_UID, confirmedAt: at, checkedAt: at,
            previewId: null, state: decision.state, reason: decision.reason, baseline: reconciliation.revision(row), autoLink: { rule: AUTO_LINK_RULE, eventId: provenance.eventId } };
        if (!dryRun) {
            await reconciliation.apply(tx, db, rowRef, row, linkRef, link, { ...decision, returnEvidence: provenance }, at, body);
            tx.create(db.collection('boletoReconciliationAudit').doc(hash(['ret-auto-link', provenance.eventId])), {
                action: 'auto-link', uid: AUTO_LINK_UID, rule: AUTO_LINK_RULE, boletoId: record.id, transactionId: candidate.id, at, decision, returnEvidence: provenance, original: row });
        }
        return { state: dryRun ? 'ready' : 'settled', transactionId: candidate.id, reason: decision.state === 'ready'
            ? 'Baixa automática: lançamento único com o mesmo CPF/CNPJ, valor e vencimento, pagamento confirmado pelo banco.'
            : 'Recebimento existente conferido com o RET por CPF/CNPJ, valor e vencimento; nenhuma nova baixa.' };
    };
    return dryRun ? perform({ get: r => r.get() }) : db.runTransaction(perform);
}
async function runRetFiles({ db, env = process.env, fetchImpl = fetch, dryRun = false, deadline = Date.now() + 180000 }) {
    if (env.BOLETO_CLOUD_RETURN_ENABLED !== 'true' && !dryRun)
        return { disabled: true };
    const cfg = config(env);
    if (cfg.environment !== 'production' || !cfg.apiKey || !cfg.accountToken)
        throw Error('RETURN_CONFIGURATION_INVALID');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), cutover = env.BOLETO_CLOUD_CUTOVER_DATE;
    if (!validDay(cutover) || cutover > today)
        throw Error('RETURN_CUTOVER_INVALID');
    const jobRef = db.collection('boletoReturnJobs').doc('cnab-production'), lease = randomUUID();
    let prior = (await jobRef.get()).data() || {};
    if (!dryRun) {
        const claimed = await db.runTransaction(async (tx) => { prior = (await tx.get(jobRef)).data() || {}; if (prior.leaseUntil > Date.now())
            return false; tx.set(jobRef, { ...prior, lease, leaseUntil: Date.now() + 15 * 60000, state: 'running', startedAt: new Date().toISOString() }); return true; });
        if (!claimed)
            return { busy: true };
    }
    const counts = { files: 0, events: 0, settled: 0, review: 0, informational: 0, waiting: 0, ready: 0, errors: 0 };
    let backfill = validDay(prior.backfillDate) && prior.backfillDate >= cutover && prior.backfillDate <= today ? prior.backfillDate : cutover, backfillDone = false, more = false;
    let pendingQuery = db.collection('boletoReturnFiles').where('state', '==', 'pending').orderBy('__name__').limit(1);
    if (prior.pendingCursor)
        pendingQuery = pendingQuery.startAfter(prior.pendingCursor);
    const pending = (await pendingQuery.get()).docs;
    const pendingDate = pending[0]?.data()?.date;
    const dates = [...new Set([backfill, pendingDate, today, dayOffset(today, -1), dayOffset(today, -2)])].filter(d => validDay(d) && d >= cutover && d <= today);
    const write = async (ref, value) => { if (dryRun)
        return; await db.runTransaction(async (tx) => { const owner = (await tx.get(jobRef)).data(); if (owner?.lease !== lease || owner.leaseUntil <= Date.now())
        throw Error('LEASE_LOST');
        const latest = ref.path.startsWith('boletoReturnEvents/') ? (await tx.get(ref)).data() : null;
        if (latest?.manualResolution && latest.manualResolution.evidenceVersion === require('./boleto-ret-review').evidenceVersion({...latest,...value}) && latest.manualResolution.remainingCents === 0) value = {...value,state:'manual-resolved'};
        tx.set(ref, value, { merge: true }); }); };
    try {
        for (const date of dates) {
            let dateDone = true;
            if (Date.now() + 22000 >= deadline) {
                more = true;
                break;
            }
            try {
                const tokens = filesFrom(await get(cfg, `arquivos/cnab/retornos?${new URLSearchParams({ data: date, conta: cfg.accountToken })}`, fetchImpl), cfg, date);
                for (const token of tokens) {
                    if (Date.now() + 42000 >= deadline) {
                        dateDone = false;
                        more = true;
                        break;
                    }
                    const fileId = hash([cfg.accountFingerprint, token]), ref = db.collection('boletoReturnFiles').doc(fileId), old = (await ref.get()).data() || {};
                    const parsed = eventsFrom(await get(cfg, `arquivos/cnab/retornos/${encodeURIComponent(token)}`, fetchImpl), token);
                    const digest = hash(canonical(parsed.events));
                    const stored = (await db.collection('boletoReturnEvents').where('fileId', '==', fileId).get()).docs;
                    const priorEvents = stored.map(doc => ({ ...doc.data(), storedId: doc.id }));
                    const manifest = manifestFor(parsed.events);
                    // Legacy files have no manifest. Require a complete persisted evidence set before
                    // accepting a changed response; never guess the missing baseline.
                    if (old.digest && !old.manifest && old.digest !== digest && priorEvents.length !== old.eventCount)
                        throw Error('RETURN_BASELINE_INCOMPLETE');
                    const previousManifest = old.manifest || manifestFor(priorEvents);
                    const conflicts = revisionConflicts(previousManifest, manifest, priorEvents);
                    let unresolved = 0;
                    for (const original of priorEvents.filter(e => conflicts.has(titleKey(e)))) {
                        const incoming = parsed.events.filter(e => titleKey(e) === titleKey(original)).map(e => ({number:e.number, occurrence:e.occurrence}));
                        const evidenceConflict = {original:original.evidenceConflict?.original || original.occurrence, incoming, code:'RETURN_EVIDENCE_CONFLICT'};
                        const evidenceVersion = require('./boleto-ret-review').evidenceVersion({...original,evidenceConflict});
                        const resolved = original.manualResolution?.evidenceVersion === evidenceVersion && original.manualResolution?.remainingCents === 0;
                        unresolved += resolved ? 0 : 1;
                        await write(db.collection('boletoReturnEvents').doc(original.storedId), {
                            state:resolved ? 'manual-resolved' : 'review', evidenceConflict, evidenceVersion,
                            reason:'Retorno alterado ou removido pelo emissor. Conferência manual obrigatória; demais boletos continuam.',
                            checkedAt:new Date().toISOString()
                        });
                        if (original.boletoId) await write(db.collection('boletoManualResolutions').doc(original.boletoId), {reason:'RETURN_EVIDENCE_CONFLICT', eventId:original.storedId, requiresManualReview:true});
                        counts.review += resolved ? 0 : 1;
                    }
                    const previousByCore = new Map(priorEvents.map(event => [eventCore(event), event]));
                    if (old.digest && old.digest !== digest)
                        await write(db.collection('boletoReturnFileVersions').doc(hash([fileId, old.digest])), { fileId, digest: old.digest, manifest: previousManifest, eventCount: old.eventCount, capturedAt: old.checkedAt || null });
                    await write(db.collection('boletoReturnFileVersions').doc(hash([fileId, digest])), { fileId, digest, manifest, eventCount: parsed.events.length });
                    counts.files++;
                    await write(ref, { provider: 'boleto-cloud', accountFingerprint: cfg.accountFingerprint, date, digest, manifest: conflicts.size ? {...previousManifest, ...manifestFor(parsed.events.filter(e => !conflicts.has(titleKey(e))))} : manifest, lastError: null, manualReviewTitles: conflicts.size, protocol: parsed.protocol, createdAt: parsed.createdAt, eventCount: parsed.events.length, state: 'pending' });
                    let done = unresolved === 0, eventCursor = old.digest === digest && Number.isInteger(old.cursor) && old.cursor >= 0 && old.cursor < parsed.events.length ? old.cursor : 0;
                    for (let index = eventCursor; index < parsed.events.length; index++) {
                        const event = parsed.events[index];
                        if (conflicts.has(titleKey(event))) { eventCursor = index + 1; continue; }
                        if (Date.now() + 22000 >= deadline) {
                            done = false;
                            more = true;
                            break;
                        }
                        const known = previousByCore.get(eventCore(event));
                        const eventId = known?.storedId || hash([fileId, eventCore(event)]);
                        const eventRef = db.collection('boletoReturnEvents').doc(eventId), previous = known;
                        if (previous && ['settled', 'informational', 'manual-resolved'].includes(previous.state)) {
                            eventCursor = index + 1;
                            continue;
                        }
                        const at = new Date().toISOString(), provenance = { provider: 'boleto-cloud', fileId, eventId, fileDigest: digest, occurrenceCode: event.occurrence.codigo || null };
                        try {
                            const result = await settleEvent({ db, cfg, env, fetchImpl, event, provenance, lease, jobRef, at, dryRun });
                            counts.events++;
                            counts[result.state] = (counts[result.state] || 0) + 1;
                            await write(eventRef, { ...provenance, number: event.number, boletoId: event.token ? idFor(event.token) : null, occurrence: event.occurrence, state: result.state, reason: result.reason, checkedAt: at, ...(result.transactionId ? { transactionId: result.transactionId } : {}) });
                            if (!['settled', 'informational'].includes(result.state))
                                done = false;
                        }
                        catch (e) {
                            if (e.message === 'LEASE_LOST')
                                throw e;
                            counts.errors++;
                            done = false;
                            await write(eventRef, { ...provenance, number: event.number, state: 'error', boletoId: event.token ? idFor(event.token) : null, occurrence: event.occurrence, reason: 'Consulta não concluída; nova tentativa nos próximos ciclos.', errorCode: errorCode(e), checkedAt: at });
                        }
                        eventCursor = index + 1;
                        await write(ref, { cursor: eventCursor });
                    }
                    // A resumed pass can have earlier review events; keep the file pending until a full clean pass.
                    if (old.cursor > 0)
                        done = false;
                    await write(ref, { cursor: eventCursor === parsed.events.length ? 0 : eventCursor, state: done ? 'complete' : 'pending', checkedAt: new Date().toISOString() });
                    if (more || counts.errors)
                        dateDone = false;
                }
            }
            catch (e) {
                if (e.message === 'LEASE_LOST')
                    throw e;
                counts.errors++;
                counts.lastError = errorCode(e);
                dateDone = false;
            }
            if (date === backfill)
                backfillDone = dateDone;
        }
        await write(jobRef, { leaseUntil: 0, state: counts.errors ? 'error' : more ? 'partial' : 'complete', counts, more, settlementEnabled: env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED === 'true', autoLinkEnabled: env.BOLETO_CLOUD_RETURN_AUTO_LINK_ENABLED === 'true', pendingCursor: pending[0]?.id || '', backfillDate: backfillDone ? (backfill >= today ? cutover : dayOffset(backfill, 1)) : backfill, finishedAt: new Date().toISOString(), ...(!counts.errors && !more ? { lastSuccessAt: new Date().toISOString() } : {}) });
        return { dryRun, ...counts, more };
    }
    catch (e) {
        await write(jobRef, { leaseUntil: 0, state: 'error', finishedAt: new Date().toISOString() }).catch(() => { });
        throw Error('RETURN_FILES_JOB_FAILED');
    }
}
module.exports = { revisionConflicts, titleKey, runRetFiles, filesFrom, eventsFrom, paymentMatches, settleEvent, eventCore, manifestFor, validateRevision };
