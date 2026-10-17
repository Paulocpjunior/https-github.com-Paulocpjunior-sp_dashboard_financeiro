const test = require('node:test');
const assert = require('node:assert/strict');
const { filesFrom, eventsFrom, paymentMatches, runRetFiles, settleEvent, manifestFor, validateRevision } = require('./boleto-ret-files');
const cfg = { accountToken: 'account' };
const occurrence = { situacao: 'LIQUIDACAO', codigo: '06', info: { situacao: 'LIQUIDACAO', valorPago: 10, dataDePagamento: '2026-10-09', dataDeCredito: '2026-10-10' } };
const file = () => ({ arquivo: { meta: { token: 'file' }, protocolo: { banco: { codigo: '341' } }, titulos: [{ token: 'boleto', numero: '001', valor: 10, ocorrencias: [structuredClone(occurrence)] }] } });
const body = () => ({ boleto: { token: 'boleto', numero: '001', pagamento: { valor: 10, data: '2026-10-09', dataCredito: '2026-10-10' } } });
test('list requires account and date and deduplicates tokens', () => {
    const x = { retornos: { meta: { conta: 'account', data: '2026-10-14' }, arquivos: [{ token: 'a' }, { token: 'a' }] } };
    assert.deepEqual(filesFrom(x, cfg, '2026-10-14'), ['a']);
    assert.throws(() => filesFrom(x, { accountToken: 'other' }, '2026-10-14'));
    assert.throws(() => filesFrom(x, cfg, '2026-10-15'));
});
test('file identity and bank validated; informational occurrences may have null info/token', () => {
    const f = file();
    f.arquivo.titulos[0].token = null;
    f.arquivo.titulos[0].ocorrencias = [{ situacao: 'REGISTRO', info: null }];
    assert.equal(eventsFrom(f, 'file').events[0].token, null);
    assert.throws(() => eventsFrom(f, 'other'));
    f.arquivo.protocolo.banco.codigo = '237';
    assert.throws(() => eventsFrom(f, 'file'));
});
test('event identity excludes mutable title values, but distinguishes payment events', () => {
    const f = file(), id = eventsFrom(f, 'file').events[0].id;
    f.arquivo.titulos[0].valor = 20;
    assert.equal(eventsFrom(f, 'file').events[0].id, id);
    f.arquivo.titulos[0].ocorrencias[0].info.valorPago = 20;
    assert.notEqual(eventsFrom(f, 'file').events[0].id, id);
});
test('liquidation requires exact individual date, value, credit date and identity', () => {
    const e = eventsFrom(file(), 'file').events[0];
    assert.equal(paymentMatches(e, body()), true);
    for (const mutate of [b => b.boleto.token = 'x', b => b.boleto.numero = 'x', b => b.boleto.pagamento.valor = 11, b => b.boleto.pagamento.data = '2026-10-08', b => b.boleto.pagamento.dataCredito = '2026-10-11']) {
        const b = body();
        mutate(b);
        assert.equal(paymentMatches(e, b), false);
    }
    e.occurrence.info = null;
    assert.equal(Boolean(paymentMatches(e, body())), false);
});
test('unknown boleto and non-payment events never query or write financial records', async () => {
    const no = () => { throw Error('unexpected access'); };
    assert.equal((await settleEvent({ event: { token: null, occurrence }, db: { collection: no }, fetchImpl: no })).state, 'review');
    assert.equal((await settleEvent({ event: { occurrence: { situacao: 'REGISTRO' } }, db: { collection: no }, fetchImpl: no })).state, 'informational');
});
function fixture() {
    const records = new Map();
    const doc = p => ({ path: p, get: async () => ({ data: () => structuredClone(records.get(p)) }) });
    const db = { collection: c => ({ doc: id => doc(c + '/' + id), where: (field, op, value) => ({ get: async () => ({ docs: [...records.entries()].filter(([path, data]) => path.startsWith(c + '/') && data[field] === value).map(([path, data]) => ({ id: path.split('/')[1], data: () => structuredClone(data) })) }), orderBy: () => ({ limit: () => ({ startAfter: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }) }) }) }), runTransaction: async (fn) => { const writes = []; const r = await fn({ get: r => r.get(), set: (r, v) => writes.push(() => records.set(r.path, { ...records.get(r.path), ...structuredClone(v) })) }); writes.forEach(f => f()); return r; } };
    const env = { BOLETO_CLOUD_ENVIRONMENT: 'production', BOLETO_CLOUD_API_KEY: 'test', BOLETO_CLOUD_ACCOUNT_TOKEN: 'account', BOLETO_CLOUD_CUTOVER_DATE: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), BOLETO_CLOUD_RETURN_ENABLED: 'true' };
    let calls = 0;
    const fetchImpl = async (url, o) => { calls++; assert.equal(o.method, 'GET'); assert.equal(o.redirect, 'error'); return { ok: true, json: async () => url.includes('?') ? { retornos: { meta: { conta: 'account', data: env.BOLETO_CLOUD_CUTOVER_DATE }, arquivos: [{ token: 'file' }] } } : { arquivo: { meta: { token: 'file' }, protocolo: { banco: { codigo: '341' } }, titulos: [{ token: null, numero: '1', ocorrencias: [{ situacao: 'REGISTRO', info: null }] }] } } }; };
    return { db, env, fetchImpl, records, calls: () => calls };
}
test('durable file deduplication and dry-run has zero writes', async () => {
    const f = fixture();
    assert.equal((await runRetFiles({ ...f, dryRun: true })).informational, 1);
    assert.equal(f.records.size, 0);
    assert.equal((await runRetFiles(f)).informational, 1);
    const count = f.records.size;
    assert.equal((await runRetFiles(f)).events, 0);
    assert.equal(f.records.size, count);
    assert.equal([...f.records.keys()].some(k => k.startsWith('transactions/')), false);
});
test('provider failure records error and preserves retry date; concurrent lease prevents access', async () => {
    const f = fixture();
    const result = await runRetFiles({ ...f, fetchImpl: async () => ({ ok: false }) });
    assert.equal(result.errors, 1);
    assert.equal(f.records.get('boletoReturnJobs/cnab-production').backfillDate, f.env.BOLETO_CLOUD_CUTOVER_DATE);
    f.records.set('boletoReturnJobs/cnab-production', { lease: 'other', leaseUntil: Date.now() + 60000 });
    const before = f.calls();
    assert.deepEqual(await runRetFiles(f), { busy: true });
    assert.equal(f.calls(), before);
});
test('review stays pending and previously handled informational events are not applied again', async () => {
    const f = fixture(), original = f.fetchImpl;
    f.fetchImpl = async (url, o) => {
        const result = await original(url, o);
        if (url.includes('?'))
            return result;
        const body = await result.json();
        body.arquivo.titulos[0].ocorrencias.push(occurrence);
        return { ok: true, json: async () => body };
    };
    const first = await runRetFiles(f);
    assert.equal(first.review, 1);
    assert.equal(first.informational, 1);
    const fileEntry = [...f.records.entries()].find(([k]) => k.startsWith('boletoReturnFiles/'));
    assert.equal(fileEntry[1].state, 'pending');
    // Simulate a checkpoint after the first event; the remainder is still reviewed.
    f.records.set(fileEntry[0], { ...fileEntry[1], cursor: 1 });
    const second = await runRetFiles(f);
    assert.equal(second.review, 1);
    assert.equal(second.informational, 0);
    assert.equal(f.records.get(fileEntry[0]).cursor, 0);
    assert.equal([...f.records.keys()].some(k => k.startsWith('transactions/')), false);
});
test('charges in the file and changed file identity are never silently accepted', () => {
    const f = file();
    f.arquivo.titulos[0].ocorrencias[0].info.jurosMora = 1;
    assert.equal(paymentMatches(eventsFrom(f, 'file').events[0], body()), false);
});

