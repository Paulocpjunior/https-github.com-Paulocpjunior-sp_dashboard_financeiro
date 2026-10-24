const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBoletoHandler,
  payload,
  amount,
  validDocument,
  config,
} = require("./boleto-cloud");
const row = () => ({
  client: "Empresa Teste",
  cpfCnpj: "11222333000181",
  movement: "Entrada",
  type: "Contas a Receber",
  status: "Pendente",
  metodoPagamento: "Boleto Itaú",
  dueDate: "2099-11-10",
  totalCobranca: 1250,
  honorarios: 1000,
  valorExtra: 250,
  valueReceived: 800,
});
const address = {
  cep: "01310100",
  uf: "SP",
  localidade: "São Paulo",
  bairro: "Bela Vista",
  logradouro: "Avenida Paulista",
  numero: "100",
  complemento: "",
};
const env = {
  BOLETO_CLOUD_ENVIRONMENT: "sandbox",
  BOLETO_CLOUD_SANDBOX_API_KEY: "test-api",
  BOLETO_CLOUD_SANDBOX_ACCOUNT_TOKEN: "test-account",
  BOLETO_CLOUD_ISSUANCE_ENABLED: "true",
};
// Transactional in-memory store: models atomic commits and serializes concurrent callers.
function fixture(fetchImpl, environment = env, historyRows = []) {
  const data = new Map([
    ["users/user", { active: true, role: "admin" }],
    ["transactions/a", row()],
  ]);
  let queue = Promise.resolve(),
    seq = 0;
  const snap = (path) => ({
    id: path.split("/").at(-1),
    exists: data.has(path),
    data: () => structuredClone(data.get(path)),
  });
  const doc = (path) => ({
    path,
    get: async () => snap(path),
    update: async (value) => data.set(path, { ...data.get(path), ...value }),
    set: async (value) => data.set(path, structuredClone(value)),
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({
    doc: (id) => doc(`${path}/${id || `event-${++seq}`}`),
    where: (field, op, value) => query(path, [[field, op, value]]),
    get: async () => ({ docs: matching({ path, filters: [], max: 10000 }) }),
  });
  const query = (path, filters) => ({
    path,
    filters,
    where: (field, op, value) => query(path, [...filters, [field, op, value]]),
    limit(n) {
      this.max = n;
      return this;
    },
    get: async () => ({ docs: matching({ path, filters, max: 10000 }) }),
  });
  const matching = (ref) =>
    [...data.keys()]
      .filter(
        (k) =>
          k.startsWith(`${ref.path}/`) &&
          k.split("/").length === ref.path.split("/").length + 1 &&
          ref.filters.every(([field, op, value]) => {
            const x = data.get(k)[field];
            return op === ">=" ? x >= value : op === "<=" ? x <= value : op === "in" ? value.includes(x) : x === value;
          }),
      )
      .slice(0, ref.max)
      .map(snap);
  const db = {
    collection,
    runTransaction: (fn) => {
      const run = queue.then(async () => {
        const writes = [];
        const tx = {
          get: async (ref) =>
            ref.filters ? { docs: matching(ref) } : snap(ref.path),
          set: (ref, value) => writes.push([ref.path, structuredClone(value)]),
          create: (ref, value) =>
            writes.push([ref.path, structuredClone(value)]),
        };
        const result = await fn(tx);
        writes.forEach(([k, v]) => data.set(k, v));
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  const handler = createBoletoHandler({
    getServices: () => ({
      adminAuth: { verifyIdToken: async (token) => ({ uid: token === "valid" ? "user" : token }) },
      adminDb: db,
    }),
    readBody: async (req) => Buffer.from(JSON.stringify(req.body)),
    sendJson: (req, res, status, body) => {
      res.status = status;
      res.body = body;
    },
    env: environment,
    fetchImpl,
    historyReader: { load: async () => { if (historyRows === null) throw new Error("offline"); return { rows: historyRows }; } },
  });
  const post = async (path, body, token = "valid") => {
    const res = {};
    await handler({ url: `/api/boleto-cloud/${path}`, method: "POST", headers: { authorization: `Bearer ${token}` }, body }, res);
    return res;
  };
  const call = async (action = "", body, id = "a", authorized = true, token = "valid") => {
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(bytes) {
        this.bytes = bytes;
      },
    };
    await handler(
      {
        url: `/api/boleto-cloud/items/${id}${action ? `/${action}` : ""}`,
        method: body === undefined ? "GET" : "POST",
        headers: authorized ? { authorization: `Bearer ${token}` } : {},
        body,
      },
      res,
    );
    return res;
  };
  const preview = async () => call("preview", { address });
  const issue = async () => {
    const p = await preview();
    return call("issue", {
      previewHash: p.body.previewHash,
      legacyChecked: true,
    });
  };
  const stored = () =>
    [...data.entries()].find(
      ([key]) => key.startsWith("boletoIssues/") && key.split("/").length === 2,
    );
  return { data, db, call, post, preview, issue, stored };
}
const success = (url, options) => {
  const control = new URLSearchParams(options.body).get(
    "boleto.tokenControleUsuario",
  );
  return new Response("%PDF-test", {
    status: 201,
    headers: {
      "X-BoletoCloud-Token": "provider-token",
      "X-BoletoCloud-Token-Controle-Usuario": control,
    },
  });
};
test("payload uses total cobrança, validates document/address and rejects unsafe records", () => {
  assert.equal(amount(row()), 1250);
  assert.equal(payload(row(), address)["boleto.valor"], "1250.00");
  assert.equal(validDocument("52998224725"), true);
  assert.equal(validDocument("11111111111"), false);
  for (const patch of [
    { status: "Pago" },
    { isExcluded: true },
    { movement: "Saída" },
    { cpfCnpj: "123" },
    { dueDate: "2026-02-30" },
    { dueDate: "2000-01-01" },
    { metodoPagamento: "Fatura Wix" },
    { totalCobranca: -1, honorarios: 0, valorExtra: 0, valueReceived: 0 },
  ])
    assert.throws(() => payload({ ...row(), ...patch }, address));
  assert.throws(() => payload(row(), { ...address, uf: "ZZ" }));
  assert.throws(() => payload(row(), { ...address, cep: "" }));
});
test("sandbox never inherits production credentials; emission disabled by default", () => {
  const c = config({
    BOLETO_CLOUD_API_KEY: "prod",
    BOLETO_CLOUD_ACCOUNT_TOKEN: "prod",
  });
  assert.equal(c.apiKey, undefined);
  assert.equal(c.accountToken, undefined);
  assert.equal(c.enabled, false);
  assert.throws(() => config({ BOLETO_CLOUD_ENVIRONMENT: "production" }));
});
test("unauthenticated and blocked users cannot read or issue", async () => {
  const f = fixture(() => {
    throw Error("must not call");
  });
  assert.equal((await f.call("", undefined, "a", false)).status, 401);
  for (const profile of [
    { active: false, role: "admin" },
    { active: true, role: "admin", status: "blocked" },
    { active: true, role: "operator", financialPermissions: [] },
  ]) {
    f.data.set("users/user", profile);
    assert.equal((await f.call()).status, 403);
  }
});
test("preview does not call provider; requires explicit legacy check and fresh source", async () => {
  let calls = 0;
  const f = fixture(() => {
    calls++;
    return success();
  });
  const p = await f.preview();
  assert.equal(p.body.state, "draft");
  assert.equal(calls, 0);
  assert.equal(
    (await f.call("issue", { previewHash: p.body.previewHash })).status,
    409,
  );
  f.data.set("transactions/a", { ...row(), totalCobranca: 999 });
  assert.equal(
    (
      await f.call("issue", {
        previewHash: p.body.previewHash,
        legacyChecked: true,
      })
    ).status,
    409,
  );
  assert.equal(calls, 0);
});
test("concurrent requests and repeated clicks issue once; source balances are untouched", async () => {
  let calls = 0;
  const f = fixture(async (...args) => {
    calls++;
    return success(...args);
  });
  const p = await f.preview();
  const results = await Promise.all(
    [1, 2].map(() =>
      f.call("issue", { previewHash: p.body.previewHash, legacyChecked: true }),
    ),
  );
  assert.equal(calls, 1);
  assert.ok(results.some((r) => r.body.state === "issued"));
  assert.equal(
    (
      await f.call("issue", {
        previewHash: p.body.previewHash,
        legacyChecked: true,
      })
    ).body.state,
    "issued",
  );
  assert.equal(calls, 1);
  assert.deepEqual(f.data.get("transactions/a"), row());
  assert.ok([...f.data.keys()].some((k) => k.includes("/events/")));
});
test("server blocks a duplicate source transaction even if client bypasses UI", async () => {
  let calls = 0;
  const f = fixture(() => {
    calls++;
  });
  f.data.set("transactions/b", row());
  assert.equal((await f.issue()).status, 409);
  assert.equal(calls, 0);
});
test("timeout is unknown; recovery uses GET even if source was paid in the meantime", async () => {
  const sent = [];
  const f = fixture(async (url, options) => {
    sent.push({ url, options });
    if (sent.length === 1) throw Error("timeout");
    return Response.json({
      boleto: {
        token: "original",
        tokenControleUsuario: f.stored()[1].control,
        valor: 1250,
        vencimento: row().dueDate,
      },
    });
  });
  assert.equal((await f.issue()).body.state, "unknown");
  assert.equal((await f.call("recover", {})).status, 409);
  const [key, state] = f.stored();
  f.data.set(key, { ...state, attemptAt: Date.now() - 61000 });
  f.data.set("transactions/a", { ...row(), status: "Pago" });
  assert.equal((await f.call("recover", {})).body.state, "issued");
  assert.equal(sent[1].options.body, undefined);
  assert.match(sent[1].url, /controle\/.+\/situacao$/);
});
test("verified 409 attaches existing boleto, unverified 200 remains unknown", async () => {
  const f = fixture(
    (url, options) =>
      new Response("{}", {
        status: 409,
        headers: {
          "X-BoletoCloud-Token": "original",
          "X-BoletoCloud-Token-Controle-Usuario": new URLSearchParams(
            options.body,
          ).get("boleto.tokenControleUsuario"),
        },
      }),
  );
  assert.equal((await f.issue()).body.state, "issued");
  const other = fixture(() => new Response("{}", { status: 200 }));
  assert.equal((await other.issue()).body.state, "unknown");
});
test("unrelated 409 never attaches another boleto; auth failure on recovery stays unknown", async () => {
  let status = 409;
  const f = fixture(
    () =>
      new Response("{}", {
        status,
        headers: {
          "X-BoletoCloud-Token": "other",
          "X-BoletoCloud-Token-Controle-Usuario": "wrong",
        },
      }),
  );
  assert.equal((await f.issue()).body.state, "unknown");
  const [key, state] = f.stored();
  f.data.set(key, { ...state, attemptAt: Date.now() - 61000 });
  status = 401;
  assert.equal((await f.call("recover", {})).body.state, "unknown");
});
test("postal code uses the provider format without changing the source address", () => {
  const original = structuredClone(address);
  assert.equal(payload(row(), address)["boleto.pagador.endereco.cep"], "01310-100");
  assert.equal(payload(row(), { ...address, cep: "01310-100" })["boleto.pagador.endereco.cep"], "01310-100");
  assert.deepEqual(address, original);
});
test("400 reports validation causes, redacts credentials and never retries issuance", async () => {
  let calls = 0;
  const f = fixture(() => {
    calls++;
    return Response.json({ erro: { causas: [
      { codigo: "842EF62A", mensagem: "Campo (boleto.pagador.endereco.cep) - Formato inválido." },
      { codigo: "123ABC", mensagem: "Conta test-account, chave test-api e api-key_outrosegredo" },
    ] } }, { status: 400 });
  });
  const result = (await f.issue()).body;
  assert.equal(result.state, "rejected");
  assert.match(result.error, /boleto.pagador.endereco.cep/);
  assert.match(result.error, /842EF62A/);
  assert.doesNotMatch(JSON.stringify(result), /test-account|test-api|api-key_outrosegredo/);
  assert.equal(calls, 1);
  assert.equal((await f.preview()).body.state, "draft");
});
test("malformed and oversized validation responses keep a safe fallback", async () => {
  for (const body of ["not-json", "x".repeat(17000), JSON.stringify({erro:{causas:[{mensagem:{}}]}})]) {
    const f = fixture(() => new Response(body, { status: 400 }));
    const result = (await f.issue()).body;
    assert.equal(result.state, "rejected");
    assert.match(result.error, /Dados recusados pelo Boleto Cloud/);
  }
});
test("400 and 401 stop without automatic retry and can be revised", async () => {
  for (const status of [400, 401]) {
    let calls = 0;
    const f = fixture(() => {
      calls++;
      return new Response("{}", { status });
    });
    assert.equal((await f.issue()).body.state, "rejected");
    assert.equal(calls, 1);
    assert.equal((await f.preview()).body.state, "draft");
  }
});
test("PDF and registration are authorized reads; provider token does not leave server", async () => {
  let posts = 0;
  const f = fixture((url, options) => {
    if (options.method === "POST") {
      posts++;
      return success(url, options);
    }
    return url.endsWith("/registro")
      ? Response.json({
          status: {
            token: "provider-token",
            registrado: "2026-10-08",
            erro: null,
          },
        })
      : new Response("%PDF-test");
  });
  const issued = await f.issue();
  assert.equal(issued.body.token, undefined);
  const pdf = await f.call("pdf");
  assert.equal(pdf.status, 200);
  assert.equal(pdf.bytes.toString(), "%PDF-test");
  assert.equal(pdf.headers["Cache-Control"], "private, no-store");
  const reg = await f.call("registration");
  assert.equal(reg.body.registration.registeredAt, "2026-10-08");
  assert.equal(posts, 1);
});


test("production uses its existing account without Sandbox credentials", async () => {
  const production = {
    BOLETO_CLOUD_ENVIRONMENT: "production",
    BOLETO_CLOUD_API_KEY: "synthetic-production-key",
    BOLETO_CLOUD_ACCOUNT_TOKEN: "synthetic-existing-account",
    BOLETO_CLOUD_CUTOVER_DATE: "2026-10-09",
    BOLETO_CLOUD_ISSUANCE_ENABLED: "true",
  };
  let calls = 0;
  const f = fixture((url, options) => {
    calls++;
    assert.equal(url, "https://app.boletocloud.com/api/v1/boletos");
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from("synthetic-production-key:token").toString("base64")}`);
    assert.equal(new URLSearchParams(options.body).get("boleto.conta.token"), "synthetic-existing-account");
    return success(url, options);
  }, production);
  const result = await f.issue();
  assert.equal(result.body.environment, "production");
  assert.equal(result.body.state, "issued");
  assert.equal(calls, 1);
  assert.deepEqual(f.data.get("transactions/a"), row());
  for (const patch of [{BOLETO_CLOUD_API_KEY: ""}, {BOLETO_CLOUD_ISSUANCE_ENABLED: "false"}]) {
    const blocked = fixture(() => { throw new Error("No provider call allowed"); }, {...production, ...patch});
    assert.equal((await blocked.issue()).status, 503);
  }
});

test('native entry must use the configured Itaú account, without changing legacy issuance', () => {
  assert.throws(() => payload({...row(), source:'native-finance', bankAccount:'BB Física'}, address), /conta Itaú/);
  assert.equal(payload({...row(), source:'native-finance', bankAccount:require('./native-entry-catalog.json').banks[0]}, address)['boleto.valor'], '1250.00');
});
test("Fatura Wix da mesma empresa com mesmo valor e vencimento bloqueia preview e emissão, com log", async () => {
  let calls = 0;
  const f = fixture(() => {
    calls++;
    return success();
  });
  const wix = { source: "wix", movement: "Entrada", type: "Entrada de Caixa / Contas a Receber", client: "EMPRESA TESTE LTDA", status: "Pendente", dueDate: "2099-11-10", wixInvoiceNumber: "0004200", valorOriginal: 1250 };
  f.data.set("transactions/wix-inv-0004200", wix);
  const blocked = await f.preview();
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Fatura Wix/);
  assert.match(blocked.body.error, /#0004200/);
  assert.equal(f.stored(), undefined);
  const logs = [...f.data.entries()].filter(([k]) => k.startsWith("wixBillingLockAudit/"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].channel, "boleto");
  assert.equal(logs[0][1].uid, "user");
  assert.deepEqual(logs[0][1].invoices, ["wix-inv-0004200"]);
  // Serviços distintos convivem: fatura cancelada, outro vencimento, outro valor
  // ou pedido do e-commerce com outro valor não travam.
  f.data.set("transactions/wix-inv-0004200", { ...wix, status: "Cancelada" });
  f.data.set("transactions/wix-inv-0004201", { ...wix, wixInvoiceNumber: "0004201", status: "Vencida", dueDate: "2099-11-11" });
  f.data.set("transactions/wix-inv-0004203", { ...wix, wixInvoiceNumber: "0004203", valorOriginal: 1249.99 });
  f.data.set("transactions/wix-order", { ...wix, wixInvoiceNumber: undefined, wixOrderNumber: "10050", type: "Recebimento Wix / Cartao", status: "Pago", valorOriginal: 300 });
  const p = await f.preview();
  assert.equal(p.body.state, "draft");
  // Fatura emitida entre a revisão e a emissão: bloqueia antes de chamar o emissor.
  f.data.set("transactions/wix-inv-0004202", { ...wix, wixInvoiceNumber: "0004202", client: "Empresa Teste" });
  const issued = await f.call("issue", { previewHash: p.body.previewHash, legacyChecked: true });
  assert.equal(issued.status, 409);
  assert.equal(calls, 0);
  assert.equal([...f.data.keys()].filter((k) => k.startsWith("wixBillingLockAudit/")).length, 2);
});
test("Fatura Wix em aberto de outro mês não trava; duplicata só passa com exceção do master, com motivo e log", async () => {
  let calls = 0;
  const f = fixture((...args) => {
    calls++;
    return success(...args);
  });
  // Caso VASCO: fatura vencida de outro mês e outro valor não impede o boleto.
  f.data.set("transactions/wix-inv-0004300", { source: "wix", client: "Empresa Teste", status: "Vencida", dueDate: "2099-01-10", wixInvoiceNumber: "0004300", valorOriginal: 1621 });
  assert.equal((await f.preview()).body.state, "draft");
  f.data.set("transactions/wix-order-1", { source: "wix", client: "Empresa Teste", status: "Pago", dueDate: "2099-11-10", wixOrderNumber: "10077", valorOriginal: 1250 });
  const order = await f.preview();
  assert.equal(order.status, 409);
  assert.match(order.body.error, /Pedido Wix #10077/);
  f.data.delete("transactions/wix-order-1");
  f.data.set("transactions/wix-inv-0004300", { source: "wix", client: "Empresa Teste", status: "Vencida", dueDate: "2099-11-10", wixInvoiceNumber: "0004300", valorOriginal: 1250 });
  assert.equal((await f.preview()).status, 409);
  const refused = await f.call("preview", { address, wixOverride: { reason: "Acordo separado do boleto mensal" } });
  assert.equal(refused.status, 403);
  assert.ok(refused.body.wixLock.invoices.length);
  const master = "hpdsWehGGAYE3uKCar4pBiRVxFJ3";
  f.data.set(`users/${master}`, { active: true, role: "admin" });
  const asMaster = (action, body) => f.call(action, body, "a", true, master);
  assert.equal((await asMaster("preview", { address, wixOverride: { reason: "curto" } })).status, 400);
  const p = await asMaster("preview", { address, wixOverride: { reason: "Acordo separado do boleto mensal" } });
  assert.equal(p.body.state, "draft");
  assert.equal((await asMaster("issue", { previewHash: p.body.previewHash, legacyChecked: true })).status, 409);
  const issued = await asMaster("issue", { previewHash: p.body.previewHash, legacyChecked: true, wixOverride: { reason: "Acordo separado do boleto mensal" } });
  assert.equal(issued.body.state, "issued");
  assert.equal(calls, 1);
  const logs = [...f.data.values()].filter((v) => v && v.channel === "boleto" && v.action);
  assert.deepEqual(logs.map((l) => l.action).sort(), ["blocked", "blocked", "blocked", "blocked", "blocked", "override", "override"]);
  assert.ok(logs.filter((l) => l.action === "override").every((l) => l.uid === master && l.reason));
});

const production = {
  BOLETO_CLOUD_ENVIRONMENT: "production",
  BOLETO_CLOUD_API_KEY: "synthetic-production-key",
  BOLETO_CLOUD_ACCOUNT_TOKEN: "synthetic-existing-account",
  BOLETO_CLOUD_CUTOVER_DATE: "2026-10-09",
  BOLETO_CLOUD_ISSUANCE_ENABLED: "true",
};
const panelBoleto = (patch = {}) => ({
  id: "h1", token: "panel-token-0001", number: "00025099-1", payerDocument: "11222333000181",
  dueDate: "2099-11-10", amountCents: 125000, cancelledAt: null, detailsSource: "csv", ...patch,
});
const batchId = "11111111-2222-4333-8444-555555555555";
const noProvider = () => { throw new Error("No provider call allowed"); };

test("1ª via emitida no painel/CSV bloqueia revisão e emissão; cancelado não bloqueia", async () => {
  const history = [panelBoleto()];
  const f = fixture(noProvider, production, history);
  const blocked = await f.preview();
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.alreadyIssued, true);
  assert.match(blocked.body.error, /1ª via já emitida.*00025099-1/);
  assert.equal(f.stored(), undefined);
  // Revisão feita antes da importação do painel: a emissão ainda é barrada antes do emissor.
  history.length = 0;
  const p = await f.preview();
  assert.equal(p.body.state, "draft");
  history.push(panelBoleto({ transactionId: "a", payerDocument: "99999999999999" }));
  const issued = await f.call("issue", { previewHash: p.body.previewHash, legacyChecked: true });
  assert.equal(issued.status, 409);
  assert.equal(issued.body.alreadyIssued, true);
  history.length = 0;
  history.push(panelBoleto({ cancelledAt: "2099-10-01" }), panelBoleto({ amountCents: 99900 }));
  assert.equal((await f.preview()).body.state, "draft");
});

test("lançamento vinculado a boleto e histórico indisponível bloqueiam em produção", async () => {
  const f = fixture(noProvider, production, null);
  const offline = await f.preview();
  assert.equal(offline.status, 503);
  assert.match(offline.body.error, /Histórico Boleto Cloud indisponível/);
  const linked = fixture(noProvider, production, []);
  linked.data.set("transactions/a", { ...row(), boletoReconciliation: { number: "00024000-1" } });
  const res = await linked.preview();
  assert.equal(res.status, 409);
  assert.equal(res.body.alreadyIssued, true);
});

test("situação em lote marca 1ª via do app, do painel, vínculo e em andamento", async () => {
  const f = fixture(success, production, [panelBoleto({ payerDocument: "52998224725", dueDate: "2099-12-10", amountCents: 50000, number: "777" })]);
  f.data.set("transactions/b", { ...row(), cpfCnpj: "52998224725", dueDate: "2099-12-10", totalCobranca: 500 });
  f.data.set("transactions/c", { ...row(), cpfCnpj: "52998224725", boletoReconciliation: { number: "888" } });
  f.data.set("transactions/d", { ...row(), cpfCnpj: "52998224725", dueDate: "2099-12-11", totalCobranca: 500 });
  assert.equal((await f.issue()).body.state, "issued");
  const res = await f.post("batch/status", { ids: ["a", "b", "c", "d", "missing"] });
  assert.equal(res.status, 200);
  assert.equal(res.body.historyAvailable, true);
  assert.deepEqual(res.body.items.a, { status: "issued", origin: "app", number: "" });
  assert.deepEqual(res.body.items.b, { status: "issued", origin: "panel", number: "777" });
  assert.deepEqual(res.body.items.c, { status: "issued", origin: "linked", number: "888" });
  assert.equal(res.body.items.d.status, "none");
  assert.equal(res.body.items.missing.status, "none");
  assert.equal((await f.post("batch/status", { ids: [] })).status, 400);
  assert.equal((await f.post("batch/status", { ids: ["x"] }, "intruder")).status, 403);
});

test("lote: revisão com total e motivos por item, endereço reaproveitado, sem chamar o emissor", async () => {
  let calls = 0;
  const f = fixture((...args) => { calls++; return success(...args); }, env);
  // Endereço do boleto anterior do mesmo CPF/CNPJ é reaproveitado.
  assert.equal((await f.issue()).body.state, "issued");
  calls = 0;
  f.data.set("transactions/b", { ...row(), dueDate: "2099-12-10", totalCobranca: 300 });
  f.data.set("transactions/c", { ...row(), cpfCnpj: "52998224725", dueDate: "2099-12-10", totalCobranca: 200, nativeEntry: { address } });
  f.data.set("transactions/d", { ...row(), cpfCnpj: "123", dueDate: "2099-12-10" });
  f.data.set("transactions/e", { ...row(), cpfCnpj: "11444777000161", dueDate: "2099-12-10" });
  f.data.set("transactions/wix-inv-1", { source: "wix", client: "Empresa Wix", cpfCnpj: "", status: "Pendente", dueDate: "2099-12-15", wixInvoiceNumber: "1", valorOriginal: 1250 });
  f.data.set("transactions/w", { ...row(), client: "Empresa Wix", cpfCnpj: "11444777000161", dueDate: "2099-12-15" });
  const res = await f.post("batch/preview", { batchId, ids: ["a", "b", "c", "d", "e", "w"], filters: { dueFrom: "2099-12-10" } });
  assert.equal(res.status, 200);
  const by = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
  assert.equal(by.a.block, "issued");
  assert.equal(by.b.ready, true);
  assert.equal(by.b.fields["boleto.pagador.endereco.logradouro"], "Avenida Paulista");
  assert.equal(by.c.ready, true);
  assert.equal(by.d.block, "invalid");
  assert.match(by.d.error, /CPF\/CNPJ/);
  assert.equal(by.e.block, "invalid");
  assert.match(by.e.error, /endereço/);
  assert.equal(by.w.block, "wix");
  assert.equal(res.body.totalCents, 50000);
  assert.equal(calls, 0);
  const batch = f.data.get(`boletoIssueBatches/${batchId}`);
  assert.equal(batch.uid, "user");
  assert.deepEqual(batch.ids, ["a", "b", "c", "d", "e", "w"]);
  const events = [...f.data.entries()].filter(([k]) => k.startsWith(`boletoIssueBatches/${batchId}/events/`)).map(([, v]) => v.action);
  assert.deepEqual(events, ["select", "preview"]);
  assert.equal((await f.post("batch/preview", { batchId: "nope", ids: ["b"] })).status, 400);
  assert.equal((await f.post("batch/preview", { batchId, ids: Array.from({ length: 101 }, (_, i) => `x${i}`) })).status, 400);
});

test("lote: emissão por item com log do lote; repetir nunca emite de novo; item fora do lote é recusado", async () => {
  let calls = 0;
  const f = fixture((...args) => { calls++; return success(...args); }, env);
  f.data.set("transactions/b", { ...row(), dueDate: "2099-12-10", totalCobranca: 300, nativeEntry: { address } });
  f.data.set("transactions/z", { ...row(), dueDate: "2099-12-20", totalCobranca: 300, nativeEntry: { address } });
  const preview = await f.post("batch/preview", { batchId, ids: ["b"] });
  const item = preview.body.items[0];
  const issue = (id, hashValue) => f.call("issue", { previewHash: hashValue, legacyChecked: true, batchId }, id);
  const [first, second] = await Promise.all([issue("b", item.previewHash), issue("b", item.previewHash)]);
  assert.ok([first, second].some((r) => r.body.state === "issued"));
  assert.ok([first, second].every((r) => r.body.state === "issued" || r.status === 409));
  assert.equal(calls, 1);
  assert.equal((await issue("b", item.previewHash)).body.state, "issued");
  assert.equal(calls, 1);
  const again = await f.post("batch/preview", { batchId, ids: ["b"] });
  assert.equal(again.body.items[0].block, "issued");
  const outside = await f.call("preview", { address }, "z");
  assert.equal((await issue("z", outside.body.previewHash)).status, 409);
  assert.equal(calls, 1);
  const actions = [...f.data.entries()].filter(([k]) => k.startsWith(`boletoIssueBatches/${batchId}/events/`)).map(([, v]) => v.action);
  assert.deepEqual(actions.filter((a) => ["issue", "result"].includes(a)), ["issue", "result"]);
  const itemEvents = [...f.data.values()].filter((v) => v && v.batchId === batchId && ["issue", "result"].includes(v.action));
  assert.equal(itemEvents.length, 2);
  assert.ok(itemEvents.every((e) => e.uid === "user"));
  // Outro usuário não reaproveita o lote.
  f.data.set("users/other", { active: true, role: "admin" });
  assert.equal((await f.post("batch/preview", { batchId, ids: ["z"] }, "other")).status, 409);
});

test("endereço corrigido no cadastro libera o lote e é sugerido na emissão individual", async () => {
  const f = fixture(success, env);
  f.data.set("transactions/z", { ...row(), cpfCnpj: "08821338000116", clientNumber: 79, dueDate: "2099-10-28", totalCobranca: 1450 });
  const blocked = await f.post("batch/preview", { batchId, ids: ["z"] });
  assert.match(blocked.body.items[0].error, /endereço/);
  f.data.set("billingAddresses/doc-08821338000116", { address: { ...address, logradouro: "Rua Corrigida" } });
  const get = await f.call("", undefined, "z");
  assert.equal(get.body.suggestedAddress.logradouro, "Rua Corrigida");
  const ready = await f.post("batch/preview", { batchId, ids: ["z"] });
  assert.equal(ready.body.items[0].ready, true);
  assert.equal(ready.body.items[0].fields["boleto.pagador.endereco.logradouro"], "Rua Corrigida");
  // Cadastro pelo N.Cliente também vale; endereço incompleto é ignorado.
  f.data.delete("billingAddresses/doc-08821338000116");
  f.data.set("billingAddresses/client-79", { address: { ...address, numero: "" } });
  const draftFromBefore = await f.post("batch/preview", { batchId, ids: ["z"] });
  assert.equal(draftFromBefore.body.items[0].fields["boleto.pagador.endereco.logradouro"], "Rua Corrigida");
});

test("revisar de novo um item mantém os demais no lote para a emissão", async () => {
  let calls = 0;
  const f = fixture((...args) => { calls++; return success(...args); }, env);
  f.data.set("transactions/b", { ...row(), dueDate: "2099-12-10", totalCobranca: 300, nativeEntry: { address } });
  f.data.set("transactions/c", { ...row(), cpfCnpj: "52998224725", dueDate: "2099-12-10", totalCobranca: 200 });
  const first = await f.post("batch/preview", { batchId, ids: ["b", "c"] });
  assert.equal(first.body.items.find((i) => i.id === "c").ready, false);
  f.data.set("billingAddresses/doc-52998224725", { address });
  const again = await f.post("batch/preview", { batchId, ids: ["c"] });
  assert.equal(again.body.items[0].ready, true);
  assert.deepEqual(f.data.get(`boletoIssueBatches/${batchId}`).ids, ["b", "c"]);
  const b = first.body.items.find((i) => i.id === "b");
  for (const [id, hashValue] of [["b", b.previewHash], ["c", again.body.items[0].previewHash]])
    assert.equal((await f.call("issue", { previewHash: hashValue, legacyChecked: true, batchId }, id)).body.state, "issued");
  assert.equal(calls, 2);
});

// Envio ao cliente: contatos da Regra de faturamento, registro confirmado e
// uma vez por canal. Tudo simulado: nenhuma chamada real ao Microsoft 365.
const graph = {
  FINANCEIRO_COMMUNICATION_SEND_ENABLED: "true",
  FINANCEIRO_GRAPH_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  FINANCEIRO_GRAPH_CLIENT_ID: "00000000-0000-0000-0000-000000000002",
  FINANCEIRO_GRAPH_CLIENT_SECRET: "synthetic-secret",
};
function deliveryFixture({ environment = { ...production, ...graph }, registered = true, mail = 202 } = {}) {
  const calls = [];
  let number = "";
  const state = { registered, mail };
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    if (options.method === "POST" && String(url).includes("boletocloud")) return success(url, options);
    if (String(url).endsWith("/situacao"))
      return new Response(JSON.stringify({ boleto: { token: "provider-token", numero: number || "12345-6", valor: 1250, vencimento: "2099-11-10", situacao: "EM_ABERTO",
        registro: state.registered ? { situacao: "REGISTRO_CONFIRMADO" } : { situacao: "AGUARDANDO" }, pagador: { nome: "Empresa Teste", cprf: "11222333000181" } } }));
    if (String(url).includes("/atualizado/vencimento/")) return new Response("%PDF-1.4 boleto sintético");
    if (String(url).includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "synthetic-token" }));
    if (String(url).includes("/sendMail")) { calls.mail = JSON.parse(options.body); return new Response(null, { status: state.mail }); }
    throw new Error("Chamada inesperada: " + url);
  };
  const f = fixture(fetchImpl, environment, []);
  f.data.set("transactions/a", { ...row(), valueReceived: 0 });
  f.data.set("billingProfiles/doc-11222333000181", { identityKey: "doc-11222333000181", deliveryChannels: ["email", "whatsapp"], billingEmail: "Cliente@Exemplo.com.br; financeiro@exemplo.com.br", whatsapp: "(11) 98765-4321" });
  const issued = async () => {
    const r = await f.issue();
    assert.equal(r.body.state, "issued");
    number = f.stored()[1].number || "";
  };
  return { ...f, calls, state, issued, fetchImpl };
}
const deliveries = (f) => [...f.data.entries()].filter(([k]) => k.startsWith("boletoDeliveries/"));

test("e-mail vai uma vez, com PDF e convite com o PDF dentro, para o e-mail da Regra de faturamento", async () => {
  const f = deliveryFixture({ registered: false });
  await f.issued();
  const before = await f.call("delivery");
  assert.deepEqual(before.body.contacts.email, ["cliente@exemplo.com.br", "financeiro@exemplo.com.br"]);
  assert.equal(before.body.contacts.whatsapp, "5511987654321");
  assert.equal(before.body.emailEnabled, true);
  // Recém-emitido: aguarda o registro do banco, nada é enviado nem reservado.
  const pending = await f.call("delivery", { channel: "email" });
  assert.equal(pending.status, 409);
  assert.equal(pending.body.pending, true);
  assert.equal(deliveries(f).length, 0);
  assert.equal(f.calls.filter((u) => u.includes("sendMail")).length, 0);
  f.state.registered = true;
  const sent = await f.call("delivery", { channel: "email" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.delivery.state, "sent", sent.body.delivery.error);
  const mail = f.calls.mail.message;
  assert.deepEqual(mail.toRecipients.map((r) => r.emailAddress.address), ["cliente@exemplo.com.br", "financeiro@exemplo.com.br"]);
  const names = mail.attachments.map((a) => a.name);
  assert.ok(names.some((n) => /^boleto-.*\.pdf$/.test(n)) && names.some((n) => /^vencimento-.*\.ics$/.test(n)));
  // Layout padrão dos apps da SP: HTML com o logo inline por cid:.
  assert.equal(mail.body.contentType, "HTML");
  assert.match(mail.body.content, /src="cid:sp-logo"/);
  assert.match(mail.body.content, /Departamento Financeiro/);
  assert.match(mail.body.content, /10\/11\/2099/);
  // Botões "Adicionar à agenda": evento de dia inteiro no vencimento.
  const html = mail.body.content.replace(/&amp;/g, "&");
  assert.match(html, /https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&[^"]*dates=20991110%2F20991111/);
  assert.match(html, /https:\/\/outlook\.office\.com\/calendar\/0\/deeplink\/compose\?[^"]*startdt=2099-11-10&enddt=2099-11-11&allday=true/);
  const logo = mail.attachments.find((a) => a.isInline);
  assert.equal(logo.contentId, "sp-logo");
  assert.equal(Buffer.from(logo.contentBytes, "base64").subarray(1, 4).toString(), "PNG");
  const ics = Buffer.from(mail.attachments.find((a) => a.name.endsWith(".ics")).contentBytes, "base64").toString();
  assert.match(ics.replace(/\r\n /g, ""), new RegExp("ATTACH;FMTTYPE=application/pdf;ENCODING=BASE64;VALUE=BINARY:" + Buffer.from("%PDF-1.4 boleto sintético").toString("base64")));
  // Segundo envio bloqueado; reenvio só com motivo, auditado.
  const again = await f.call("delivery", { channel: "email" });
  assert.equal(again.status, 409);
  assert.equal(again.body.alreadySent, true);
  assert.equal((await f.call("delivery", { channel: "email", resendReason: "curto" })).status, 400);
  const resent = await f.call("delivery", { channel: "email", resendReason: "Cliente pediu de novo por telefone" });
  assert.equal(resent.body.delivery.resends, 1);
  assert.equal(f.calls.filter((u) => u.includes("sendMail")).length, 2);
  const events = [...f.data.entries()].filter(([k, v]) => k.startsWith("boletoDeliveries/") && k.includes("/events/")).map(([, v]) => v);
  assert.deepEqual(events.map((e) => e.action), ["send", "result", "resend", "result"]);
  assert.equal(events[2].reason, "Cliente pediu de novo por telefone");
});

test("e-mail sem credenciais, sem cadastro ou em sandbox não envia", async () => {
  const off = deliveryFixture({ environment: production });
  await off.issued();
  const disabled = await off.call("delivery", { channel: "email" });
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.notConfigured, true);
  off.data.set("billingProfiles/doc-11222333000181", { identityKey: "doc-11222333000181", deliveryChannels: ["printed"], billingEmail: "" });
  const missing = await off.call("delivery", { channel: "whatsapp" });
  assert.equal(missing.body.needsContact, true);
  const sandbox = deliveryFixture({ environment: { ...env, ...graph } });
  await sandbox.issued();
  assert.equal((await sandbox.call("delivery", { channel: "email" })).status, 409);
  for (const f of [off, sandbox]) assert.equal(f.calls.filter((u) => u.includes("sendMail") || u.includes("microsoftonline")).length, 0);
});

test("sem confirmação do Microsoft 365 o envio fica incerto e não repete sem motivo", async () => {
  const f = deliveryFixture({ mail: 500 });
  await f.issued();
  const first = await f.call("delivery", { channel: "email" });
  assert.equal(first.body.delivery.state, "unknown");
  assert.equal((await f.call("delivery", { channel: "email" })).body.alreadySent, true);
});

test("WhatsApp: tela recebe o PDF e o número do cadastro, resultado fica registrado", async () => {
  const f = deliveryFixture();
  await f.issued();
  const prepared = await f.call("delivery", { channel: "whatsapp" });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  assert.equal(prepared.body.para, "5511987654321");
  assert.equal(Buffer.from(prepared.body.pdfBase64, "base64").toString(), "%PDF-1.4 boleto sintético");
  assert.match(prepared.body.variaveis.valor, /^R\$\s1\.250,00$/);
  // Botão "Adicionar à agenda": vencimento, número e valor em centavos para public/agenda.html.
  assert.match(prepared.body.botaoUrl, /^20991110\.[0-9A-Za-z-]+\.125000$/);
  assert.equal((await f.call("delivery", { channel: "whatsapp" })).status, 409, "em andamento");
  assert.equal((await f.call("delivery-result", { channel: "whatsapp", attemptId: "outro", ok: true, messageId: "x" })).status, 409);
  const done = await f.call("delivery-result", { channel: "whatsapp", attemptId: prepared.body.attemptId, ok: true, messageId: "wamid.1" });
  assert.equal(done.body.delivery.state, "sent");
  assert.equal((await f.call("delivery")).body.deliveries.whatsapp.state, "sent");
  assert.equal((await f.call("delivery", { channel: "whatsapp" })).body.alreadySent, true);
  // Falha comprovada pode tentar de novo sem motivo.
  const g = deliveryFixture();
  await g.issued();
  const p = await g.call("delivery", { channel: "whatsapp" });
  await g.call("delivery-result", { channel: "whatsapp", attemptId: p.body.attemptId, ok: false, error: "Modelo não aprovado" });
  assert.equal((await g.call("delivery", { channel: "whatsapp" })).status, 200);
});

// Envio automático pelo job: boleto emitido que ficou sem e-mail (tela fechada
// ou registro do banco demorou). Nunca repete o que já saiu ou ficou incerto.
const { runDeliverySweep, SWEEP_UID } = require("./boleto-delivery-sweep");
const sweepEnv = { ...production, ...graph, BOLETO_DELIVERY_SWEEP_ENABLED: "true", BOLETO_DELIVERY_SWEEP_SINCE: "2000-01-01T00:00:00Z" };
const sweep = (f, extra = {}) => runDeliverySweep({ db: f.db, env: { ...sweepEnv, ...extra }, fetchImpl: f.fetchImpl, now: Date.now() });

test("job envia por e-mail o boleto emitido que ficou sem envio, uma vez só", async () => {
  const f = deliveryFixture({ registered: false });
  await f.issued();
  // Registro ainda não confirmado: nada sai, tenta depois com espera.
  const waiting = await sweep(f);
  assert.equal(waiting.pending, 1);
  assert.equal(deliveries(f).length, 0);
  assert.equal(f.calls.filter((u) => u.includes("sendMail")).length, 0);
  const [retryKey, retry] = [...f.data.entries()].find(([k]) => k.startsWith("boletoDeliverySweep/"));
  assert.equal(retry.tries, 1);
  // Dentro da espera não consulta o emissor de novo.
  const second = await sweep(f); assert.equal(second.skipped, 1, JSON.stringify(second));
  f.data.set(retryKey, { ...retry, nextAt: 0 });
  f.state.registered = true;
  const sent = await sweep(f);
  assert.equal(sent.sent, 1, JSON.stringify(sent));
  assert.equal(f.calls.filter((u) => u.includes("sendMail")).length, 1);
  const [, saved] = deliveries(f).find(([k]) => !k.includes("/events/"));
  assert.equal(saved.state, "sent");
  assert.equal(saved.uid, SWEEP_UID);
  assert.equal(saved.automatic, true);
  // Já enviado: o job não repete e a tela pede motivo.
  assert.equal((await sweep(f)).sent, 0);
  assert.equal(f.calls.filter((u) => u.includes("sendMail")).length, 1);
  assert.equal((await f.call("delivery", { channel: "email" })).body.alreadySent, true);
});

test("job não envia sem chave, antes da data de início, sem e-mail, pago, vencido ou já tentado pela tela", async () => {
  const mails = (f) => f.calls.filter((u) => u.includes("sendMail")).length;
  const f = deliveryFixture();
  await f.issued();
  assert.equal((await sweep(f, { BOLETO_DELIVERY_SWEEP_ENABLED: "false" })).disabled, true);
  assert.equal((await sweep(f, { BOLETO_DELIVERY_SWEEP_SINCE: "" })).reason, "NO_START_DATE");
  assert.equal((await sweep(f, { BOLETO_DELIVERY_SWEEP_SINCE: "2999-01-01T00:00:00Z" })).candidates, 0);
  assert.equal((await sweep(f, { FINANCEIRO_COMMUNICATION_SEND_ENABLED: "false" })).reason, "EMAIL_NOT_CONFIGURED");
  const tx = f.data.get("transactions/a"), profile = f.data.get("billingProfiles/doc-11222333000181");
  f.data.set("billingProfiles/doc-11222333000181", { ...profile, deliveryChannels: ["whatsapp"] });
  assert.equal((await sweep(f)).skipped, 1);
  f.data.set("billingProfiles/doc-11222333000181", profile);
  f.data.set("transactions/a", { ...tx, dueDate: "2000-01-01" });
  assert.equal((await sweep(f)).skipped, 1);
  f.data.set("transactions/a", { ...tx, status: "Pago", valueReceived: 1250 });
  assert.equal((await sweep(f)).pending, 1);
  assert.equal(mails(f), 0);
  // Envio incerto pela tela: o job não toca.
  const g = deliveryFixture({ mail: 500 });
  await g.issued();
  assert.equal((await g.call("delivery", { channel: "email" })).body.delivery.state, "unknown");
  const before = g.calls.filter((u) => u.includes("sendMail")).length;
  assert.equal((await sweep(g)).candidates, 0);
  assert.equal(g.calls.filter((u) => u.includes("sendMail")).length, before);
});

// Alerta diário: lista o que pode deixar o faturamento incompleto e sai uma vez por dia.
const { runDailyAlert, recordRun } = require("./boleto-daily-alert");
const alertEnv = { ...production, ...graph, BOLETO_DAILY_ALERT_EMAIL: "paulo@exemplo.com.br" };
const at10 = (day) => Date.parse(`${day}T13:00:00Z`);

test("alerta diário lista boleto sem envio, retorno em conferência e robô com erro, uma vez por dia", async () => {
  const f = deliveryFixture({ registered: false });
  await f.issued();
  const [key, issue] = f.stored();
  f.data.set(key, { ...issue, attemptAt: Date.now() - 2 * 3600000 });
  f.data.set("boletoReturnEvents/e1", { state: "review", number: "00024749-8", reason: "Conta já paga com valor ou data divergente do banco." });
  f.data.set("boletoReturnJobs/history-production", { attention: [{ number: "00025048-4", reason: "Emissor recusou a consulta deste título (HTTP 404)." }] });
  const now = Date.now();
  await recordRun(f.db, true, now - 86400000);
  await recordRun(f.db, false, now - 86400000);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(now));
  const run = (extra = {}, when = Math.max(now, at10(today))) => runDailyAlert({ db: f.db, env: { ...alertEnv, ...extra }, fetchImpl: f.fetchImpl, now: when });
  assert.equal((await run({ BOLETO_DAILY_ALERT_EMAIL: "" })).disabled, true);
  assert.equal((await run({}, Date.parse(`${today}T09:00:00Z`))).waiting, true, "antes das 8h de Brasília");
  const sent = await run();
  assert.equal(sent.state, "sent", JSON.stringify(sent));
  assert.equal(sent.findings, 5);
  const mail = f.calls.mail.message;
  assert.deepEqual(mail.toRecipients.map((r) => r.emailAddress.address), ["paulo@exemplo.com.br"]);
  assert.match(mail.subject, /5 ponto\(s\) para conferir/);
  assert.match(mail.body.content, /ainda não enviado/);
  assert.match(mail.body.content, /em conferência/);
  assert.match(mail.body.content, /execução em erro/);
  const pdf = mail.attachments.find((a) => a.name.endsWith(".pdf"));
  assert.equal(Buffer.from(pdf.contentBytes, "base64").subarray(0, 5).toString(), "%PDF-");
  // Mesmo dia: não repete.
  assert.ok((await run()).alreadySent);
  assert.equal(f.calls.filter((u) => u.includes("sendMail")).length, 1);
});

test("alerta sem pendência também sai (prova que funciona) e falha de envio tenta de novo", async () => {
  const f = deliveryFixture({ mail: 500 });
  const now = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(now));
  const when = Math.max(now, at10(today));
  const failed = await runDailyAlert({ db: f.db, env: alertEnv, fetchImpl: f.fetchImpl, now: when });
  assert.equal(failed.state, "failed");
  assert.equal(failed.errors, 1);
  f.state.mail = 202;
  const ok = await runDailyAlert({ db: f.db, env: alertEnv, fetchImpl: f.fetchImpl, now: when });
  assert.equal(ok.state, "sent");
  assert.equal(ok.findings, 0);
  assert.match(f.calls.mail.message.subject, /sem pendências/);
});

test("alerta lista à parte o WhatsApp que não saiu", async () => {
  const f = deliveryFixture();
  await f.issued();
  const [key, issue] = f.stored();
  f.data.set(key, { ...issue, attemptAt: Date.now() - 2 * 3600000 });
  assert.equal((await f.call("delivery", { channel: "email" })).body.delivery.state, "sent");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const r = await runDailyAlert({ db: f.db, env: alertEnv, fetchImpl: f.fetchImpl, now: Math.max(Date.now(), at10(today)) });
  assert.equal(r.findings, 1);
  assert.match(f.calls.mail.message.body.content, /não enviado por WhatsApp/);
});
