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
function fixture(fetchImpl, environment = env) {
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
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({
    doc: (id) => doc(`${path}/${id || `event-${++seq}`}`),
    where: (field, op, value) => ({
      path,
      field,
      value,
      limit(n) {
        this.max = n;
        return this;
      },
    }),
  });
  const db = {
    collection,
    runTransaction: (fn) => {
      const run = queue.then(async () => {
        const writes = [];
        const tx = {
          get: async (ref) =>
            ref.field
              ? {
                  docs: [...data.keys()]
                    .filter(
                      (k) =>
                        k.startsWith(`${ref.path}/`) &&
                        k.split("/").length ===
                          ref.path.split("/").length + 1 &&
                        data.get(k)[ref.field] === ref.value,
                    )
                    .slice(0, ref.max)
                    .map(snap),
                }
              : snap(ref.path),
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
      adminAuth: { verifyIdToken: async () => ({ uid: "user" }) },
      adminDb: db,
    }),
    readBody: async (req) => Buffer.from(JSON.stringify(req.body)),
    sendJson: (req, res, status, body) => {
      res.status = status;
      res.body = body;
    },
    env: environment,
    fetchImpl,
  });
  const call = async (action = "", body, id = "a", authorized = true) => {
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
        headers: authorized ? { authorization: "Bearer valid" } : {},
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
  return { data, call, preview, issue, stored };
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
