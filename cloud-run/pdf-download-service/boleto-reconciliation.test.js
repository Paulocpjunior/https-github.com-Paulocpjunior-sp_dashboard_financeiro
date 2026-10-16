const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  evaluate,
  handleReconciliation,
  runReconciliations,
} = require("./boleto-reconciliation");
const { config, eligible } = require("./boleto-cloud");
const record = {
  id: "a".repeat(64),
  token: "synthetic-token",
  payerDocument: "52998224725",
  number: "001",
  amountCents: 1000,
  dueDate: "2026-10-09",
  createdAt: "2026-10-01",
  bank: "341",
  beneficiaryDocument: "11222333000181",
};
const row = {
  movement: "Entrada",
  source: "jotform",
  status: "Pendente",
  pago: "Não",
  cpfCnpj: "529.982.247-25",
  dueDate: record.dueDate,
  totalCobranca: 10,
  valueReceived: 0,
  bankAccount: require("./native-entry-catalog.json").banks[0],
  client: "Teste",
  paymentMethod: "Boleto",
};
const paid = {
  boleto: {
    token: record.token,
    numero: "001",
    emissao: record.createdAt,
    vencimento: record.dueDate,
    valor: 10,
    pagador: { cprf: record.payerDocument },
    situacao: "PAGO",
    pagamento: {
      origem: "BANCO",
      situacao: "PAGAMENTO_INFORMADO",
      marcadoComoPago: false,
      data: "2026-10-09",
      valor: 10,
    },
  },
};
const open = {
  boleto: { ...paid.boleto, situacao: "EM_ABERTO", pagamento: null },
};
const env = {
  BOLETO_CLOUD_CUTOVER_DATE: "2026-10-01",
  BOLETO_CLOUD_ENVIRONMENT: "production",
  BOLETO_CLOUD_PRODUCTION_ENABLED: "true",
  BOLETO_CLOUD_API_KEY: "fake",
  BOLETO_CLOUD_ACCOUNT_TOKEN: "fake-account",
  BOLETO_CLOUD_RETURN_ENABLED: "true",
  BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED: "true",
};
const at = "2026-10-10T15:00:00Z";
test("only integral bank payment of the exact identity is ready; all mismatches stay review", () => {
  assert.equal(evaluate(record, row, paid, at).state, "ready");
  for (const patch of [
    { cpfCnpj: "" },
    { dueDate: "2026-10-08" },
    { totalCobranca: 11 },
    { isExcluded: true },
    { movement: "Saída" },
    { source: "native-finance" },
    { bankAccount: "other" },
    { valueReceived: 1 },
    { boletoSettlement: {} },
  ])
    assert.equal(
      evaluate(record, { ...row, ...patch }, paid, at).state,
      "review",
    );
  for (const patch of [
    { origem: "MANUAL" },
    { marcadoComoPago: true },
    { valor: 9 },
    { juros: 1 },
    { data: "2099-01-01" },
    { data: "2026-02-30" },
  ])
    assert.equal(
      evaluate(
        record,
        row,
        {
          boleto: {
            ...paid.boleto,
            pagamento: { ...paid.boleto.pagamento, ...patch },
          },
        },
        at,
      ).state,
      "review",
    );
  assert.equal(
    evaluate(record, row, { boleto: { ...paid.boleto, token: "other" } }, at)
      .state,
    "review",
  );
  assert.equal(evaluate(record, row, open, at).state, "waiting");
  assert.equal(
    evaluate(
      record,
      { ...row, status: "Pago", valueReceived: 10, paymentDate: "2026-10-09" },
      paid,
      at,
    ).state,
    "already-paid",
  );
  assert.equal(
    evaluate(
      record,
      { ...row, status: "Pago", valueReceived: 9, paymentDate: "2026-10-09" },
      paid,
      at,
    ).state,
    "review",
  );
  assert.equal(
    eligible({ ...row, boletoReconciliation: { boletoId: record.id } }),
    false,
  );
});
function fixture() {
  const data = new Map([
    ["users/u", { active: true, role: "admin" }],
    ["transactions/t", structuredClone(row)],
  ]);
  let body = structuredClone(paid),
    calls = 0;
  const snap = (path) => ({
    id: path.split("/").at(-1),
    data: () => structuredClone(data.get(path)),
  });
  const ref = (path) => ({
    path,
    get: async () => snap(path),
    set: async (value) => data.set(path, structuredClone(value)),
  });
  const collection = (path) => {
    let filters = [],
      limit = Infinity,
      after = "";
    const query = {
      doc: (id) => ref(`${path}/${id}`),
      where: (key, op, val) => {
        filters.push([key, val]);
        return query;
      },
      orderBy: () => query,
      limit: (n) => {
        limit = n;
        return query;
      },
      startAfter: (id) => {
        after = id;
        return query;
      },
      get: async () => ({
        docs: [...data.keys()]
          .filter(
            (k) =>
              k.startsWith(path + "/") &&
              !k.slice(path.length + 1).includes("/") &&
              k.split("/").at(-1) > after &&
              filters.every(([key, val]) => data.get(k)[key] === val),
          )
          .sort()
          .slice(0, limit)
          .map(snap),
      }),
    };
    return query;
  };
  const db = {
    collection,
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: (r) => r.get(),
        set: (r, v) => writes.push([r.path, v]),
        update: (r, v) => writes.push([r.path, { ...data.get(r.path), ...v }]),
        create: (r, v) => {
          if (data.has(r.path)) throw Error("EXISTS");
          writes.push([r.path, v]);
        },
      });
      for (const [k, v] of writes) data.set(k, structuredClone(v));
      return result;
    },
  };
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => structuredClone(body) };
  };
  return {
    data,
    db,
    fetchImpl,
    setBody: (b) => {
      body = b;
    },
    calls: () => calls,
    async call(operation, input, override = {}) {
      const req = Readable.from(input ? [JSON.stringify(input)] : []);
      req.method = input ? "POST" : "GET";
      const res = {};
      await handleReconciliation({
        req,
        res,
        db,
        uid: "u",
        record,
        operation,
        sendJson: (_q, r, status, result) =>
          Object.assign(r, { status, body: result }),
        env,
        fetchImpl,
        ...override,
      });
      return res.body;
    },
  };
}
test("review is read-only for financial data; explicit confirmation settles exactly once", async () => {
  const f = fixture(),
    before = structuredClone(f.data.get("transactions/t"));
  const p = await f.call("reconcile-preview", { transactionId: "t" });
  assert.deepEqual(f.data.get("transactions/t"), before);
  await f.call("reconcile-confirm", { previewId: p.previewId });
  const saved = structuredClone(f.data.get("transactions/t"));
  assert.equal(saved.status, "Pago");
  assert.equal(saved.valueReceived, 10);
  await f.call("reconcile-confirm", { previewId: p.previewId });
  assert.deepEqual(f.data.get("transactions/t"), saved);
  assert.equal(
    [...f.data.keys()].filter((k) =>
      k.startsWith("boletoReconciliationSettlements/"),
    ).length,
    1,
  );
});
test("already-paid link never rewrites payment amounts or creates settlement", async () => {
  const f = fixture();
  f.data.set("transactions/t", {
    ...row,
    status: "Pago",
    pago: "Pago",
    valueReceived: 10,
    paymentDate: "2026-10-09",
  });
  const original = structuredClone(f.data.get("transactions/t"));
  const p = await f.call("reconcile-preview", { transactionId: "t" });
  assert.equal(p.decision.state, "already-paid");
  await f.call("reconcile-confirm", { previewId: p.previewId });
  const { boletoReconciliation, ...rest } = f.data.get("transactions/t");
  assert.deepEqual(rest, original);
  assert.ok(boletoReconciliation);
  assert.ok(
    ![...f.data.keys()].some((k) =>
      k.startsWith("boletoReconciliationSettlements/"),
    ),
  );
});
test("access, expired review, changed row, changed bank response, and competing links cannot settle", async () => {
  for (const mode of ["revoked", "expired", "row", "bank", "link"]) {
    const f = fixture();
    const p = await f.call("reconcile-preview", { transactionId: "t" });
    if (mode === "revoked")
      f.data.set("users/u", { active: false, role: "admin" });
    if (mode === "expired")
      f.data.get(`boletoReconciliationPreviews/${p.previewId}`).expiresAt = 0;
    if (mode === "row") f.data.get("transactions/t").totalCobranca = 11;
    if (mode === "bank") f.setBody(open);
    if (mode === "link")
      f.data.get("transactions/t").boletoReconciliation = { boletoId: "other" };
    await assert.rejects(() =>
      f.call("reconcile-confirm", { previewId: p.previewId }),
    );
    assert.equal(f.data.get("transactions/t").status, "Pendente");
  }
  const f = fixture();
  f.data.set("users/u", {
    active: true,
    role: "operacional",
    financialPermissions: ["billing.boleto-cloud.history.read"],
  });
  await assert.rejects(() => f.call("reconcile"));
  assert.equal(f.calls(), 0);
});
test("confirmed open legacy boleto is settled by API worker; unlinked receivable untouched", async () => {
  const f = fixture();
  f.setBody(open);
  const p = await f.call("reconcile-preview", { transactionId: "t" });
  await f.call("reconcile-confirm", { previewId: p.previewId });
  assert.equal(f.data.get("transactions/t").status, "Pendente");
  f.data.set("transactions/unlinked", structuredClone(row));
  f.setBody(paid);
  await runReconciliations({ db: f.db, env, fetchImpl: f.fetchImpl });
  assert.equal(f.data.get("transactions/t").status, "Pago");
  assert.equal(f.data.get("transactions/unlinked").status, "Pendente");
  const after = structuredClone(
    [...f.data].filter(([k]) => k.startsWith("transactions/")),
  );
  await runReconciliations({ db: f.db, env, fetchImpl: f.fetchImpl });
  assert.deepEqual(
    [...f.data].filter(([k]) => k.startsWith("transactions/")),
    after,
  );
});
test("worker leaves changed linked records for review; provider outage preserves financial state", async () => {
  for (const mode of ["row", "outage"]) {
    const f = fixture();
    f.setBody(open);
    const p = await f.call("reconcile-preview", { transactionId: "t" });
    await f.call("reconcile-confirm", { previewId: p.previewId });
    if (mode === "row") f.data.get("transactions/t").totalCobranca = 11;
    const before = structuredClone(f.data.get("transactions/t"));
    f.setBody(paid);
    const result = await runReconciliations({
      db: f.db,
      env,
      fetchImpl:
        mode === "outage"
          ? async () => {
              throw Error("offline");
            }
          : f.fetchImpl,
    });
    assert.deepEqual(f.data.get("transactions/t"), before);
    assert.equal(result[mode === "row" ? "review" : "errors"], 1);
  }
});

