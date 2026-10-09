const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { createNativeEntryHandler } = require("./native-entries");
const { due, emails, calendar } = require("./payables");
const catalog = require("./native-entry-catalog.json");
const row = () => ({
  movement: "Saída",
  type: "Saída de Caixa / Contas a Pagar",
  source: "jotform",
  submissionId: "original",
  description: "Internet",
  client: "Internet",
  dueDate: "2099-01-31",
  date: "2026-01-01",
  status: "Pendente",
  valuePaid: 100,
  valorOriginal: 100,
  valorPago: "",
  paymentDate: "",
  dataPagamento: "",
  bankAccount: catalog.banks[0],
  metodoPagamento: catalog.paymentMethods[0],
});
function harness() {
  const store = new Map([
      ["users/u", { active: true, role: "admin" }],
      ["transactions/legacy", row()],
    ]),
    objects = new Map();
  let queue = Promise.resolve();
  const snap = (p) => ({
    id: p.split("/").at(-1),
    exists: store.has(p),
    data: () => structuredClone(store.get(p)),
  });
  const doc = (p) => ({ path: p, get: async () => snap(p) });
  const query = (p, filters = [], max = 10000) => ({
    where: (k, op, v) => query(p, [...filters, [k, v]], max),
    limit: (n) => query(p, filters, n),
    get: async () => ({
      docs: [...store.keys()]
        .filter(
          (k) =>
            k.startsWith(p + "/") &&
            !k.slice(p.length + 1).includes("/") &&
            filters.every(([f, v]) => store.get(k)[f] === v),
        )
        .slice(0, max)
        .map(snap),
    }),
  });
  const db = {
    collection: (p) => ({ ...query(p), doc: (id) => doc(p + "/" + id) }),
    runTransaction: (fn) => {
      const run = queue.then(async () => {
        const writes = [];
        const r = await fn({
          get: (ref) => ref.get(),
          set: (ref, data) => writes.push([ref.path, data, false]),
          create: (ref, data) => writes.push([ref.path, data, true]),
        });
        for (const [p, , create] of writes)
          if (create) assert.ok(!store.has(p));
        for (const [p, d] of writes) store.set(p, structuredClone(d));
        return r;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  const env = {
    NATIVE_ENTRY_ENABLED: "true",
    NATIVE_ENTRY_ATTACHMENT_BUCKET: "fixture",
  };
  const handler = createNativeEntryHandler({
    getServices: () => ({
      adminDb: db,
      adminAuth: {
        verifyIdToken: async (t) => {
          if (t !== "good") throw Error();
          return { uid: "u" };
        },
      },
    }),
    env,
    readBody: async (r) => Buffer.from(JSON.stringify(r.body)),
    sendJson: (_r, res, status, body) => Object.assign(res, { status, body }),
    getBucket: () => ({
      file: (p) => ({
        save: async (bytes) => objects.set(p, bytes),
        download: async () => [objects.get(p)],
      }),
    }),
  });
  return {
    store,
    env,
    objects,
    async call(path, body, token = "good") {
      const r = {};
      await handler(
        {
          url: "/api/financial-entries/payables/" + path,
          method: body ? "POST" : "GET",
          headers: { authorization: token ? "Bearer " + token : "" },
          body,
        },
        r,
      );
      return r;
    },
  };
}
async function payBody(h) {
  const r = await h.call("items/legacy");
  return {
    id: "legacy",
    version: r.body.version,
    requestId: randomUUID(),
    payment: {
      date: "2026-01-01",
      amount: "100.00",
      bankAccount: catalog.banks[0],
      method: catalog.paymentMethods[0],
      note: "Teste fictício",
    },
    attachments: [],
  };
}
async function ruleBody(h) {
  return {
    ...(await payBody(h)),
    start: "2099-01",
    end: "2099-12",
    day: 31,
    mode: "fixed",
    active: true,
    ruleRevision: 0,
    recipients: [],
  };
}
test("payable review is read-only, commit updates exact legacy ID and repeated confirmation writes once", async () => {
  const h = harness(),
    b = await payBody(h),
    before = structuredClone([...h.store]);
  const preview = await h.call("payment/preview", b);
  assert.equal(preview.status, 200);
  assert.deepEqual([...h.store], before);
  b.confirmHash = preview.body.reviewHash;
  const results = await Promise.all([
    h.call("payment/commit", b),
    h.call("payment/commit", b),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  const paid = h.store.get("transactions/legacy");
  assert.equal(paid.status, "Pago");
  assert.equal(paid.submissionId, "original");
  assert.equal(paid.valuePaid, 100);
  assert.equal(paid.valorPago, "100.00");
  assert.equal(paid.payableSettlement.origin, "manual");
  assert.equal(
    [...h.store.keys()].filter((k) => k.startsWith("transactions/")).length,
    1,
  );
  assert.equal(
    [...h.store.keys()].filter((k) => k.startsWith("payableAudit/")).length,
    1,
  );
  assert.equal(
    (
      await h.call("payment/commit", {
        ...b,
        payment: { ...b.payment, note: "different" },
      })
    ).status,
    409,
  );
});
test("blocks unauthorized, disabled, stale and partial payments without changing data", async () => {
  const h = harness(),
    b = await payBody(h);
  assert.equal((await h.call("payment/preview", b, "")).status, 401);
  h.env.NATIVE_ENTRY_ENABLED = "false";
  assert.equal((await h.call("payment/preview", b)).status, 503);
  h.env.NATIVE_ENTRY_ENABLED = "true";
  assert.equal(
    (
      await h.call("payment/preview", {
        ...b,
        payment: { ...b.payment, amount: "50" },
      })
    ).status,
    400,
  );
  const p = await h.call("payment/preview", b);
  h.store.get("transactions/legacy").observacaoAPagar = "changed";
  assert.equal(
    (await h.call("payment/commit", { ...b, confirmHash: p.body.reviewHash }))
      .status,
    409,
  );
  h.store.set("users/u", { active: true, role: "operator" });
  assert.equal((await h.call("items/legacy")).status, 403);
  assert.equal(h.store.get("transactions/legacy").status, "Pendente");
});
test("proof is private and stored with audit; existing attachment survives", async () => {
  const h = harness();
  h.store.get("transactions/legacy").attachments = [
    { name: "previous", sha256: "previous" },
  ];
  const b = await payBody(h);
  b.attachments = [
    {
      name: "comprovante.pdf",
      type: "application/pdf",
      kind: "comprovante",
      base64: Buffer.from("%PDF-1.4 fixture").toString("base64"),
    },
  ];
  const p = await h.call("payment/preview", b);
  assert.equal(
    (await h.call("payment/commit", { ...b, confirmHash: p.body.reviewHash }))
      .status,
    200,
  );
  const files = h.store.get("transactions/legacy").attachments;
  assert.equal(files.length, 2);
  assert.ok(h.objects.has(files[1].path));
  const downloaded = await h.call("../attachments/legacy/" + files[1].sha256);
  assert.equal(downloaded.status, 200);
});
test("recurrence saves separately, clamps month end, generates once and does not copy payment or invoice", async () => {
  const h = harness();
  const rule = await ruleBody(h);
  assert.equal((await h.call("rules/save", rule)).status, 200);
  assert.equal((await h.call("rules/save", rule)).status, 200);
  const b = { id: "legacy", month: "2099-02", requestId: randomUUID() };
  const p = await h.call("rules/preview", b);
  assert.equal(p.status, 200);
  assert.equal(p.body.transaction.dueDate, "2099-02-28");
  assert.equal(p.body.transaction.submissionId, undefined);
  assert.deepEqual(p.body.transaction.attachments, []);
  const commit = { ...b, confirmHash: p.body.reviewHash };
  assert.equal((await h.call("rules/generate", commit)).status, 200);
  assert.equal((await h.call("rules/generate", commit)).status, 200);
  assert.equal(
    (await h.call("rules/preview", { ...b, requestId: randomUUID() })).status,
    409,
  );
  assert.equal(
    (
      await h.call("rules/preview", {
        ...b,
        requestId: randomUUID(),
        month: "2099-01",
      })
    ).status,
    409,
  );
});
test("variable recurrence requires confirmed value, respects pause and checks legacy duplicate", async () => {
  const h = harness();
  const rule = await ruleBody(h);
  rule.mode = "variable";
  await h.call("rules/save", rule);
  const b = { id: "legacy", month: "2099-03", requestId: randomUUID() };
  assert.equal((await h.call("rules/preview", b)).status, 400);
  assert.equal(
    (await h.call("rules/preview", { ...b, amount: "120.00" })).status,
    200,
  );
  h.store.set("transactions/already", {
    ...row(),
    dueDate: "2099-03-31",
    valuePaid: 120,
    valorOriginal: 120,
  });
  assert.equal(
    (await h.call("rules/preview", { ...b, amount: "120.00" })).status,
    409,
  );
  h.store.get("payableRecurrences/legacy").active = false;
  assert.equal(
    (
      await h.call("rules/preview", {
        ...b,
        month: "2099-04",
        amount: "120.00",
      })
    ).status,
    409,
  );
});
test("INVITE stores manual recipients and contains identical PDF in calendar and email; paid entries blocked", async () => {
  const h = harness(),
    b = { ...(await payBody(h)), recipients: ["TEST@example.invalid"] };
  assert.equal((await h.call("invite/settings", b)).status, 200);
  assert.deepEqual(h.store.get("payableInviteSettings/legacy").recipients, [
    "test@example.invalid",
  ]);
  const bytes = Buffer.from("%PDF-1.4 fixture");
  const result = await h.call("invite/download", {
    ...b,
    format: "ics",
    attachments: [
      {
        name: "fatura.pdf",
        type: "application/pdf",
        kind: "fatura",
        base64: bytes.toString("base64"),
      },
    ],
  });
  assert.equal(result.status, 200);
  const ics = Buffer.from(result.body.base64, "base64")
    .toString()
    .replace(/\r\n /g, "");
  assert.match(ics, /DTSTART;VALUE=DATE:20990131/);
  assert.equal(
    Buffer.from(ics.match(/VALUE=BINARY:([^\r]+)/)[1], "base64").toString(),
    bytes.toString(),
  );
  h.store.get("transactions/legacy").status = "Pago";
  assert.equal((await h.call("invite/download", b)).status, 409);
  assert.throws(() => emails(["a@example.invalid\r\nBcc:x@z.invalid"]));
  assert.equal(due("2028-02", 31), "2028-02-29");
  const eml = calendar(row(), "id", ["a@example.invalid"], { bytes }).eml;
  assert.match(eml, /To: a@example.invalid/);
  assert.match(eml, /filename="fatura.pdf"/);
  assert.match(eml, /filename="conta-a-pagar.ics"/);
});

test('changed source and concurrent monthly generation cannot duplicate provisions',async()=>{
 const h=harness();await h.call('rules/save',await ruleBody(h));
 const one={id:'legacy',month:'2099-06',requestId:randomUUID()};const preview=await h.call('rules/preview',one);
 h.store.get('transactions/legacy').bankAccount=catalog.banks[1];
 assert.equal((await h.call('rules/generate',{...one,confirmHash:preview.body.reviewHash})).status,409);
 const second={...one,requestId:randomUUID()};const p1=await h.call('rules/preview',one),p2=await h.call('rules/preview',second);
 const results=await Promise.all([h.call('rules/generate',{...one,confirmHash:p1.body.reviewHash}),h.call('rules/generate',{...second,confirmHash:p2.body.reviewHash})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('transactions/')).length,2);
});
