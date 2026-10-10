const { InviteError, prepareInvite, sendInvite } = require('./boleto-invite');
const { createHash, randomUUID } = require("node:crypto");
const { permitted } = require("./itau-statements");
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
    fields[`boleto.pagador.endereco.${key}`] = value;
  }
  if (
    !/^\d{8}$/.test(fields["boleto.pagador.endereco.cep"]) ||
    !"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
      .split(" ")
      .includes(fields["boleto.pagador.endereco.uf"])
  )
    throw new BoletoError("CEP ou UF inválido.");
  fields["boleto.pagador.endereco.cep"] = fields["boleto.pagador.endereco.cep"].replace(/^(\d{5})(\d{3})$/, "$1-$2");
  return fields;
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
    registration: record.registration || null,
    updatedAt: record.updatedAt,
    error: record.error || "",
    canRecover:
      ["unknown", "issuing"].includes(record.state) &&
      Date.now() - record.attemptAt > 60000,
  };
}
function createBoletoHandler({
  getServices,
  readBody,
  sendJson,
  env = process.env,
  fetchImpl = fetch,
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
      const match = url.pathname.match(
        /^\/api\/boleto-cloud\/items\/([^/]+)(?:\/(preview|issue|recover|pdf|registration|invite|invite-email))?$/,
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
        reply(existing);
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
      if (action === "preview") {
        const record = await db.runTransaction(async (tx) => {
          if (!allowed((await tx.get(userRef)).data()))
            throw new BoletoError("Acesso revogado.", 403);
          const old = (await tx.get(ref)).data();
          if (old && !["draft", "rejected"].includes(old.state)) return old;
          const row = (await tx.get(source)).data();
          if (!row) throw new BoletoError("Cobrança não encontrada.", 404);
          const fields = payload(row, body.address);
          const record = {
            transactionId: id,
            environment: cfg.environment,
            accountFingerprint: cfg.accountFingerprint,
            fields,
            sourceHash: hash(row),
            state: "draft",
            updatedAt: new Date().toISOString(),
            previewHash: hash([fields, hash(row), cfg.accountFingerprint]),
            control: `sp-${hash([cfg.environment, id]).slice(0, 40)}`,
          };
          tx.set(ref, record);
          audit(tx, "preview");
          return record;
        });
        reply(record);
        return true;
      }
      if (!cfg.enabled || !cfg.apiKey || !cfg.accountToken)
        throw new BoletoError(
          "Emissão não habilitada ou credenciais ainda não configuradas.",
          503,
        );
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
        };
        tx.set(ref, next);
        audit(tx, action, { attempt, legacyChecked: action === "issue" });
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
        audit(tx, "result", { attempt, state: outcome.state });
        return next;
      });
      reply(final);
    } catch (error) {
      sendJson(
        request,
        response,
        (error instanceof BoletoError || error instanceof InviteError) ? error.status : 500,
        {
          error:
            (error instanceof BoletoError || error instanceof InviteError)
              ? error.message
              : "Operação não confirmada. Consulte a cobrança antes de tentar novamente.",
        },
      );
    }
    return true;
  };
}
module.exports = {
  createBoletoHandler,
  payload,
  eligible,
  amount,
  money,
  validDocument,
  config,
  publicRecord,
};
