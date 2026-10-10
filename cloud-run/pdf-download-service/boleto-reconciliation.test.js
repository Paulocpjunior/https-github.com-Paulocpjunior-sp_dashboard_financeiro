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
