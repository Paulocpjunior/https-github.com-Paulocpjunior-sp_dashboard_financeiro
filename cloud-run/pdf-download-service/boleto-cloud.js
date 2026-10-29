const { InviteError, prepareInvite, sendInvite } = require('./boleto-invite');
const { createHash, randomUUID } = require("node:crypto");
const { permitted } = require("./itau-statements");
const { assertNoWixInvoice } = require("./wix-billing-lock");
const delivery = require("./boleto-delivery");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const digits = (value) => String(value || "").replace(/\D/g, "");
class BoletoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function money(value) {
  let s = String(value ?? "")
    .trim()
    .replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return Number(s) || 0;
}
function amount(row) {
  return (
    [
      row.totalCobranca,
      row.valorOriginal,
      money(row.honorarios) + money(row.valorExtra),
      row.valueReceived,
    ]
      .map(money)
      .find((n) => n > 0) || 0
  );
}
function validDocument(value) {
  const s = digits(value);
  if (![11, 14].includes(s.length) || /^(\d)\1+$/.test(s)) return false;
  const base = s.length - 2;
  for (let n = base; n < s.length; n++) {
    const weights =
      s.length === 11
        ? Array.from({ length: n }, (_, i) => n + 1 - i)
        : n === 12
          ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
          : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const remainder =
      [...s.slice(0, n)].reduce(
        (sum, d, i) => sum + Number(d) * weights[i],
        0,
      ) % 11;
    if (Number(s[n]) !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}
function eligible(row) {
  const method = norm(row.metodoPagamento || row.paymentMethod || row.method);
  return (
    !row.isExcluded &&
    !row.boletoReconciliation &&
    !row.receivableBalance && !row.receivableSettlement &&
    ["pendente", "agendado", "vencida"].includes(norm(row.status)) &&
    norm(row.movement) === "entrada" &&
    !/saida|pagar/.test(norm(row.type)) &&
    !row.wixInvoiceNumber &&
    !row.wixEntityId &&
    norm(row.source) !== "wix" &&
    method.includes("boleto") &&
    money(row.valuePaid) <= 0
  );
}
function config(env) {
  const environment = env.BOLETO_CLOUD_ENVIRONMENT || "sandbox";
  if (!["sandbox", "production"].includes(environment))
    throw new BoletoError("Ambiente Boleto Cloud inválido.", 503);
  const production = environment === "production";
  const apiKey =
    env[production ? "BOLETO_CLOUD_API_KEY" : "BOLETO_CLOUD_SANDBOX_API_KEY"];
  const accountToken =
    env[
      production
        ? "BOLETO_CLOUD_ACCOUNT_TOKEN"
        : "BOLETO_CLOUD_SANDBOX_ACCOUNT_TOKEN"
    ];
  const enabled = env.BOLETO_CLOUD_ISSUANCE_ENABLED === "true";
  const cutover = env.BOLETO_CLOUD_CUTOVER_DATE || "";
  if (production && (!validDate(cutover) || cutover > today()))
    throw new BoletoError(
      "Defina a data de início da emissão em produção.",
      503,
    );
  return {
    environment,
    enabled,
    apiKey,
    accountToken,
    cutover,
    accountFingerprint: hash(accountToken || ""),
    base: production
      ? "https://app.boletocloud.com/api/v1"
      : "https://sandbox.boletocloud.com/api/v1",
  };
}
function payload(row, address, emission = today()) {
  if (row.source === 'native-finance' && row.bankAccount !== require('./native-entry-catalog.json').banks[0])
    throw new BoletoError('A conta do lançamento deve ser a conta Itaú 3145 / 99791-6 configurada para emissão.');
  if (!eligible(row))
    throw new BoletoError(
      "Cobrança excluída, liquidada, de saída ou sem método Boleto.",
    );
  if (!validDocument(row.cpfCnpj))
    throw new BoletoError(
      "Corrija o CPF/CNPJ no cadastro de origem antes de emitir.",
    );
  if (!validDate(row.dueDate) || row.dueDate < today())
    throw new BoletoError("Corrija o vencimento da cobrança antes de emitir.");
  const value = amount(row);
  if (!Number.isFinite(value) || value <= 0 || value >= 100000000)
    throw new BoletoError("Valor da cobrança inválido.");
  const fields = {
    "boleto.emissao": emission,
    "boleto.vencimento": row.dueDate,
    "boleto.documento": String(
      row.numeroDocumento || row.description || "Honorários",
    ).slice(0, 20),
    "boleto.titulo": "DS",
    "boleto.valor": value.toFixed(2),
    "boleto.pagador.nome": String(row.client || "").trim(),
    "boleto.pagador.cprf": digits(row.cpfCnpj),
  };
  if (!fields["boleto.pagador.nome"])
    throw new BoletoError("Nome do pagador ausente.");
  const clean = normalizeAddress(address);
  for (const [key, value] of Object.entries(clean))
    fields[`boleto.pagador.endereco.${key}`] = value;
  fields["boleto.pagador.endereco.cep"] = clean.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2");
  return fields;
}
// Endereço do pagador como o emissor aceita: CEP com 8 dígitos, UF válida e
// todos os campos preenchidos, menos o complemento.
function normalizeAddress(address) {
  const clean = {};
  for (const key of [
    "cep",
    "uf",
    "localidade",
    "bairro",
    "logradouro",
    "numero",
    "complemento",
  ]) {
    let value = String(address?.[key] || "").trim();
    if (key === "cep") value = digits(value);
    if (key === "uf") value = value.toUpperCase();
    if (
      (key !== "complemento" && !value) ||
      value.length > 120 ||
      /[\r\n]/.test(value)
    )
      throw new BoletoError(`Confira o endereço: ${key}.`);
    clean[key] = value;
  }
  if (
    !/^\d{8}$/.test(clean.cep) ||
    !"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
      .split(" ")
      .includes(clean.uf)
  )
    throw new BoletoError("CEP ou UF inválido.");
  return clean;
}
// Mesmo identificador de customer-directory.js billingKey/billingId.
const billingAddressIds = (row) =>
  [
    digits(row.cpfCnpj) && `doc-${digits(row.cpfCnpj)}`,
    digits(row.clientNumber) && `client-${digits(row.clientNumber)}`,
  ].filter(Boolean);
async function savedAddress(db, row) {
  for (const id of billingAddressIds(row)) {
    const saved = (await db.collection("billingAddresses").doc(id).get()).data();
    if (fullAddress(saved?.address)) return saved.address;
  }
  return null;
}
async function validationError(result, cfg) {
  const fallback = "Dados recusados pelo Boleto Cloud. Revise os dados antes de tentar novamente.";
  try {
    const reader = result.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) return fallback;
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Array.isArray(data?.erro?.causas)) return fallback;
    const details = data.erro.causas.slice(0, 5).map((cause) => {
      if (typeof cause?.mensagem !== "string") return "";
      let message = cause.mensagem;
      for (const secret of [cfg.apiKey, cfg.accountToken].filter(Boolean))
        message = message.split(secret).join("[credencial omitida]");
      message = message.replace(/api-key_[\w-]+/gi, "[credencial omitida]")
        .replace(/[\r\n\t]+/g, " ").slice(0, 400);
      const code = /^[A-Z0-9]{1,16}$/.test(cause.codigo || "") ? ` (${cause.codigo})` : "";
      return message + code;
    }).filter(Boolean);
    return details.length ? `Boleto Cloud: ${details.join("; ")}` : fallback;
  } catch { return fallback; }
}
// Pix copia e cola (EMV) que o Boleto Cloud devolve quando o Pix está ativo
// na conta (header X-BoletoCloud-Pix-Codigo-EMV, plano Personalizado). Só
// aceita um código EMV de Pix bem formado; qualquer outra coisa é ignorada.
function pixCode(value) {
  const code = String(value || "").trim();
  return /^000201[\x20-\x7E]{20,500}$/.test(code) ? code : "";
}
function publicRecord(record, cfg) {
  if (!record)
    return {
      environment: cfg.environment,
      enabled: cfg.enabled && Boolean(cfg.apiKey && cfg.accountToken),
      state: "new",
    };
  return {
    environment: cfg.environment,
    enabled: cfg.enabled && Boolean(cfg.apiKey && cfg.accountToken),
    state: record.state,
    previewHash: record.previewHash,
    fields: record.fields,
    number: record.number || "",
    pix: Boolean(record.pixEmv),
    registration: record.registration || null,
    updatedAt: record.updatedAt,
    error: record.error || "",
    canRecover:
      ["unknown", "issuing"].includes(record.state) &&
      Date.now() - record.attemptAt > 60000,
  };
}
// Boletos já emitidos para a cobrança fora desta emissão: painel, CSV ou outro
// lançamento com o mesmo pagador, vencimento e valor. Cancelados (baixados) não contam.
function priorBoletos(rows, id, row, ownToken = "") {
  const payer = digits(row.cpfCnpj),
    cents = Math.round(amount(row) * 100);
  return rows.filter(
    (r) =>
      !r.cancelledAt &&
      (!ownToken || r.token !== ownToken) &&
      (r.transactionId === id ||
        (payer &&
          r.payerDocument === payer &&
          r.dueDate === row.dueDate &&
          r.amountCents === cents)),
  );
}
const ADDRESS_KEYS = ["cep", "uf", "localidade", "bairro", "logradouro", "numero"];
const fullAddress = (a) =>
  a && ADDRESS_KEYS.every((k) => String(a[k] || "").trim()) ? a : null;