function evolvingFixture() {
    const f = fixture();
    f.response = file();
    f.response.arquivo.titulos[0].token = null; // no financial access in integration fixture
    f.fetchImpl = async url => ({ ok: true, json: async () => url.includes('?')
        ? { retornos: { meta: { conta: 'account', data: f.env.BOLETO_CLOUD_CUTOVER_DATE }, arquivos: [{ token: 'file' }] } }
        : structuredClone(f.response) });
    return f;
}
test('completed files are revisited; appended events processed once even when reordered', async () => {
    const f = evolvingFixture();
    f.response.arquivo.titulos[0].ocorrencias = [{ situacao: 'REGISTRO', info: null }];
    assert.equal((await runRetFiles(f)).informational, 1);
    f.response.arquivo.titulos.unshift({ token: null, numero: '002', ocorrencias: [{ situacao: 'REGISTRO', info: null }] });
    assert.equal((await runRetFiles(f)).informational, 1);
    assert.equal((await runRetFiles(f)).events, 0);
    assert.equal([...f.records.keys()].filter(k => k.startsWith('boletoReturnEvents/')).length, 2);
    assert.equal([...f.records.keys()].some(k => k.startsWith('transactions/')), false);
});
test('legacy 3-to-26 enrichment preserves existing settled event IDs, processes only 23 new events', async () => {
    const f = evolvingFixture();
    const title = structuredClone(f.response.arquivo.titulos[0]);
    title.ocorrencias[0].info.dataDeCredito = null;
    f.response.arquivo.titulos = Array.from({ length: 3 }, (_, i) => ({ ...structuredClone(title), numero: String(i) }));
    await runRetFiles(f);
    const entry = [...f.records.entries()].find(([k]) => k.startsWith('boletoReturnFiles/'));
    delete entry[1].manifest; // pre-fix schema; preserve the old digest and occurrence evidence
    for (const [key, event] of f.records) if (key.startsWith('boletoReturnEvents/')) event.state = 'settled';
    f.response.arquivo.titulos = Array.from({ length: 26 }, (_, i) => ({ ...structuredClone(title), numero: String(i) }));
    for (const t of f.response.arquivo.titulos) t.ocorrencias[0].info.dataDeCredito = '2026-10-10';
    const result = await runRetFiles(f);
    assert.equal(result.errors, 0);
    assert.equal(result.events, 23);
    assert.equal([...f.records.values()].filter(x => x.state === 'settled').length, 3);
    assert.equal([...f.records.keys()].filter(k => k.startsWith('boletoReturnEvents/')).length, 26);
    assert.equal([...f.records.keys()].some(k => k.startsWith('transactions/')), false);
    assert.ok([...f.records.keys()].filter(k => k.startsWith('boletoReturnFileVersions/')).length >= 2);
});
test('changed titles are quarantined without blocking independent occurrences', async () => {
    for (const mutate of [b => b.arquivo.titulos[0].ocorrencias[0].info.valorPago = 11,
        b => b.arquivo.titulos = [], b => b.arquivo.titulos[0].ocorrencias[0].info.dataDeCredito = '2026-10-11']) {
        const f = evolvingFixture();
        await runRetFiles(f);
        mutate(f.response);
        f.response.arquivo.titulos.push({token:null,numero:'unaffected',ocorrencias:[{situacao:'REGISTRO',info:null}]});
        const result = await runRetFiles(f);
        assert.equal(result.errors, 0);
        assert.equal(result.review, 1);
        assert.equal(result.informational, 1);
        const event=[...f.records.values()].find(e=>e.evidenceConflict);
        assert.equal(event.state,'review');
        assert.equal(event.evidenceConflict.code,'RETURN_EVIDENCE_CONFLICT');
        assert.deepEqual(event.occurrence,event.evidenceConflict.original);
        assert.equal((await runRetFiles(f)).review,1);
        event.manualResolution={evidenceVersion:event.evidenceVersion,remainingCents:1};
        assert.equal((await runRetFiles(f)).review,1);
        const updated=[...f.records.values()].find(e=>e.evidenceConflict);
        updated.manualResolution={evidenceVersion:updated.evidenceVersion,remainingCents:0};
        assert.equal((await runRetFiles(f)).review,0);
    }
});
test('ambiguous occurrences and incomplete legacy baselines remain blocked', async () => {
    const f = evolvingFixture();
    await runRetFiles(f);
    const entry = [...f.records.entries()].find(([k]) => k.startsWith('boletoReturnFiles/'))[1];
    delete entry.manifest;
    entry.eventCount = 2;
    f.response.arquivo.titulos[0].ocorrencias[0].info.dataDeCredito = '2026-10-11';
    assert.equal((await runRetFiles(f)).lastError, 'RETURN_BASELINE_INCOMPLETE');
    const events = eventsFrom(file(), 'file').events;
    assert.throws(() => manifestFor([...events, ...events]), /RETURN_AMBIGUOUS_OCCURRENCE/);
    const old = manifestFor(events);
    events[0].occurrence.info.dataDeCredito = null;
    assert.throws(() => validateRevision(old, manifestFor(events)), /RETURN_EVIDENCE_CONFLICT/);
});
