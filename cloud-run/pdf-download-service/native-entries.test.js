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
  extraDescription: catalog.extras[0],
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
  uid = "u",
} = {}) {
  const store = new Map([
    [`users/${uid}`, profile],
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
    where: (k, op, v) => query(path, [...filters, [k, op, v]], limit),
    limit: (n) => query(path, filters, n),
    get: async () => ({
      docs: [...store.keys()]
        .filter(
          (k) =>
            k.startsWith(path + "/") &&
            !k.slice(path.length + 1).includes("/") &&
            filters.every(([f, op, v]) => {
              const x = store.get(k)[f];
              return op === ">=" ? x >= v : op === "<=" ? x <= v : op === "in" ? v.includes(x) : x === v;
            }),
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
          set: (r, d) => pending.push([r.path, d, true]),
        });
        for (const [p, , overwrite] of pending) if (!overwrite) assert.equal(store.has(p), false);
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
          return { uid };
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
test('maintained catalog feeds config and renamed accounts retain duplicate protection',async()=>{
 const h=harness();const {initial,change}=require('./maintenance');const state=initial();
 const next=change(state,{group:'categories',revision:0,id:state.items.categories[0].id,label:'1 - Descrição atualizada',active:true,reason:'Revisão cadastral'}).next;
 h.store.set('financialSettings/nativeCatalog',next);
 assert.equal((await h.call('config',undefined,'good','GET')).body.catalog.categories[0],'1 - Descrição atualizada');
 h.store.set('transactions/legacy',{movement:'Saída',description:catalog.categories[0],dueDate:'2026-11-20',valorOriginal:100.30});
 const body={requestId:randomUUID(),entry:payable({category:'1 - Descrição atualizada'})};
 const p=await h.call('preview',body);assert.equal(p.status,200);
 assert.equal((await h.call('commit',{...body,confirmHash:p.body.previewHash})).status,409);
 assert.equal([...h.store.keys()].filter(x=>x.startsWith('transactions/')).length,1);
 for(const token of ['', 'bad'])assert.equal((await h.call('maintenance',undefined,token,'GET')).status,401);
 assert.equal((await harness({profile:{active:true,role:'operacional'}}).call('maintenance',undefined,'good','GET')).status,403);
});


test("extras require active catalog accounts and server sums item amounts", () => {
  const r = buildEntry(input({ extras: "999", extraItems: [
    {account: catalog.extras[0], amount: "0.10"},
    {account: catalog.extras[1], amount: "0.20"}
  ]}), client, actor).record;
  assert.equal(r.extras, 0.3);
  assert.equal(r.totalCobranca, 100.4);
  assert.equal(r.extraItems.length, 2);
  for (const extraItems of [[{account: "inventada", amount: "1"}], [{account: catalog.extras[0], amount: ""}], [{account: catalog.extras[0], amount: "0"}], {}]) {
    assert.throws(() => buildEntry(input({extraItems}), client, actor));
  }
  assert.throws(() => buildEntry(input({extraDescription: ""}), client, actor));
  assert.throws(() => buildEntry(input({extraItems: [{account: catalog.extras[0], amount: "1"}]}), client, actor, undefined, {...catalog, extras: []}));
  assert.equal(buildEntry(input({extraItems: []}), client, actor).record.totalCobranca, 100.1);
});
test('enabled approval policy blocks direct paid payable creation while preserving pending and receivable flows',async()=>{
 const h=harness();const state=require('./maintenance').initial();state.payableApproval={enabled:true,thresholdCents:10000};h.store.set('financialSettings/nativeCatalog',state);
 const paid={requestId:randomUUID(),entry:payable({paid:true,paidAmount:'100.30',paymentDate:'2026-10-09'}),attachments:[]};
 assert.equal((await h.call('preview',paid)).status,403);
 assert.equal((await h.call('commit',paid)).status,403);
 assert.equal((await h.call('preview',{...paid,entry:payable()})).status,200);
 assert.equal((await h.call('preview',{...paid,entry:input({paid:true,paidAmount:'100.30',paymentDate:'2026-10-09'})})).status,200);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('transactions/')).length,0);
});
test('communication configuration route requires active admin and stays disabled',async()=>{
 const h=harness();
 for(const token of ['', 'bad'])assert.equal((await h.call('communication-settings',undefined,token,'GET')).status,401);
 assert.equal((await harness({profile:{active:true,role:'operacional'}}).call('communication-settings',undefined,'good','GET')).status,403);
 const result=await h.call('communication-settings',undefined,'good','GET');assert.equal(result.status,200);
});
test('communication workflow routes reject unauthenticated and non-admin callers',async()=>{
 for(const route of ['communications','communications/candidates','communications/preview','communications/draft','communications/validate','communications/contacts','communications/catalog-preview','communications/catalog-import','communications/cancel','communications/review']){
  const method=['communications','communications/candidates'].includes(route)?'GET':'POST';
  assert.equal((await harness().call(route,{},'',method)).status,401);
  assert.equal((await harness({profile:{active:true,role:'operacional'}}).call(route,{},'good',method)).status,403);
 }
});
test("Fatura Wix da mesma empresa com mesmo valor e vencimento bloqueia a Nova cobrança e registra log", async () => {
  const h = harness();
  h.store.set("transactions/wix-inv-0004300", { source: "wix", movement: "Entrada", client: "Cliente Ficticio", status: "Paga", dueDate: "2026-11-20", wixInvoiceNumber: "0004300", valorOriginal: 100.3 });
  const body = { requestId: randomUUID(), entry: input() };
  const p = await h.call("preview", body);
  assert.equal(p.status, 409);
  assert.match(p.body.error, /Fatura Wix/);
  const logs = [...h.store.entries()].filter(([k]) => k.startsWith("wixBillingLockAudit/"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].channel, "native-entry");
  assert.equal(logs[0][1].stage, "preview");
  assert.equal(logs[0][1].cpfCnpj, "52998224725");
  // Commit também é bloqueado mesmo que o cliente pule a revisão.
  h.store.delete("transactions/wix-inv-0004300");
  const ok = await h.call("preview", body);
  assert.equal(ok.status, 200);
  h.store.set("transactions/wix-inv-0004300", { source: "wix", client: "CLIENTE FICTÍCIO LTDA", status: "Pendente", dueDate: "2026-11-20", wixInvoiceNumber: "0004300", valorOriginal: 100.3 });
  const commit = await h.call("commit", { ...body, confirmHash: ok.body.previewHash });
  assert.equal(commit.status, 409);
  assert.equal([...h.store.keys()].filter((k) => k.startsWith("transactions/native-")).length, 0);
  // Contas a pagar não passam pela trava.
  const pay = await h.call("preview", { requestId: randomUUID(), entry: payable() });
  assert.equal(pay.status, 200);
});
test("Fatura Wix com mesmo valor e vencimento bloqueia; exceção só pelo master, com motivo, log e registro no lançamento", async () => {
  const open = { source: "wix", client: "Cliente Ficticio", status: "Vencida", dueDate: "2026-11-20", wixInvoiceNumber: "0004400", valorOriginal: 100.3 };
  const reason = "Acordo do Wix é de outro serviço";
  const h = harness();
  h.store.set("transactions/wix-inv-0004400", open);
  const body = { requestId: randomUUID(), entry: input(), wixOverride: { reason } };
  const refused = await h.call("preview", body);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body.wixLock.invoices.map((i) => i.id), ["wix-inv-0004400"]);
  // Fatura em aberto de outro vencimento ou de outro valor não trava.
  h.store.set("transactions/wix-inv-0004400", { ...open, dueDate: "2026-03-10" });
  assert.equal((await h.call("preview", { requestId: randomUUID(), entry: input() })).status, 200);
  h.store.set("transactions/wix-inv-0004400", { ...open, valorOriginal: 100 });
  assert.equal((await h.call("preview", { requestId: randomUUID(), entry: input() })).status, 200);

  const master = "hpdsWehGGAYE3uKCar4pBiRVxFJ3";
  const m = harness({ uid: master });
  m.store.set("transactions/wix-inv-0004400", open);
  assert.equal((await m.call("preview", { ...body, wixOverride: { reason: "curto" } })).status, 400);
  const p = await m.call("preview", body);
  assert.equal(p.status, 200);
  assert.equal((await m.call("commit", { requestId: body.requestId, entry: input(), confirmHash: p.body.previewHash })).status, 409);
  const saved = await m.call("commit", { ...body, confirmHash: p.body.previewHash });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.transaction.wixLockOverride.reason, reason);
  assert.deepEqual(saved.body.transaction.wixLockOverride.invoices, ["wix-inv-0004400"]);
  const logs = [...m.store.entries()].filter(([k]) => k.startsWith("wixBillingLockAudit/")).map(([, v]) => v.action).sort();
  assert.deepEqual(logs, ["blocked", "blocked", "override", "override"]);
});