const addressFromFields = (fields) =>
  fields &&
  Object.fromEntries(
    [...ADDRESS_KEYS, "complemento"].map((k) => [
      k,
      fields[`boleto.pagador.endereco.${k}`] || "",
    ]),
  );
const BATCH_LIMIT = 100,
  STATUS_LIMIT = 1000;
let sharedHistory;
const defaultHistory = () =>
  (sharedHistory ||= require("./boleto-history").createHistoryReader());
// Confere a cobrança, o contato e o boleto no emissor (em aberto, registro
// confirmado, mesmo valor, vencimento e pagador) antes de qualquer envio. Usado
// pela tela e pelo envio automático do job; nada é reservado aqui.
async function prepareDelivery({ db, env, fetchImpl, cfg, id, existing, row, channel }) {
  if (!row || !eligible(row) || money(row.valueReceived) > 0)
    throw new BoletoError("Cobrança paga, excluída ou indisponível para envio.", 409);
  const contacts = await delivery.contactsFor(db, row);
  const problem = delivery.contactError(contacts, channel);
  if (problem) throw Object.assign(new BoletoError(problem, 409), { needsContact: true });
  if (channel === "email" && !delivery.emailEnabled(env))
    throw Object.assign(new BoletoError("Envio por e-mail ainda não habilitado: faltam as credenciais do Microsoft 365 da caixa financeiro@.", 503), { notConfigured: true });
  if (channel === "whatsapp" && delivery.whatsappMissing(env).length)
    throw Object.assign(new BoletoError(`Envio por WhatsApp ainda não habilitado no servidor: falta ${delivery.whatsappMissing(env).join(", ")}.`, 503), { notConfigured: true });
  if (!cfg.apiKey || !cfg.accountToken) throw new BoletoError("Credenciais indisponíveis.", 503);
  let artifact;
  try {
    // Demonstrativo só quando a composição confere com o valor do boleto.
    const entry = Math.round(Number(row.valorOriginal) * 100) === Math.round(amount(row) * 100) ? row : null;
    artifact = await prepareInvite({token:existing.token,base:cfg.base,apiKey:cfg.apiKey,fetchImpl,entry,
      expected:{token:existing.token,number:existing.number,amountCents:Math.round(amount(row)*100),dueDate:row.dueDate,payerDocument:digits(row.cpfCnpj)}});
  } catch (error) {
    if (error instanceof InviteError) throw Object.assign(new BoletoError(error.message, error.status), { pending: Boolean(error.pending) });
    throw error;
  }
  const value = amount(row).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return { contacts, artifact, value, target: delivery.deliveryRef(db, cfg.environment, id, existing.token, channel) };
}
// Envia o e-mail já reservado (claim) e grava o resultado.
async function finishEmail({ db, env, fetchImpl, cfg, id, existing, row, uid, attemptId, contacts, artifact, value, target }) {
  const message = delivery.emailMessage(artifact, { to: contacts.email, idempotencyKey: delivery.deliveryKey(cfg.environment, id, existing.token, "email"), value, dueDate: row.dueDate, client: row.client, pix: existing.pixEmv || "" });
  const result = await delivery.sendEmail({ env, fetchImpl, message });
  return delivery.finish(db, target, { uid, attemptId, ...result });
}
function createBoletoHandler({
  getServices,
  readBody,
  sendJson,
  env = process.env,
  fetchImpl = fetch,
  historyReader = null,
}) {
  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith("/api/boleto-cloud/")) return false;
    try {
      const bearer = String(request.headers.authorization || "").match(
        /^Bearer (\S+)$/,
      );
      if (!bearer)
        throw new BoletoError("Entre novamente para emitir boletos.", 401);
      const { adminAuth, adminDb: db } = getServices();
      let uid;
      try {
        uid = (await adminAuth.verifyIdToken(bearer[1], true)).uid;
      } catch {
        throw new BoletoError("Sessão expirada.", 401);
      }
      const userRef = db.collection("users").doc(uid);
      const allowed = (profile) =>
        permitted(profile, "billing.boleto-cloud.issue");
      if (!allowed((await userRef.get()).data()))
        throw new BoletoError("Sem permissão para emitir boletos.", 403);
      const cfg = config(env);
      const history = historyReader || defaultHistory();
      const issueRef = (itemId) =>
        db.collection("boletoIssues").doc(hash([cfg.environment, itemId]));
      const eventFor = (tx, target, action, extra = {}) =>
        tx.create(target.collection("events").doc(), {
          action,
          uid,
          at: new Date().toISOString(),
          ...extra,
        });
      // O histórico Boleto Cloud (painel, CSV e app) só existe em produção.
      const historyRows = async () => {
        if (cfg.environment !== "production") return [];
        try {
          return (await history.load(db)).rows;
        } catch {
          throw new BoletoError(
            "Histórico Boleto Cloud indisponível. Não é possível confirmar que a 1ª via ainda não foi emitida; tente novamente em instantes.",
            503,
          );
        }
      };
      // Trava de 1ª via: nunca emitir de novo para a mesma cobrança.
      const firstIssueGuard = (rows, itemId, row, record) => {
        if (row.boletoReconciliation)
          throw Object.assign(
            new BoletoError(
              "1ª via já emitida: este lançamento está vinculado a um boleto. Use o histórico Boleto Cloud para a 2ª via.",
              409,
            ),
            { alreadyIssued: true },
          );
        const prior = priorBoletos(rows, itemId, row, record?.token);
        if (prior.length)
          throw Object.assign(
            new BoletoError(
              `1ª via já emitida para esta cobrança (boleto nº ${prior[0].number || "sem número"}, vencimento ${prior[0].dueDate}). Não emita de novo; use o histórico Boleto Cloud para a 2ª via.`,
              409,
            ),
            { alreadyIssued: true },
          );
      };
      // Empresa com Fatura Wix não recebe boleto (cobrança em dobro).
      const wixLockFor = async (itemId, row, stage, override) => {
        try {
          await assertNoWixInvoice(db, row, { channel: "boleto", uid, stage, transactionId: itemId, profile: (await userRef.get()).data(), override: override || null });
        } catch (error) {
          if (!error.status) throw error;
          throw Object.assign(new BoletoError(error.message, error.status), { wixInvoices: error.wixInvoices });
        }
      };
      // Ordem: endereço corrigido no cadastro (Regra de faturamento), lançamento
      // nativo, revisão anterior e último boleto emitido para o mesmo CPF/CNPJ.
      const suggestAddress = async (row, record, resolveAddress) =>
        fullAddress(await savedAddress(db, row)) ||
        fullAddress(row.nativeEntry?.address) ||
        fullAddress(addressFromFields(record?.fields)) ||
        (await resolveAddress(digits(row.cpfCnpj)));
      let addresses;
      const issuedAddress = async (payer) => {
        if (!addresses) {
          addresses = new Map();
          const issued = await db.collection("boletoIssues").where("environment", "==", cfg.environment).get();
          const docs = issued.docs
            .map((d) => d.data())
            .filter((r) => r.state === "issued" && r.fields)
            .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
          for (const r of docs) {
            const key = r.fields["boleto.pagador.cprf"];
            if (key && !addresses.has(key)) addresses.set(key, addressFromFields(r.fields));
          }
        }
        return fullAddress(addresses.get(payer)) || null;
      };
      const previewItem = async (itemId, { address, wixOverride, batchId, resolveAddress }) => {
        const target = issueRef(itemId),
          origin = db.collection("transactions").doc(itemId);
        const before = (await target.get()).data();
        const current = (await origin.get()).data();
        if (!current) throw new BoletoError("Cobrança não encontrada.", 404);
        let chosen = address;
        if (!before || ["draft", "rejected"].includes(before.state)) {
          firstIssueGuard(await historyRows(), itemId, current, before);
          await wixLockFor(itemId, current, "preview", wixOverride);
          if (resolveAddress) chosen = await suggestAddress(current, before, resolveAddress);
        }
        return db.runTransaction(async (tx) => {
          if (!allowed((await tx.get(userRef)).data()))
            throw new BoletoError("Acesso revogado.", 403);
          const old = (await tx.get(target)).data();
          if (old && !["draft", "rejected"].includes(old.state)) return old;
          const row = (await tx.get(origin)).data();
          if (!row) throw new BoletoError("Cobrança não encontrada.", 404);
          const fields = payload(row, chosen);
          const record = {
            transactionId: itemId,
            environment: cfg.environment,
            accountFingerprint: cfg.accountFingerprint,
            fields,
            sourceHash: hash(row),
            state: "draft",
            updatedAt: new Date().toISOString(),
            previewHash: hash([fields, hash(row), cfg.accountFingerprint]),
            control: `sp-${hash([cfg.environment, itemId]).slice(0, 40)}`,
          };
          tx.set(target, record);
          eventFor(tx, target, "preview", batchId ? { batchId } : {});
          return record;
        });
      };
      const batchMatch = url.pathname.match(/^\/api\/boleto-cloud\/batch\/(status|preview)$/);
      if (batchMatch) {
        if (request.method !== "POST")
          throw new BoletoError("Rota não encontrada.", 404);
        let input;
        try {
          input = JSON.parse((await readBody(request)).toString("utf8"));
        } catch {
          throw new BoletoError("Requisição inválida.");
        }
        const ids = Array.isArray(input?.ids) ? [...new Set(input.ids)] : [];
        const limit = batchMatch[1] === "status" ? STATUS_LIMIT : BATCH_LIMIT;
        if (!ids.length || ids.length > limit || ids.some((i) => typeof i !== "string" || !i || i.includes("/") || i.length > 500))
          throw new BoletoError(`Selecione de 1 a ${limit} cobranças.`);
        if (batchMatch[1] === "status") {
          let rows = [],
            historyAvailable = true;
          try {
            rows = await historyRows();
          } catch {
            historyAvailable = false;
          }
          const items = {};
          for (let i = 0; i < ids.length; i += 50) {
            await Promise.all(
              ids.slice(i, i + 50).map(async (itemId) => {
                const [record, row] = await Promise.all([
                  issueRef(itemId).get().then((d) => d.data()),
                  db.collection("transactions").doc(itemId).get().then((d) => d.data()),
                ]);
                const prior = row ? priorBoletos(rows, itemId, row, record?.token) : [];
                items[itemId] =
                  record?.state === "issued"
                    ? { status: "issued", origin: "app", number: record.number || "" }
                    : ["issuing", "unknown"].includes(record?.state)
                      ? { status: "in-progress", origin: "app", number: "" }
                      : row?.boletoReconciliation
                        ? { status: "issued", origin: "linked", number: String(row.boletoReconciliation.number || "") }
                        : prior.length
                          ? { status: "issued", origin: prior[0].detailsSource === "app" ? "app" : "panel", number: String(prior[0].number || "") }
                          : { status: "none", origin: "", number: "" };
              }),
            );
          }
          if (!allowed((await userRef.get()).data()))
            throw new BoletoError("Acesso revogado.", 403);
          sendJson(request, response, 200, { environment: cfg.environment, historyAvailable, items });
          return true;
        }
        const batchId = String(input.batchId || "");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId))
          throw new BoletoError("Lote inválido.");
        const batchRef = db.collection("boletoIssueBatches").doc(batchId);
        const filters = Object.fromEntries(
          ["dueFrom", "dueTo", "clientNumber", "cpfCnpj", "client"].map((k) => [k, String(input.filters?.[k] || "").slice(0, 100)]),
        );
        await db.runTransaction(async (tx) => {
          const prior = (await tx.get(batchRef)).data();
          if (prior && (prior.uid !== uid || prior.environment !== cfg.environment))
            throw new BoletoError("Lote pertence a outra sessão. Monte uma nova seleção.", 409);
          const at = new Date().toISOString();
          // Revisar de novo um item (ex.: endereço corrigido) mantém os demais itens do lote.
          const all = [...new Set([...(prior?.ids || []), ...ids])];
          if (all.length > BATCH_LIMIT * 2) throw new BoletoError("Lote muito grande. Monte uma nova seleção.");
          tx.set(batchRef, { uid, environment: cfg.environment, createdAt: prior?.createdAt || at, updatedAt: at, ids: all, filters: prior?.filters || filters });
          eventFor(tx, batchRef, "select", { count: ids.length, filters });
        });
        const items = [];
        for (const itemId of ids) {
          try {
            const record = await previewItem(itemId, { batchId, resolveAddress: issuedAddress });
            const ready = record.state === "draft";
            items.push({
              id: itemId,
              ready,
              state: record.state,
              block: ready ? "" : record.state === "issued" ? "issued" : "in-progress",
              previewHash: ready ? record.previewHash : "",
              fields: record.fields,
              number: record.number || "",
              error: ready ? "" : record.state === "issued" ? "1ª via já emitida pelo app." : "Emissão anterior aguardando confirmação. Use Recuperar tentativa na emissão individual.",
            });
          } catch (error) {
            if (!(error instanceof BoletoError)) throw error;
            if (error.status === 401 || (error.status === 403 && !error.wixInvoices)) throw error;
            items.push({
              id: itemId,
              ready: false,
              state: "blocked",
              block: error.alreadyIssued ? "issued" : error.wixInvoices ? "wix" : "invalid",
              error: error.message,
              ...(error.wixInvoices ? { wixInvoices: error.wixInvoices } : {}),
            });
          }
        }
        const ready = items.filter((i) => i.ready);
        const totalCents = ready.reduce((n, i) => n + Math.round(Number(i.fields["boleto.valor"]) * 100), 0);
        await db.runTransaction(async (tx) => {
          eventFor(tx, batchRef, "preview", {
            ready: ready.length,
            blocked: items.length - ready.length,
            totalCents,
            blocks: items.filter((i) => !i.ready).map((i) => ({ id: i.id, block: i.block })),
          });
        });
        sendJson(request, response, 200, {
          batchId,
          environment: cfg.environment,
          enabled: cfg.enabled && Boolean(cfg.apiKey && cfg.accountToken),
          totalCents,
          items,
        });
        return true;
      }
      const match = url.pathname.match(
        /^\/api\/boleto-cloud\/items\/([^/]+)(?:\/(preview|issue|recover|pdf|registration|invite|invite-email|delivery|delivery-result))?$/,
      );
      if (!match) throw new BoletoError("Rota não encontrada.", 404);
      const id = decodeURIComponent(match[1]),
        action = match[2];
      if (!id || id.includes("/") || id.length > 500)
        throw new BoletoError("Identificador inválido.");
      const ref = db
        .collection("boletoIssues")
        .doc(hash([cfg.environment, id]));
      const source = db.collection("transactions").doc(id);
      const existing = (await ref.get()).data();
      const reply = (record) =>
        sendJson(request, response, 200, publicRecord(record, cfg));
      const audit = (tx, action, extra = {}) =>
        tx.create(ref.collection("events").doc(), {
          action,
          uid,
          at: new Date().toISOString(),
          ...extra,
        });
      if (!action && request.method === "GET") {
        const row = !existing || ["draft", "rejected"].includes(existing.state) ? (await source.get()).data() : null;
        const suggestedAddress = row ? await suggestAddress(row, existing, issuedAddress) : null;
        sendJson(request, response, 200, { ...publicRecord(existing, cfg), ...(suggestedAddress ? { suggestedAddress } : {}) });
        return true;
      }
      if (action === "delivery" && request.method === "GET") {
        const row = (await source.get()).data();
        const contacts = row ? await delivery.contactsFor(db, row) : null;
        const deliveries = {};
        for (const channel of delivery.CHANNELS)
          deliveries[channel] = existing?.token
            ? delivery.publicDelivery((await delivery.deliveryRef(db, cfg.environment, id, existing.token, channel).get()).data())
            : { state: "none" };
        sendJson(request, response, 200, {
          available: cfg.environment === "production",
          emailEnabled: delivery.emailEnabled(env),
          issued: existing?.state === "issued" && Boolean(existing.token),
          contacts,
          problems: Object.fromEntries(delivery.CHANNELS.map((c) => [c, delivery.contactError(contacts, c)])),
          deliveries,
        });
        return true;
      }
      if (["delivery", "delivery-result"].includes(action) && request.method === "POST") {
        let body;
        try {
          body = JSON.parse((await readBody(request)).toString("utf8"));
        } catch {
          throw new BoletoError("Requisição inválida.");
        }
        const channel = body?.channel;
        if (!delivery.CHANNELS.includes(channel)) throw new BoletoError("Canal inválido.");
        // Boleto de teste (sandbox) nunca vai para cliente.
        if (cfg.environment !== "production")
          throw new BoletoError("Envio ao cliente disponível somente para boletos de produção.", 409);
        if (!existing?.token || existing.state !== "issued" || existing.accountFingerprint !== cfg.accountFingerprint)
          throw new BoletoError("Boleto emitido não encontrado nesta conta.", 409);
        const ref = (token) => delivery.deliveryRef(db, cfg.environment, id, token, channel);
        if (action === "delivery-result") {
          if (channel !== "whatsapp" || typeof body.attemptId !== "string") throw new BoletoError("Resultado inválido.");
          let state = body.ok === true ? "sent" : body.indeterminado === true ? "unknown" : "failed";
          const messageId = typeof body.messageId === "string" ? body.messageId : "";
          if (state === "sent" && !messageId) state = "unknown";
          const saved = await delivery.finish(db, ref(existing.token), { uid, attemptId: body.attemptId, state, error: typeof body.error === "string" ? body.error : "", providerId: messageId });
          sendJson(request, response, 200, { channel, delivery: delivery.publicDelivery(saved) });
          return true;
        }
        const row = (await source.get()).data();
        const prepared = await prepareDelivery({ db, env, fetchImpl, cfg, id, existing, row, channel });
        const { contacts, artifact, value, target } = prepared;
        const to = channel === "email" ? contacts.email.join(", ") : contacts.whatsapp;
        const attemptId = await delivery.claim(db, target, {
          uid, channel, to, resendReason: body.resendReason,
          base: { transactionId: id, environment: cfg.environment, number: existing.number || "", profileId: contacts.profileId },
          allowed: async (tx) => { if (!allowed((await tx.get(userRef)).data())) throw new BoletoError("Acesso revogado.", 403); },
        });
        if (channel === "email") {
          const saved = await finishEmail({ db, env, fetchImpl, cfg, id, existing, row, uid, attemptId, ...prepared });
          sendJson(request, response, 200, { channel, delivery: delivery.publicDelivery(saved) });
          return true;
        }
        // WhatsApp: o servidor envia pelo CFI com a chave de serviço; o login
        // de quem apertou o botão já foi conferido acima e fica na auditoria.
        const result = await delivery.sendWhatsapp({ env, fetchImpl, message: {
          para: contacts.whatsapp,
          nomeArquivo: `boleto-${artifact.number}.pdf`,
          pdfBase64: artifact.pdf.toString("base64"),
          referencia: `financeiro:boleto ${artifact.number}`,
          // Final do link do botão "Adicionar à agenda" do modelo (public/agenda.html?b=...).
          botaoUrl: `${row.dueDate.replace(/-/g, "")}.${artifact.number}.${Math.round(amount(row) * 100)}`,
          variaveis: {
            cliente: String(row.client || "").trim(),
            nome: String(row.client || "").trim(),
            valor: value,
            vencimento: row.dueDate.split("-").reverse().join("/"),
            numero: artifact.number,
            boleto: artifact.number,
          },
        } });
        const saved = await delivery.finish(db, target, { uid, attemptId, ...result });
        sendJson(request, response, 200, { channel, delivery: delivery.publicDelivery(saved) });
        return true;
      }
      if (["invite", "invite-email"].includes(action) && request.method === "GET") {
        if (!existing?.token || existing.state !== "issued" || existing.accountFingerprint !== cfg.accountFingerprint)
          throw new BoletoError("Boleto emitido não encontrado nesta conta.", 409);
        const row = (await source.get()).data();
        if (!row || !eligible(row) || money(row.valueReceived)>0) throw new BoletoError("Cobrança paga, excluída ou indisponível para INVITE.", 409);
        if (!cfg.apiKey || !cfg.accountToken) throw new BoletoError("Credenciais indisponíveis.", 503);
        const artifact = await prepareInvite({token:existing.token,base:cfg.base,apiKey:cfg.apiKey,fetchImpl,entry:row,
          expected:{token:existing.token,number:existing.number,amountCents:Math.round(amount(row)*100),dueDate:row.dueDate,payerDocument:digits(row.cpfCnpj)}});
        if (!allowed((await userRef.get()).data())) throw new BoletoError("Acesso revogado.", 403);
        const refreshed = (await source.get()).data();
        if (JSON.stringify(refreshed)!==JSON.stringify(row)) throw new BoletoError("Cobrança alterada durante a preparação.",409);
        sendInvite(response, artifact, action);
        return true;
      }
      if (
        ["pdf", "registration"].includes(action) &&
        request.method === "GET"
      ) {
        if (!existing?.token)
          throw new BoletoError(
            "Ainda não há boleto confirmado para esta cobrança.",
            409,
          );
        if (existing.accountFingerprint !== cfg.accountFingerprint)
          throw new BoletoError(
            "Conta alterada. Consulte o administrador.",
            409,
          );
        if (!cfg.apiKey || !cfg.accountToken)
          throw new BoletoError("Credenciais indisponíveis.", 503);
        const result = await fetchImpl(
          `${cfg.base}/boletos/${encodeURIComponent(existing.token)}${action === "registration" ? "/registro" : ""}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:token`).toString("base64")}`,
              Accept: action === "pdf" ? "application/pdf" : "application/json",
            },
            signal: AbortSignal.timeout(25000),
            redirect: "error",
          },
        );
        if (!result.ok)
          throw new BoletoError(
            "Consulta indisponível no Boleto Cloud. Nenhuma nova emissão foi feita.",
            502,
          );
        if (!allowed((await userRef.get()).data()))
          throw new BoletoError("Acesso revogado.", 403);
        if (action === "pdf") {
          const bytes = Buffer.from(await result.arrayBuffer());
          if (
            bytes.subarray(0, 5).toString() !== "%PDF-" ||
            bytes.length > 10000000
          )
            throw new BoletoError("PDF inválido retornado pelo emissor.", 502);
          response.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="boleto.pdf"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(bytes);
        } else {
          const body = await result.json();
          if (!body.status || body.status.token !== existing.token)
            throw new BoletoError("Resposta de registro inconsistente.", 502);
          const registration = {
            registeredAt: validDate(body.status.registrado)
              ? body.status.registrado
              : null,
            rejected: Boolean(body.status.erro),
            checkedAt: new Date().toISOString(),
          };
          await ref.update({ registration });
          reply({ ...existing, registration });
        }
        return true;
      }
      if (
        request.method !== "POST" ||
        !["preview", "issue", "recover"].includes(action)
      )
        throw new BoletoError("Rota não encontrada.", 404);
      let body;
      try {
        body = JSON.parse((await readBody(request)).toString("utf8"));
      } catch {
        throw new BoletoError("Requisição inválida.");
      }
      const wixLock = async (stage, override) => {
        const row = (await source.get()).data();
        if (!row || (stage === "issue" && existing?.state === "issued")) return;
        await wixLockFor(id, row, stage, override);
      };
      if (action === "preview") {
        reply(await previewItem(id, { address: body.address, wixOverride: body.wixOverride }));
        return true;
      }
      if (!cfg.enabled || !cfg.apiKey || !cfg.accountToken)
        throw new BoletoError(
          "Emissão não habilitada ou credenciais ainda não configuradas.",
          503,
        );
      if (action === "issue") await wixLock("issue", body.wixOverride);
      let batchId = null;
      if (action === "issue" && body.batchId !== undefined) {
        batchId = String(body.batchId);
        const batch = /^[0-9a-f-]{36}$/.test(batchId)
          ? (await db.collection("boletoIssueBatches").doc(batchId).get()).data()
          : null;
        if (!batch || batch.uid !== uid || batch.environment !== cfg.environment || !batch.ids?.includes(id))
          throw new BoletoError("Cobrança fora do lote revisado. Refaça a seleção.", 409);
      }
      if (action === "issue" && existing?.state !== "issued") {
        const row = (await source.get()).data();
        if (row) firstIssueGuard(await historyRows(), id, row, existing);
      }
      const attempt = randomUUID();
      const record = await db.runTransaction(async (tx) => {
        if (!allowed((await tx.get(userRef)).data()))
          throw new BoletoError("Acesso revogado.", 403);
        const old = (await tx.get(ref)).data();
        if (!old)
          throw new BoletoError("Revise a cobrança antes de emitir.", 409);
        if (old.state === "issued") return old;
        if (old.accountFingerprint !== cfg.accountFingerprint)
          throw new BoletoError("Conta alterada. Refaça a revisão.", 409);
        if (action === "recover") {
          if (
            !["unknown", "issuing"].includes(old.state) ||
            Date.now() - old.attemptAt < 60000
          )
            throw new BoletoError(
              "Aguarde um minuto antes de recuperar a tentativa.",
              409,
            );
        } else {
          if (
            old.state !== "draft" ||
            body.previewHash !== old.previewHash ||
            body.legacyChecked !== true
          )
            throw new BoletoError(
              "Revise a cobrança e confirme que não foi emitida por CSV ou pelo painel.",
              409,
            );
          const row = (await tx.get(source)).data();
          if (
            !row ||
            hash(row) !== old.sourceHash ||
            !eligible(row) ||
            old.fields["boleto.emissao"] !== today()
          )
            throw new BoletoError(
              "Cobrança alterada ou revisão vencida. Refaça a revisão.",
              409,
            );
          const peers = await tx.get(
            db
              .collection("transactions")
              .where("dueDate", "==", row.dueDate)
              .limit(1001),
          );
          if (peers.docs.length > 1000)
            throw new BoletoError(
              "Volume de cobranças exige revisão antes de emitir.",
              409,
            );
          if (
            peers.docs.some(
              (doc) =>
                doc.id !== id &&
                !doc.data().isExcluded &&
                norm(doc.data().movement) === "entrada" &&
                digits(doc.data().cpfCnpj) === digits(row.cpfCnpj) &&
                amount(doc.data()).toFixed(2) === amount(row).toFixed(2),
            )
          )
            throw new BoletoError(
              "Há outro lançamento com mesmo pagador, valor e vencimento. Revise a duplicidade antes de emitir.",
              409,
            );
          const duplicateRef = db
            .collection("boletoIssueLocks")
            .doc(
              hash([
                cfg.environment,
                old.fields["boleto.pagador.cprf"],
                old.fields["boleto.vencimento"],
                old.fields["boleto.valor"],
              ]),
            );
          const lock = (await tx.get(duplicateRef)).data();
          if (lock && lock.transactionId !== id)
            throw new BoletoError(
              "Outra cobrança tem o mesmo pagador, valor e vencimento. Revise a possível duplicidade.",
              409,
            );
          tx.set(duplicateRef, {
            transactionId: id,
            at: new Date().toISOString(),
          });
        }
        const next = {
          ...old,
          state: "issuing",
          attempt,
          attemptAt: Date.now(),
          updatedAt: new Date().toISOString(),
          error: "",
          batchId: action === "recover" ? old.batchId || null : batchId,
        };
        tx.set(ref, next);
        audit(tx, action, { attempt, legacyChecked: action === "issue", ...(batchId ? { batchId } : {}) });
        if (batchId)
          eventFor(tx, db.collection("boletoIssueBatches").doc(batchId), "issue", { transactionId: id, attempt });
        return next;
      });
      if (record.state === "issued") {
        reply(record);
        return true;
      }
      let outcome;
      try {
        if (action === "recover") {
          const result = await fetchImpl(
            `${cfg.base}/boletos/controle/${encodeURIComponent(record.control)}/situacao`,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:token`).toString("base64")}`,
                Accept: "application/json",
              },
              signal: AbortSignal.timeout(25000),
              redirect: "error",
            },
          );
          const boleto = result.ok ? (await result.json()).boleto : null;
          outcome =
            boleto?.token &&
            boleto.tokenControleUsuario === record.control &&
            Number(boleto.valor).toFixed(2) === record.fields["boleto.valor"] &&
            boleto.vencimento === record.fields["boleto.vencimento"]
              ? {
                  state: "issued",
                  token: boleto.token,
                  number: String(boleto.numero || ""),
                  pixEmv: pixCode(boleto.codigoEMV || boleto.pix?.codigoEMV),
                  error: "",
                }
              : {
                  state: "unknown",
                  error:
                    "Boleto ainda não localizado ou resposta inconsistente. Confira no painel Boleto Cloud antes de qualquer nova emissão.",
                };
        } else {
          const form = new URLSearchParams({
            ...record.fields,
            "boleto.conta.token": cfg.accountToken,
            "boleto.tokenControleUsuario": record.control,
          });
          const result = await fetchImpl(`${cfg.base}/boletos`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:token`).toString("base64")}`,
              "Content-Type":
                "application/x-www-form-urlencoded; charset=utf-8",
            },
            body: form.toString(),
            signal: AbortSignal.timeout(25000),
            redirect: "error",
          });
          const token = result.headers.get("x-boletocloud-token");
          const echoed = result.headers.get(
            "x-boletocloud-token-controle-usuario",
          );
          if (
            (result.status === 201 || result.status === 409) &&
            token &&
            (result.status === 201
              ? !echoed || echoed === record.control
              : echoed === record.control)
          ) {
            outcome = {
              state: "issued",
              token,
              number:
                result.headers.get("x-boletocloud-nib-nosso-numero") || "",
              pixEmv: pixCode(result.headers.get("x-boletocloud-pix-codigo-emv")),
              error: "",
            };
          } else if (
            action !== "recover" &&
            [400, 401].includes(result.status)
          ) {
            outcome = {
              state: "rejected",
              error:
                result.status === 401
                  ? "Credenciais recusadas pelo Boleto Cloud. Consulte o administrador."
                  : await validationError(result, cfg),
            };
          } else
            outcome = {
              state: "unknown",
              error:
                "Resultado não confirmado. Use Recuperar tentativa; não crie outra cobrança.",
            };
          await result.body?.cancel().catch(() => {});
        }
      } catch {
        outcome = {
          state: "unknown",
          error:
            "Comunicação interrompida. Use Recuperar tentativa para verificar a mesma emissão.",
        };
      }
      const final = await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current.attempt !== attempt) return current;
        const next = {
          ...current,
          ...outcome,
          updatedAt: new Date().toISOString(),
        };
        tx.set(ref, next);
        audit(tx, "result", { attempt, state: outcome.state, ...(current.batchId ? { batchId: current.batchId } : {}) });
        if (current.batchId)
          eventFor(tx, db.collection("boletoIssueBatches").doc(current.batchId), "result", { transactionId: id, attempt, state: outcome.state, number: outcome.number || "" });
        return next;
      });
      reply(final);
    } catch (error) {
      sendJson(
        request,
        response,
        (error instanceof BoletoError || error instanceof InviteError || error instanceof delivery.DeliveryError) ? error.status : 500,
        {
          error:
            (error instanceof BoletoError || error instanceof InviteError || error instanceof delivery.DeliveryError)
              ? error.message
              : "Operação não confirmada. Consulte a cobrança antes de tentar novamente.",
          ...(error instanceof BoletoError && error.wixInvoices ? { wixLock: { invoices: error.wixInvoices } } : {}),
          ...(error instanceof BoletoError && error.alreadyIssued ? { alreadyIssued: true } : {}),
          ...Object.fromEntries(["pending", "alreadySent", "notConfigured", "needsContact"].filter((k) => error?.[k] === true).map((k) => [k, true])),
        },
      );
    }
    return true;
  };
}
module.exports = {
  createBoletoHandler,
  prepareDelivery,
  finishEmail,
  payload,
  eligible,
  amount,
  money,
  validDocument,
  config,
  publicRecord,
  priorBoletos,
  normalizeAddress,
  pixCode,
};
