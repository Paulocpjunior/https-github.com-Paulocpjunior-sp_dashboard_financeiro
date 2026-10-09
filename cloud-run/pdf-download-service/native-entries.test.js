const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  buildEntry,
  files,
  createNativeEntryHandler,
} = require("./native-entries");
const catalog = require("./native-entry-catalog.json");
const client = {
  status: "ready",
  client: "Cliente Fictício",
  clientNumber: "007",
  cpfCnpjDigits: "52998224725",
};
const actor = { uid: "u", name: "Administrador de Teste" };
const input = (extra = {}) => ({
  kind: "receber",
  clientRegistryId: "c",
  bankAccount: catalog.banks[0],
  date: "2026-10-09",
  dueDate: "2026-11-20",
  description: "Serviço de teste local",
  paid: false,
  paidAmount: "0",
  paymentDate: "",
  honorarios: "100.10",
  extras: "0.20",
  interestRate: "0",
  deliveryMethod: catalog.deliveryMethods[0],
  ...extra,
});
const payable = (extra = {}) =>
  input({
    kind: "pagar",
    amount: "100.30",
    category: catalog.categories[0],
    paidBy: catalog.paidBy[0],
    authorizedBy: catalog.authorizedBy[0],
    personType: "PJ",
    paymentMethod: catalog.paymentMethods[0],
    ...extra,
  });
