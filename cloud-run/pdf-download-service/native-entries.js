const { createHash } = require("node:crypto");
const { validDocument } = require("./boleto-cloud");
const catalog = require("./native-entry-catalog.json");
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
class EntryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const allowed = (p) =>
  p?.active === true &&
  p.role === "admin" &&
  !["blocked", "deleted"].includes(p.status);
const dateValid = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
function text(v, label, required = false, max = 500) {
  if (v != null && typeof v !== "string")
    throw new EntryError(`${label}: texto inválido.`);
  const s = (v || "").trim();
  if (
    (required && !s) ||
    s.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)
  )
    throw new EntryError(`${label}: confira o preenchimento.`);
  return s;
}
function cents(v, label) {
  const s = String(v ?? "0");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s))
    throw new EntryError(
      `${label}: use um valor positivo com até duas casas decimais.`,
    );
  return Math.round(Number(s) * 100);
}
function choice(v, key, required = true) {
  const s = text(v, key, required);
  if (s && !catalog[key].includes(s))
    throw new EntryError(`Seleção inválida: ${key}.`);
  return s;
}
function files(input = []) {
  if (!Array.isArray(input) || input.length > 4)
    throw new EntryError("Anexe no máximo quatro arquivos.");
  let size = 0;
  return input.map((a) => {
    const name = text(a.name, "Nome do arquivo", true, 160);
    const type = text(a.type, "Tipo de arquivo", true, 80);
    const kind = text(a.kind, "Finalidade do anexo", true);
    if (!["fatura", "comprovante", "assinatura"].includes(kind))
      throw new EntryError("Finalidade de anexo inválida.");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(type))
      throw new EntryError("No piloto, anexe PDF, PNG ou JPEG.");
    if (
      typeof a.base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        a.base64,
      )
    )
      throw new EntryError("Arquivo inválido.");
    const bytes = Buffer.from(a.base64, "base64");
    size += bytes.length;
    if (!bytes.length || size > 2 * 1024 * 1024)
      throw new EntryError("Limite total de anexos: 2 MB.");
    const magic =
      type === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : type === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!magic)
      throw new EntryError("O conteúdo não corresponde ao tipo do arquivo.");
    return {
      name,
      type,
      kind,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes,
    };
  });
}
function buildEntry(input, client, actor, now = new Date().toISOString()) {
  if (!input || !["receber", "pagar"].includes(input.kind))
    throw new EntryError("Selecione pagar ou receber.");
  const receivable = input.kind === "receber";
  if (typeof input.paid !== "boolean")
    throw new EntryError("Informe se o documento está pago.");
  if (input.recurring)
    throw new EntryError(
      "Recorrência ainda não liberada no piloto. Use o fluxo atual para esse caso.",
    );
  for (const k of ["date", "dueDate"])
    if (!dateValid(input[k]))
      throw new EntryError("Confira as datas de lançamento e vencimento.");
  if (input.paid && !dateValid(input.paymentDate))
    throw new EntryError("Informe a data efetiva de pagamento.");
  if (!input.paid && input.paymentDate)
    throw new EntryError("Documento pendente não deve ter data de pagamento.");
  const honor = receivable ? cents(input.honorarios, "Honorários") : 0;
  const extra = receivable ? cents(input.extras, "Extras") : 0;
  const rate = receivable ? choice(input.interestRate, "interestRates") : "0";
  const original = receivable
    ? honor + extra
    : cents(input.amount, "Valor original");
  if (original <= 0 || original >= 10000000000)
    throw new EntryError("Informe um valor maior que zero.");
  // Juros e recebimentos parciais exigem homologação dos consumidores legados.
  if (Number(rate) !== 0)
    throw new EntryError(
      "No piloto, use juros zero. Cobranças com juros permanecem no fluxo atual.",
    );
  const paid = cents(input.paidAmount, "Valor efetivamente pago");
  if ((!input.paid && paid !== 0) || (input.paid && paid !== original))
    throw new EntryError(
      "No piloto, registre pendente ou integralmente pago pelo valor original. Pagamento parcial permanece no fluxo atual.",
    );
  const bankAccount = choice(input.bankAccount, "banks");
  const description = text(
    input.description,
    "Descrição da cobrança",
    receivable,
    500,
  );
  let identity, name, method;
  if (receivable) {
    if (
      !client ||
      client.status !== "ready" ||
      !validDocument(client.cpfCnpjDigits) ||
      !client.client ||
      !client.clientNumber
    )
      throw new EntryError(
        "Selecione um cliente com cadastro conferido, CPF/CNPJ e N.Cliente.",
      );
    identity = client.cpfCnpjDigits.replace(/\D/g, "");
    name = client.client;
    method = choice(input.deliveryMethod, "deliveryMethods");
  } else {
    identity = choice(input.category, "categories");
    name = identity;
    method = choice(input.paymentMethod, "paymentMethods");
  }
  const address = Object.fromEntries(
    [
      "cep",
      "uf",
      "localidade",
      "bairro",
      "logradouro",
      "numero",
      "complemento",
    ].map((k) => [k, text(input.address?.[k], k, false, 120)]),
  );
  const email = text(input.email, "E-mail", false, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new EntryError("Confira o e-mail.");
  const note = text(input.observation, "Observação", false, 4000);
  const result = {
    schemaVersion: 1,
    source: "native-finance",
    movement: receivable ? "Entrada" : "Saída",
    type: receivable
      ? "Entrada de Caixa / Contas a Receber"
      : "Saída de Caixa / Contas a Pagar",
    client: name,
    description: receivable ? description : name,
    bankAccount,
    date: input.date,
    dueDate: input.dueDate,
    paymentDate: input.paid ? input.paymentDate : "",
    dataPagamento: input.paid
      ? input.paymentDate.split("-").reverse().join("/")
      : "",
    status: input.paid ? "Pago" : "Pendente",
    pago: input.paid ? "Pago" : "Não",
    valorOriginal: original / 100,
    valuePaid: receivable ? 0 : original / 100,
    valueReceived: receivable && input.paid ? paid / 100 : 0,
    valorPago: input.paid ? (paid / 100).toFixed(2) : "",
    metodoPagamento: method,
    paidBy: receivable ? actor.name : choice(input.paidBy, "paidBy"),
    createdBy: actor.uid,
    createdByName: actor.name,
    createdAt: now,
    updatedAt: now,
    nativeEntry: {
      version: 1,
      kind: input.kind,
      authorizedBy: receivable
        ? ""
        : choice(input.authorizedBy, "authorizedBy"),
      supplier: receivable
        ? ""
        : text(input.supplier, "Fornecedor", false, 300),
      personType: receivable
        ? identity.length === 11
          ? "PF"
          : "PJ"
        : text(input.personType, "Pessoa física/jurídica", true),
      receiptMethod: receivable
        ? choice(input.receiptMethod, "receiptMethods", false)
        : "",
      interestRate: Number(rate),
      interestAmount: 0,
      email,
      address,
      phone: text(input.phone, "Telefone", false, 40),
      recurring: false,
      clientRegistryId: receivable ? input.clientRegistryId : "",
    },
  };
  if (!["PF", "PJ"].includes(result.nativeEntry.personType))
    throw new EntryError("Selecione PF ou PJ.");
  if (receivable)
    Object.assign(result, {
      cpfCnpj: identity,
      clientNumber: String(client.clientNumber),
      nCliente: String(client.clientNumber),
      honorarios: honor / 100,
      valorExtra: extra / 100,
      extras: extra / 100,
      totalCobranca: original / 100,
      cobrancaExtra: choice(input.extraDescription, "extras", false),
      observacao: note,
      numeroDocumento: description.slice(0, 20),
    });
  else result.observacaoAPagar = note;
  return {
    record: result,
    duplicateKey: hash([input.kind, identity, input.dueDate, original]),
  };
}
function createNativeEntryHandler({
  getServices,
  readBody,
  sendJson,
  env = process.env,
  getBucket,
}) {
  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith("/api/financial-entries/")) return false;
    try {
      const bearer = String(request.headers.authorization || "").match(
        /^Bearer (\S+)$/,
      );
      if (!bearer) throw new EntryError("Entre novamente.", 401);
      const { adminDb: db, adminAuth } = getServices();
      let uid;
      try {
        uid = (await adminAuth.verifyIdToken(bearer[1], true)).uid;
      } catch {
        throw new EntryError("Sessão expirada.", 401);
      }
      const userRef = db.collection("users").doc(uid);
      const user = (await userRef.get()).data();
      if (!allowed(user))
        throw new EntryError(
          "Piloto disponível somente para administradores ativos.",
          403,
        );
      const enabled = env.NATIVE_ENTRY_ENABLED === "true";
      const reply = (body, status = 200) =>
        sendJson(request, response, status, body);
      if (
        request.method === "GET" &&
        url.pathname === "/api/financial-entries/config"
      ) {
        const registry = await db
          .collection("clientRegistry")
          .where("status", "==", "ready")
          .limit(5001)
          .get();
        if (registry.docs.length > 5000)
          throw new EntryError(
            "Cadastro excede o limite de consulta do piloto.",
            409,
          );
        if (!allowed((await userRef.get()).data()))
          throw new EntryError("Acesso revogado.", 403);
        reply({
          enabled,
          attachmentsEnabled: Boolean(env.NATIVE_ENTRY_ATTACHMENT_BUCKET),
          catalog,
          clients: registry.docs.map((d) => {
            const c = d.data();
            return {
              id: d.id,
              client: c.client || "",
              clientNumber: String(c.clientNumber || ""),
              cpfCnpj: c.cpfCnpjDigits || "",
            };
          }),
        });
        return true;
      }
      const attachmentMatch = url.pathname.match(
        /^\/api\/financial-entries\/attachments\/(native-[a-f0-9]{64})\/([a-f0-9]{64})$/,
      );
      if (request.method === "GET" && attachmentMatch) {
        const entry = (
          await db.collection("transactions").doc(attachmentMatch[1]).get()
        ).data();
        const attachment = entry?.attachments?.find(
          (a) => a.sha256 === attachmentMatch[2],
        );
        if (!attachment || !env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
          throw new EntryError("Anexo não encontrado.", 404);
        const path = `native-finance/${attachmentMatch[1]}/${attachmentMatch[2]}`;
        const [bytes] = await getBucket(env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
          .file(path)
          .download();
        if (!allowed((await userRef.get()).data()))
          throw new EntryError("Acesso revogado.", 403);
        reply({
          name: attachment.name,
          type: attachment.type,
          base64: bytes.toString("base64"),
        });
        return true;
      }
      const statusMatch = url.pathname.match(
        /^\/api\/financial-entries\/requests\/([a-f0-9-]{36})$/,
      );
      if (request.method === "GET" && statusMatch) {
        const id = "native-" + hash([uid, statusMatch[1]]);
        const saved = (
          await db.collection("transactions").doc(id).get()
        ).data();
        reply(
          saved
            ? { state: "saved", transaction: { ...saved, id } }
            : { state: "not_confirmed", id },
        );
        return true;
      }
      if (
        ![
          "/api/financial-entries/preview",
          "/api/financial-entries/commit",
        ].includes(url.pathname) ||
        request.method !== "POST"
      )
        throw new EntryError("Rota não encontrada.", 404);
      if (!enabled)
        throw new EntryError(
          "Lançamentos nativos ainda não ativados neste ambiente.",
          503,
        );
      let body;
      try {
        body = JSON.parse((await readBody(request)).toString("utf8"));
      } catch {
        throw new EntryError("Dados inválidos ou acima do limite.");
      }
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          body.requestId || "",
        )
      )
        throw new EntryError("Identificador da tentativa inválido.");
      const input = body.entry;
      const upload = files(body.attachments);
      if (upload.length && !env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
        throw new EntryError(
          "Armazenamento de anexos ainda não configurado.",
          503,
        );
      let clientRef = null,
        client = null;
      if (input?.kind === "receber") {
        const id = text(input.clientRegistryId, "Cliente", true, 200);
        if (id.includes("/")) throw new EntryError("Cliente inválido.");
        clientRef = db.collection("clientRegistry").doc(id);
        client = (await clientRef.get()).data();
      }
      const actor = { uid, name: user.name || uid };
      // Fixed timestamp for the review hash; real timestamps are assigned on commit.
      const built = buildEntry(input, client, actor, "");
      const metadata = upload.map(({ bytes, ...meta }) => meta);
      const previewHash = hash([built.record, metadata]);
      const id = "native-" + hash([uid, body.requestId]);
      const ref = db.collection("transactions").doc(id);
      const requestRef = db.collection("nativeEntryRequests").doc(id);
      const lockRef = db.collection("nativeEntryLocks").doc(built.duplicateKey);
      if (!allowed((await userRef.get()).data()))
        throw new EntryError("Acesso revogado.", 403);
      if (url.pathname.endsWith("/preview")) {
        reply({
          previewHash,
          transaction: { ...built.record, id },
          attachments: metadata,
        });
        return true;
      }
      if (body.confirmHash !== previewHash)
        throw new EntryError(
          "Dados alterados. Revise novamente antes de salvar.",
          409,
        );
      // Reserve the request hash first. A lost response must never turn into a different entry.
      const existing = await db.runTransaction(async (tx) => {
        if (!allowed((await tx.get(userRef)).data()))
          throw new EntryError("Acesso revogado.", 403);
        const attempt = (await tx.get(requestRef)).data();
        const old = (await tx.get(ref)).data();
        if (attempt && attempt.hash !== previewHash)
          throw new EntryError(
            "Esta tentativa já pertence a outro conteúdo. Consulte o resultado antes de iniciar outra.",
            409,
          );
        if (!attempt)
          tx.create(requestRef, {
            hash: previewHash,
            uid,
            createdAt: new Date().toISOString(),
          });
        return old;
      });
      if (existing) {
        reply({ transaction: { ...existing, id }, replayed: true });
        return true;
      }
      const attachments = [];
      for (const file of upload) {
        const path = `native-finance/${id}/${file.sha256}`;
        try {
          await getBucket(env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
            .file(path)
            .save(file.bytes, {
              resumable: false,
              preconditionOpts: { ifGenerationMatch: 0 },
              metadata: {
                contentType: file.type,
                cacheControl: "private, no-store",
              },
            });
        } catch (e) {
          if (Number(e.code) !== 412)
            throw new EntryError(
              "Não foi possível armazenar o anexo. Reenvie a mesma tentativa.",
              503,
            );
        }
        const { bytes, ...meta } = file;
        attachments.push({ ...meta, path });
      }
      const saved = await db.runTransaction(async (tx) => {
        if (!allowed((await tx.get(userRef)).data()))
          throw new EntryError("Acesso revogado.", 403);
        const old = (await tx.get(ref)).data();
        if (old) return { record: old, replayed: true };
        if (
          clientRef &&
          hash((await tx.get(clientRef)).data()) !== hash(client)
        )
          throw new EntryError(
            "Cadastro alterado durante a revisão. Reabra o formulário.",
            409,
          );
        const lock = (await tx.get(lockRef)).data();
        if (lock)
          throw new EntryError(
            "Já existe um lançamento nativo com a mesma identificação, valor e vencimento. Consulte antes de repetir.",
            409,
          );
        const peers = await tx.get(
          db
            .collection("transactions")
            .where("dueDate", "==", input.dueDate)
            .limit(1001),
        );
        if (peers.docs.length > 1000)
          throw new EntryError(
            "Volume exige conferência manual de duplicidade.",
            409,
          );
        const duplicate = peers.docs.some((d) => {
          const r = d.data();
          const identity =
            input.kind === "receber"
              ? String(r.cpfCnpj || "").replace(/\D/g, "") ===
                built.record.cpfCnpj
              : r.description === built.record.description;
          const rawAmount = String(
            r.totalCobranca ||
              r.valorOriginal ||
              r.valuePaid ||
              r.valueReceived ||
              0,
          ).replace(/[^0-9.,-]/g, "");
          const amount = Number(
            rawAmount.includes(",")
              ? rawAmount.replace(/\./g, "").replace(",", ".")
              : rawAmount,
          );
          return (
            !r.isExcluded &&
            r.movement === built.record.movement &&
            identity &&
            Math.round(amount * 100) ===
              Math.round(built.record.valorOriginal * 100)
          );
        });
        if (duplicate)
          throw new EntryError(
            "Possível duplicidade no histórico: mesma identificação, valor e vencimento. Confira o lançamento existente.",
            409,
          );
        const now = new Date().toISOString();
        const record = {
          ...built.record,
          createdAt: now,
          updatedAt: now,
          attachments,
        };
        tx.create(ref, record);
        tx.create(lockRef, { transactionId: id, uid, createdAt: now });
        tx.create(db.collection("nativeEntryAudit").doc(id), {
          action: "create",
          transactionId: id,
          uid,
          at: now,
          hash: previewHash,
        });
        return { record, replayed: false };
      });
      reply(
        { transaction: { ...saved.record, id }, replayed: saved.replayed },
        saved.replayed ? 200 : 201,
      );
    } catch (e) {
      sendJson(request, response, e.status || 500, {
        error: e.status
          ? e.message
          : "Resultado não confirmado. Consulte a tentativa antes de repetir.",
      });
    }
    return true;
  };
}
module.exports = {
  createNativeEntryHandler,
  buildEntry,
  files,
  allowed,
  EntryError,
};