test("a native issue created after preview fences historical confirmation", async () => {
  const f = fixture();
  const p = await f.call("reconcile-preview", { transactionId: "t" });
  const id = require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify(["production", "t"]))
    .digest("hex");
  f.data.set(`boletoIssues/${id}`, { state: "issuing" });
  await assert.rejects(() =>
    f.call("reconcile-confirm", { previewId: p.previewId }),
  );
  assert.equal(f.data.get("transactions/t").status, "Pendente");
});
test("baseline survives Firestore field ordering; lease and disabled flag prevent work", async () => {
  const f = fixture();
  f.setBody(open);
  const p = await f.call("reconcile-preview", { transactionId: "t" });
  await f.call("reconcile-confirm", { previewId: p.previewId });
  const saved = f.data.get("transactions/t");
  f.data.set(
    "transactions/t",
    Object.fromEntries(Object.entries(saved).reverse()),
  );
  f.setBody(paid);
  await runReconciliations({ db: f.db, env, fetchImpl: f.fetchImpl });
  assert.equal(f.data.get("transactions/t").status, "Pago");
  const before = f.calls();
  f.data.set("boletoReturnJobs/reconciliations-production", {
    leaseUntil: Date.now() + 60000,
  });
  assert.equal(
    (await runReconciliations({ db: f.db, env, fetchImpl: f.fetchImpl })).busy,
    true,
  );
  assert.equal(
    (
      await runReconciliations({
        db: f.db,
        env: { ...env, BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED: "false" },
        fetchImpl: f.fetchImpl,
      })
    ).disabled,
    true,
  );
  assert.equal(f.calls(), before);
});