test("financial contract: pending receivable, paid receivable, pending and paid payable", () => {
  let r = buildEntry(input(), client, actor).record;
  assert.equal(r.totalCobranca, 100.3);
  assert.equal(r.valueReceived, 0);
  assert.equal(r.clientNumber, "007");
  assert.equal(r.source, "native-finance");
  assert.equal(r.bankAccount, catalog.banks[0]);
  assert.equal(r.submissionId, undefined);
  r = buildEntry(
    input({ paid: true, paidAmount: "100.30", paymentDate: "2026-10-09" }),
    client,
    actor,
  ).record;
  assert.equal(r.valueReceived, 100.3);
  assert.equal(r.status, "Pago");
  assert.equal(r.dataPagamento, "09/10/2026");
  r = buildEntry(payable(), null, actor).record;
  assert.equal(r.valuePaid, 100.3);
  assert.equal(r.status, "Pendente");
  assert.equal(r.valorPago, "");
  r = buildEntry(
    payable({ paid: true, paidAmount: "100.30", paymentDate: "2026-10-09" }),
    null,
    actor,
  ).record;
  assert.equal(r.valuePaid, 100.3);
  assert.equal(r.status, "Pago");
});
test("rejects impossible dates, malformed money, partials, recurrence, interest and unconfirmed clients", () => {
  for (const changes of [
    { date: "2026-02-30" },
    { dueDate: "invalid" },
    { honorarios: "1e3" },
    { extras: "-1" },
    { paidAmount: "10" },
    { paid: true, paidAmount: "10", paymentDate: "2026-10-09" },
    { recurring: true },
    { interestRate: "1" },
    { bankAccount: "invented" },
  ])
    assert.throws(() => buildEntry(input(changes), client, actor));
  for (const c of [
    null,
    { ...client, status: "conflict" },
    { ...client, cpfCnpjDigits: "11111111111" },
  ])
    assert.throws(() => buildEntry(input(), c, actor));
});
test("attachments validate size, signature, mime and exclude bytes from metadata", () => {
  const pdf = {
    name: "ficticio.pdf",
    type: "application/pdf",
    kind: "fatura",
    base64: Buffer.from("%PDF-1.7 synthetic").toString("base64"),
  };
  assert.equal(files([pdf])[0].sha256.length, 64);
  assert.throws(() => files([{ ...pdf, type: "image/png" }]));
  assert.throws(() => files([{ ...pdf, base64: "invalid" }]));
  assert.throws(() =>
    files([
      { ...pdf, base64: Buffer.alloc(3 * 1024 * 1024).toString("base64") },
    ]),
  );
});
function harness({
  enabled = true,
  profile = { active: true, role: "admin", name: "Administrador de Teste" },
  bucket = true,
} = {}) {
  const store = new Map([
    ["users/u", profile],
    ["clientRegistry/c", client],
  ]);
  let queue = Promise.resolve();
  const objects = new Map();
  const snap = (ref) => ({
    id: ref.path.split("/").at(-1),
    exists: store.has(ref.path),
    data: () => store.get(ref.path),
  });
  const doc = (path) => ({ path, get: async () => snap({ path }) });
  const query = (path, filters = [], limit = 10000) => ({
    query: true,
    where: (k, op, v) => query(path, [...filters, [k, v]], limit),
    limit: (n) => query(path, filters, n),
    get: async () => ({
      docs: [...store.keys()]
        .filter(
          (k) =>
            k.startsWith(path + "/") &&
            !k.slice(path.length + 1).includes("/") &&
            filters.every(([f, v]) => store.get(k)[f] === v),
        )
        .slice(0, limit)
        .map((k) => snap({ path: k })),
    }),
  });
  const db = {
    collection: (path) => ({
      ...query(path),
      doc: (id) => doc(`${path}/${id}`),
    }),
    runTransaction: (fn) => {
      const run = queue.then(async () => {
        const pending = [];
        const result = await fn({
          get: (r) => (r.query ? r.get() : Promise.resolve(snap(r))),
          create: (r, d) => pending.push([r.path, d]),
        });
        for (const [p] of pending) assert.equal(store.has(p), false);
        pending.forEach(([p, d]) => store.set(p, d));
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  const handler = createNativeEntryHandler({
    env: {
      NATIVE_ENTRY_ENABLED: String(enabled),
      NATIVE_ENTRY_ATTACHMENT_BUCKET: bucket ? "test" : "",
    },
    getServices: () => ({
      adminDb: db,
      adminAuth: {
        verifyIdToken: async (t) => {
          if (t !== "good") throw Error();
          return { uid: "u" };
        },
      },
    }),
    readBody: async (r) => Buffer.from(JSON.stringify(r.body)),
    sendJson: (_r, res, status, body) => Object.assign(res, { status, body }),
    getBucket: () => ({
      file: (path) => ({
        save: async (bytes) => {
          objects.set(path, bytes);
        },
        download: async () => [objects.get(path)],
      }),
    }),
  });
  const call = async (action, body, token = "good", method = "POST") => {
    const response = {};
    await handler(
      {
        url: `/api/financial-entries/${action}`,
        headers: { authorization: token ? `Bearer ${token}` : "" },
        method,
        body,
      },
      response,
    );
    return response;
  };
  return { call, store, objects };
}
test("anonymous, revoked, inactive, operator and disabled feature cannot write", async () => {
  const h = harness();
  assert.equal((await h.call("preview", {}, "")).status, 401);
  assert.equal((await h.call("preview", {}, "bad")).status, 401);
  for (const profile of [
    { active: false, role: "admin" },
    { active: true, role: "operacional" },
    { active: true, role: "admin", status: "blocked" },
  ])
    assert.equal((await harness({ profile }).call("preview", {})).status, 403);
  assert.equal(
    (await harness({ enabled: false }).call("preview", {})).status,
    503,
  );
});
test("preview creates nothing; concurrent replay commits once, records actor and preserves historical rows", async () => {
  const h = harness();
  h.store.set("transactions/legacy", {
    dueDate: "2025-01-01",
    valueReceived: 500,
    source: "jotform",
  });
  const body = { requestId: randomUUID(), entry: input() };
  const p = await h.call("preview", body);
  assert.equal(p.status, 200);
  assert.equal(h.store.size, 3);
  assert.equal((await h.call("commit", body)).status, 409);
  const results = await Promise.all([
    h.call("commit", { ...body, confirmHash: p.body.previewHash }),
    h.call("commit", { ...body, confirmHash: p.body.previewHash }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal(
    [...h.store.keys()].filter((k) => k.startsWith("transactions/")).length,
    2,
  );
  assert.equal(
    [...h.store.keys()].filter((k) => k.startsWith("nativeEntryAudit/")).length,
    1,
  );
  assert.equal(h.store.get("transactions/legacy").valueReceived, 500);
  const status = await h.call(
    `requests/${body.requestId}`,
    undefined,
    "good",
    "GET",
  );
  assert.equal(status.body.state, "saved");
  assert.equal(status.body.transaction.createdBy, "u");
});
test("changed payload and revoked permissions cannot commit the reviewed request", async () => {
  const h = harness();
  const b = { requestId: randomUUID(), entry: input() };
  const p = await h.call("preview", b);
  assert.equal(
    (
      await h.call("commit", {
        ...b,
        entry: input({ honorarios: "900" }),
        confirmHash: p.body.previewHash,
      })
    ).status,
    409,
  );
  h.store.set("users/u", { active: false, role: "admin" });
  assert.equal(
    (await h.call("commit", { ...b, confirmHash: p.body.previewHash })).status,
    403,
  );
});
test("same debt with a new request id and legacy duplicates are blocked", async () => {
  const h = harness();
  let b = { requestId: randomUUID(), entry: input() };
  let p = await h.call("preview", b);
  assert.equal(
    (await h.call("commit", { ...b, confirmHash: p.body.previewHash })).status,
    201,
  );
  b = { ...b, requestId: randomUUID() };
  p = await h.call("preview", b);
  assert.equal(
    (await h.call("commit", { ...b, confirmHash: p.body.previewHash })).status,
    409,
  );
  const other = harness();
  other.store.set("transactions/old", {
    movement: "Entrada",
    cpfCnpj: client.cpfCnpjDigits,
    dueDate: "2026-11-20",
    totalCobranca: 100.3,
  });
  p = await other.call("preview", b);
  assert.equal(
    (await other.call("commit", { ...b, confirmHash: p.body.previewHash }))
      .status,
    409,
  );
});
test("attachments are stored privately and require authentication to retrieve", async () => {
  const h = harness();
  const attachments = [
    {
      name: "teste.pdf",
      type: "application/pdf",
      kind: "comprovante",
      base64: Buffer.from("%PDF-synthetic").toString("base64"),
    },
  ];
  const b = { requestId: randomUUID(), entry: input(), attachments };
  const p = await h.call("preview", b);
  const c = await h.call("commit", { ...b, confirmHash: p.body.previewHash });
  assert.equal(c.status, 201);
  assert.equal(h.objects.size, 1);
  assert.equal(c.body.transaction.attachments[0].bytes, undefined);
  const path = `attachments/${c.body.transaction.id}/${c.body.transaction.attachments[0].sha256}`;
  assert.equal((await h.call(path, undefined, "", "GET")).status, 401);
  assert.equal(
    (await h.call(path, undefined, "good", "GET")).body.base64,
    attachments[0].base64,
  );
});