test("filial with the same CNPJ root is a distinct company; excluded entries release the lock", async () => {
  const matriz = { ...client, client: "Empresa Matriz", clientNumber: "1200", cpfCnpjDigits: "11222333000181" };
  const filial = { ...client, client: "Empresa Filial", clientNumber: "1275", cpfCnpjDigits: "11222333000262" };
  const h = harness();
  h.store.set("clientRegistry/m", matriz);
  h.store.set("clientRegistry/f", filial);
  const commit = async (entry) => {
    const b = { requestId: randomUUID(), entry };
    const p = await h.call("preview", b);
    return h.call("commit", { ...b, confirmHash: p.body.previewHash });
  };
  const first = await commit(input({ clientRegistryId: "m" }));
  assert.equal(first.status, 201);
  assert.equal((await commit(input({ clientRegistryId: "f" }))).status, 201);
  const repeated = await commit(input({ clientRegistryId: "m" }));
  assert.equal(repeated.status, 409);
  assert.match(repeated.body.error, /N\.Cliente 1200/);
  assert.match(repeated.body.error, new RegExp(first.body.transaction.id));
  h.store.get(`transactions/${first.body.transaction.id}`).isExcluded = true;
  const again = await commit(input({ clientRegistryId: "m" }));
  assert.equal(again.status, 201);
  const audit = h.store.get(`nativeEntryAudit/${again.body.transaction.id}`);
  assert.equal(audit.releasedLock, first.body.transaction.id);
});