test("recebimento manual impede nova baixa bancária",()=>{
 assert.equal(evaluate(record,{...row,receivableSettlement:{origin:'manual'}},paid,'2026-10-12T12:00:00Z').state,'review');
});

test('RET settles only confirmed historical links, records provenance and fences manual receipts',async()=>{
 const {settleEvent}=require('./boleto-ret-files'),{idFor}=require('./boleto-history'),{revision}=require('./boleto-reconciliation');
 for(const manual of [false,true]) {
  const f=fixture(),boletoId=idFor(record.token),linkedRecord={...record,id:boletoId};
  const current=f.data.get('transactions/t');
  if(manual)current.receivableSettlement={method:'PIX'};
  f.data.set('boletoReconciliations/'+boletoId,{record:linkedRecord,transactionId:'t',state:'waiting',baseline:revision(current),accountFingerprint:config(env).accountFingerprint,uid:'u',confirmedAt:at});
  const jobRef=f.db.collection('boletoReturnJobs').doc('cnab-production');f.data.set(jobRef.path,{lease:'ret',leaseUntil:Date.now()+60000});
  const args={db:f.db,cfg:config(env),env,fetchImpl:f.fetchImpl,event:{token:record.token,number:'001',occurrence:{situacao:'LIQUIDACAO',info:{situacao:'LIQUIDACAO',valorPago:10,dataDePagamento:'2026-10-09'}}},provenance:{fileId:'file',eventId:'event'},jobRef,lease:'ret',at,dryRun:false};
  assert.equal((await settleEvent(args)).state,manual?'review':'settled');
  if(manual)assert.equal(f.data.get('transactions/t').status,'Pendente');
  else{assert.deepEqual(f.data.get('transactions/t').boletoSettlement.returnEvidence,args.provenance);assert.equal((await settleEvent(args)).state,'settled');assert.equal([...f.data.keys()].filter(k=>k.startsWith('boletoReconciliationSettlements/')).length,1);}
 }
});

function auditedFixture(method = '11-Boleto ITAU') {
  const f = fixture();
  const receipt = { uid: 'operator', requestId: 'receipt-1', origin: 'manual', date: paid.boleto.pagamento.data,
    amountCents: 1000, remainingCents: 0, interestCents: 0, discountCents: 0, bankAccount: row.bankAccount, method };
  const original = { ...row, bankAccount: '', status: 'Pago', pago: 'Pago', valueReceived: 10,
    paymentDate: receipt.date, receivableSettlement: receipt, receivableReceipts: [receipt],
    receivableBalance: { receivedCents: 1000, remainingCents: 0, interestCents: 0, discountCents: 0 } };
  f.data.set('transactions/t', structuredClone(original));
  const auditKey = 'receivableAudit/' + require('node:crypto').createHash('sha256').update(JSON.stringify([receipt.uid, receipt.requestId])).digest('hex');
  f.data.set(auditKey, { action: 'receipt', uid: receipt.uid, transactionId: 't', after: structuredClone(original) });
  f.setBody({ boleto: { ...paid.boleto, pagamento: { ...paid.boleto.pagamento, forma: 'BOLETO' } } });
  return { f, original, auditKey };
}
test('audited manual boleto links preserve every payment field and original method, including Wix classification', async () => {
  for (const method of ['11-Boleto ITAU', '12-Boleto Wix']) {
    const { f, original } = auditedFixture(method);
    const p = await f.call('reconcile-preview', { transactionId: 't' });
    assert.equal(p.decision.state, 'already-paid');
    await f.call('reconcile-confirm', { previewId: p.previewId });
    const { boletoReconciliation, ...after } = f.data.get('transactions/t');
    assert.deepEqual(after, original);
    assert.equal(boletoReconciliation.originalMethod, method);
    assert.equal(boletoReconciliation.confirmedMethod, '11-Boleto ITAU');
    assert.equal([...f.data.keys()].filter(k => k.startsWith('boletoReconciliationSettlements/')).length, 0);
  }
});
test('missing/tampered audit, Pix, partial payment and adjustment never qualify as already paid manual boleto', async () => {
  for (const mode of ['missing', 'tampered', 'pix', 'partial', 'interest']) {
    const { f, auditKey } = auditedFixture();
    if (mode === 'missing') f.data.delete(auditKey);
    if (mode === 'tampered') f.data.get(auditKey).after.valueReceived = 9;
    if (mode === 'pix') f.data.get('transactions/t').receivableSettlement.method = '3- Pix -ITAU';
    if (mode === 'partial') f.data.get('transactions/t').receivableBalance.remainingCents = 1;
    if (mode === 'interest') f.data.get('transactions/t').receivableSettlement.interestCents = 1;
    const p = await f.call('reconcile-preview', { transactionId: 't' });
    assert.equal(p.decision.state, 'review', mode);
  }
});
test('audit is reread inside confirmation transaction, preventing changed proof after preview', async () => {
  const { f, auditKey, original } = auditedFixture();
  const p = await f.call('reconcile-preview', { transactionId: 't' });
  f.data.delete(auditKey);
  await assert.rejects(() => f.call('reconcile-confirm', { previewId: p.previewId }));
  assert.deepEqual(f.data.get('transactions/t'), original);
});
test('RET recognizes audited linked receipt without writing money; later reversal or missing proof stays review', async () => {
  const { settleEvent } = require('./boleto-ret-files');
  const { idFor } = require('./boleto-history');
  for (const mode of ['valid', 'reversed', 'audit-missing']) {
    const { f, auditKey } = auditedFixture();
    const p = await f.call('reconcile-preview', { transactionId: 't' });
    await f.call('reconcile-confirm', { previewId: p.previewId });
    const boletoId = idFor(record.token), link = f.data.get('boletoReconciliations/' + record.id);
    f.data.delete('boletoReconciliations/' + record.id);
    link.record.id = boletoId;
    const current = f.data.get('transactions/t');
    current.boletoReconciliation.boletoId = boletoId;
    link.baseline = require('./boleto-reconciliation').revision(current);
    f.data.set('boletoReconciliations/' + boletoId, link);
    if (mode === 'reversed') { current.status = 'Pendente'; current.valueReceived = 0; }
    if (mode === 'audit-missing') f.data.delete(auditKey);
    const before = structuredClone(current);
    const jobRef = f.db.collection('boletoReturnJobs').doc('cnab-production');
    f.data.set(jobRef.path, { lease: 'ret', leaseUntil: Date.now() + 60000 });
    const outcome = await settleEvent({ db: f.db, cfg: config(env), env, fetchImpl: f.fetchImpl,
      event: { token: record.token, number: '001', occurrence: { situacao: 'LIQUIDACAO', info: { situacao: 'LIQUIDACAO', valorPago: 10, dataDePagamento: '2026-10-09' } } },
      provenance: { fileId: 'file', eventId: 'event' }, jobRef, lease: 'ret', at, dryRun: false });
    assert.equal(outcome.state, mode === 'valid' ? 'settled' : 'review');
    assert.deepEqual(f.data.get('transactions/t'), before);
    assert.equal([...f.data.keys()].filter(k => k.startsWith('boletoReconciliationSettlements/')).length, 0);
  }
});
function retFixture() {
 const f=fixture(), id='e'.repeat(64);
 f.data.set('transactions/t',{...row,bankAccount:''});
 f.data.set('boletoReturnEvents/'+id,{boletoId:record.id,fileId:'file',number:record.number,state:'review',occurrenceCode:'06',occurrence:{situacao:'LIQUIDACAO',info:{situacao:'LIQUIDACAO',dataDePagamento:'2026-10-09',valorPago:10}}});
 f.data.set('boletoReturnFiles/file',{accountFingerprint:config(env).accountFingerprint});
 return {...f,eventId:id};
}
test('confirmed RET establishes an empty account, retains provenance and settles exactly once',async()=>{
 const f=retFixture();
 const p=await f.call('reconcile-preview',{transactionId:'t',retEventId:f.eventId});
 assert.equal(p.decision.state,'ready');assert.equal(f.data.get('transactions/t').status,'Pendente');
 await f.call('reconcile-confirm',{previewId:p.previewId});
 assert.equal(f.data.get('transactions/t').bankAccount,row.bankAccount);
 assert.equal(f.data.get('transactions/t').boletoSettlement.returnEvidence.eventId,f.eventId);
 assert.equal(f.data.get('boletoReturnEvents/'+f.eventId).state,'settled');
 await f.call('reconcile-confirm',{previewId:p.previewId});
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('boletoReconciliationSettlements/')).length,1);
});
test('RET cannot override another account, missing evidence, wrong title or changed proof',async()=>{
 const f=retFixture();f.data.set('transactions/t',{...row,bankAccount:'Outra conta'});
 const bad=await f.call('reconcile-preview',{transactionId:'t',retEventId:f.eventId});assert.equal(bad.decision.state,'review');
 await assert.rejects(f.call('reconcile-preview',{transactionId:'t',retEventId:'d'.repeat(64)}));
 const g=retFixture();const p=await g.call('reconcile-preview',{transactionId:'t',retEventId:g.eventId});
 g.data.get('boletoReturnEvents/'+g.eventId).occurrence.info.valorPago=12;
 await assert.rejects(g.call('reconcile-confirm',{previewId:p.previewId}));assert.equal(g.data.get('transactions/t').status,'Pendente');
 const h=retFixture();h.data.get('boletoReturnFiles/file').accountFingerprint='other';
 await assert.rejects(h.call('reconcile-preview',{transactionId:'t',retEventId:h.eventId}));
});
test('RET paid-account link preserves money and records no second settlement',async()=>{
 const f=retFixture();f.data.set('transactions/t',{...row,status:'Pago',valueReceived:10,paymentDate:'2026-10-09'});
 const p=await f.call('reconcile-preview',{transactionId:'t',retEventId:f.eventId});assert.equal(p.decision.state,'already-paid');
 await f.call('reconcile-confirm',{previewId:p.previewId});
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('boletoReconciliationSettlements/')).length,0);
 assert.equal(f.data.get('transactions/t').valueReceived,10);
});
