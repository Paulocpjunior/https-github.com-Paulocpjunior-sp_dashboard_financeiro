const maintenance=require("./maintenance");
const { createHash } = require("node:crypto");
const { money } = require("./boleto-cloud");
const { gerarIcs } = require("./convites-vencimento.cjs");
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const norm = (x) =>
  String(x || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
function date(s) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s || "") ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    fail("Data inválida.", 400);
  return s;
}
function nominal(r) {
  return Math.round(money(r.valuePaid || r.valorOriginal) * 100);
}
function payable(r) {
  if (
    !r ||
    r.isExcluded ||
    norm(r.movement) !== "saida" ||
    r.wixEntityId ||
    r.wixInvoiceNumber ||
    norm(r.source) === "wix" ||
    nominal(r) <= 0
  )
    fail("Conta a pagar indisponível.");
  return r;
}
function pending(r) {
  payable(r);
  if (
    !["pendente", "agendado", "vencida", "vencido"].includes(norm(r.status)) ||
    ["sim", "pago", "true"].includes(norm(r.pago)) ||
    money(r.valorPago) > 0 ||
    r.paymentDate ||
    r.dataPagamento ||
    r.payableSettlement
  )
    fail(
      "Conta já paga ou com informação de pagamento. Confira antes de baixar.",
    );
  return r;
}
function emails(value) {
  if (!Array.isArray(value) || value.length > 20)
    fail("Informe até 20 destinatários.", 400);
  const result = [
    ...new Set(
      value.map((x) => String(x).trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (
    result.some(
      (x) =>
        x.length > 254 ||
        !/^([^\s<>(),;:@]+)@([^\s<>(),;:@]+)\.[^\s<>(),;:@]+$/.test(x),
    )
  )
    fail("E-mail inválido.", 400);
  return result;
}
function due(month, day) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  )
    fail("Competência ou dia inválido.", 400);
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, "0")}`;
}
function payment(r, input, catalog) {
  pending(r);
  date(input.date);
  if (input.date > today())
    fail("A baixa exige data efetiva, não futura.", 400);
  const value = String(input.amount || "");
  if (
    !/^\d{1,8}(\.\d{1,2})?$/.test(value) ||
    Math.round(Number(value) * 100) !== nominal(r)
  )
    fail(
      "Nesta etapa a baixa deve ser integral, pelo valor provisionado. Diferenças e parciais exigem conferência.",
      400,
    );
  if (
    !catalog.banks.includes(input.bankAccount) ||
    !catalog.paymentMethods.includes(input.method)
  )
    fail("Selecione conta bancária e forma de pagamento.", 400);
  if (typeof input.note !== "string" || input.note.length > 2000)
    fail("Observação inválida.", 400);
  return {
    status: "Pago",
    pago: "Pago",
    paymentDate: input.date,
    dataPagamento: input.date.split("-").reverse().join("/"),
    valorPago: (nominal(r) / 100).toFixed(2),
    bankAccount: input.bankAccount,
    metodoPagamento: input.method,
  };
}
function calendar(r, id, to, pdf) {
  pending(r);
  date(r.dueDate);
  if (r.dueDate < today())
    fail("Conta vencida: confira o vencimento antes de preparar o INVITE.");
  const label = String(r.nativeEntry?.supplier || r.description || r.client)
    .replace(/[\r\n]/g, " ")
    .slice(0, 200);
  const title = `Conta a pagar: ${label}`;
  let ics = gerarIcs([
    {
      titulo: title,
      vencimento: r.dueDate,
      identidade: id,
      descricao: `Valor provisionado: R$ ${(nominal(r) / 100).toFixed(2)}.\nConfira a fatura antes de pagar. Remova o evento após pagamento ou cancelamento; não há sincronização automática.`,
    },
  ]);
  if (pdf) {
    const line =
      "ATTACH;FMTTYPE=application/pdf;ENCODING=BASE64;VALUE=BINARY:" +
      pdf.bytes.toString("base64");
    ics = ics.replace(
      "TRANSP:TRANSPARENT",
      "CLASS:PRIVATE\r\n" +
        line.match(/.{1,74}/g).join("\r\n ") +
        "\r\nTRANSP:TRANSPARENT",
    );
  }
  const b64 = (x) =>
    Buffer.from(x)
      .toString("base64")
      .match(/.{1,76}/g)
      .join("\r\n");
  const boundary = "sp-pagar-" + hash(id).slice(0, 24);
  const part = (type, name, bytes) =>
    `--${boundary}\r\nContent-Type: ${type}\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(bytes)}\r\n`;
  const eml =
    `X-Unsent: 1\r\nMIME-Version: 1.0\r\n${to.length ? "To: " + to.join(", ") + "\r\n" : ""}Subject: =?UTF-8?B?${Buffer.from(title).toString("base64")}?=\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    part(
      "text/plain; charset=utf-8",
      "leia.txt",
      `Lembrete de conta a pagar em ${r.dueDate}. Importe o arquivo ICS na agenda. Se já pagou, desconsidere. Nenhum pagamento é executado por este convite.`,
    ) +
    part(
      "text/calendar; charset=utf-8; method=PUBLISH",
      "conta-a-pagar.ics",
      ics,
    ) +
    (pdf ? part("application/pdf", "fatura.pdf", pdf.bytes) : "") +
    `--${boundary}--\r\n`;
  return { ics, eml };
}
async function handlePayables(ctx) {
  const {
    request,
    url,
    db,
    userRef,
    uid,
    user,
    reply,
    readBody,
    enabled,
    allowed,
    files,
    catalog, catalogRef, catalogState,
    getBucket,
    env,
  } = ctx;
  if (!enabled) fail("Lançamentos nativos não ativados.", 503);
  const path = url.pathname.replace("/api/financial-entries/payables/", "");
  const recheck = async (tx) => {
    if (!allowed((await (tx ? tx.get(userRef) : userRef.get())).data()))
      fail("Acesso revogado.", 403);
    if(tx && catalogRef && ((await tx.get(catalogRef)).data()?.revision||0)!==catalogState.revision)fail("Parâmetros alterados. Reabra a conta e revise novamente.",409);
  };
  if (request.method === "GET" && path === "rules") {
    const result = await db.collection("payableRecurrences").limit(501).get();
    if (result.docs.length > 500)
      fail("Mais de 500 regras; refine a consulta.");
    await recheck();
    reply({ rules: result.docs.map((d) => ({ id: d.id, ...d.data() })) });
    return;
  }
  const item = path.match(/^items\/([^/]+)$/);
  if (request.method === "GET" && item) {
    const id = decodeURIComponent(item[1]);
    if (id.includes("/")) fail("Identificador inválido.", 400);
    const r = payable(
      (await db.collection("transactions").doc(id).get()).data(),
    );
    const settings = (
      await db.collection("payableInviteSettings").doc(id).get()
    ).data();
    await recheck();
    reply({
      transaction: { ...r, id },
      version: hash(r),
      recipients: settings?.recipients || [],
      catalog,
    });
    return;
  }
  if (request.method !== "POST") fail("Rota não encontrada.", 404);
  let b;
  try {
    b = JSON.parse((await readBody(request)).toString("utf8"));
  } catch {
    fail("Dados inválidos.", 400);
  }
  if (!/^[a-f0-9-]{36}$/.test(b.requestId || ""))
    fail("Tentativa inválida.", 400);
  const id = String(b.id || "");
  if (!id || id.length > 200 || id.includes("/"))
    fail("Identificador inválido.", 400);
  const ref = db.collection("transactions").doc(id),
    op = db.collection("payableOperations").doc(hash([uid, b.requestId]));
  const digest = hash([path, b]);
  const replay = (snap) => {
    if (!snap) return null;
    if (snap.digest !== digest)
      fail("Tentativa já utilizada com outros dados.");
    return snap.result;
  };
  if (path === "payment/preview" || path === "payment/commit") {
    const old = (await op.get()).data();
    const saved = replay(old);
    if (saved) {
      await recheck();
      reply({ ...saved, replayed: true });
      return;
    }
    const r = (await ref.get()).data();
    if (hash(r) !== b.version) fail("Conta alterada. Reabra a revisão.");
    const patch = payment(r, b.payment, catalog);
    const upload = files(b.attachments || []);
    if (upload.some((f) => f.kind !== "comprovante"))
      fail("Anexe somente comprovantes na baixa.", 400);
    const reviewHash = hash([
      b.id,
      b.version,
      b.payment,
      upload.map(({ bytes, ...m }) => m),
    ]);
    if (path.endsWith("preview")) {
      await recheck();
      reply({ reviewHash, before: { id, ...r }, after: { ...r, ...patch } });
      return;
    }
    if (b.confirmHash !== reviewHash)
      fail("Revise a baixa antes de confirmar.");
    if (upload.length && !env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
      fail("Armazenamento não configurado.", 503);
    const added = [];
    for (const f of upload) {
      const path = `native-finance/${id}/${f.sha256}`;
      await getBucket(env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
        .file(path)
        .save(f.bytes, {
          resumable: false,
          metadata: { contentType: f.type },
          preconditionOpts: { ifGenerationMatch: 0 },
        })
        .catch((e) => {
          if (Number(e.code) !== 412) throw e;
        });
      const { bytes, ...meta } = f;
      added.push({ ...meta, path });
    }
    const result = await db.runTransaction(async (tx) => {
      await recheck(tx);
      const prior = replay((await tx.get(op)).data());
      if (prior) return prior;
      const current = (await tx.get(ref)).data();
      if (hash(current) !== b.version) fail("Conta alterada durante a baixa.");
      payment(current, b.payment, catalog);
      const at = new Date().toISOString();
      const record = {
        ...current,
        ...patch,
        updatedAt: at,
        attachments: [
          ...(current.attachments || []),
          ...added.filter(
            (a) => !current.attachments?.some((x) => x.sha256 === a.sha256),
          ),
        ],
        payableSettlement: {
          uid,
          actor: user.name || uid,
          at,
          requestId: b.requestId,
          note: b.payment.note,
          origin: "manual",
        },
      };
      const result = { transaction: { ...record, id } };
      tx.set(ref, record);
      tx.create(db.collection("payableAudit").doc(hash([uid, b.requestId])), {
        action: "payment",
        transactionId: id,
        uid,
        at,
        before: current,
        after: record,
      });
      tx.create(op, { digest, result, at });
      return result;
    });
    reply(result);
    return;
  }
  if (path === "invite/settings" || path === "invite/download") {
    const r = pending((await ref.get()).data());
    if (hash(r) !== b.version) fail("Conta alterada. Reabra a tela.");
    const to = emails(b.recipients || []);
    if (path.endsWith("settings")) {
      await db.runTransaction(async (tx) => {
        await recheck(tx);
        const current = (await tx.get(ref)).data();
        if (hash(current) !== b.version) fail("Conta alterada.");
        pending(current);
        tx.set(db.collection("payableInviteSettings").doc(id), {
          recipients: to,
          updatedBy: uid,
          updatedAt: new Date().toISOString(),
        });
      });
      reply({ saved: true });
      return;
    }
    const upload = files(b.attachments || []);
    if (upload.length > 1 || upload.some((f) => f.type !== "application/pdf"))
      fail("Selecione um PDF da fatura para o INVITE.", 400);
    let pdf = upload[0];
    if (!pdf && b.attachmentHash) {
      const a = r.attachments?.find(
        (a) =>
          a.sha256 === b.attachmentHash &&
          a.type === "application/pdf" &&
          a.kind === "fatura",
      );
      if (!a || !env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
        fail("Fatura indisponível. Anexe o PDF manualmente.");
      const [bytes] = await getBucket(env.NATIVE_ENTRY_ATTACHMENT_BUCKET)
        .file(`native-finance/${id}/${a.sha256}`)
        .download();
      pdf = files([
        {
          name: a.name,
          type: a.type,
          kind: "fatura",
          base64: bytes.toString("base64"),
        },
      ])[0];
    }
    const artifact = calendar(r, id, to, pdf);
    await recheck();
    if (hash((await ref.get()).data()) !== b.version)
      fail("Conta alterada durante a preparação.");
    reply({
      name: `conta-a-pagar.${b.format === "eml" ? "eml" : "ics"}`,
      type: b.format === "eml" ? "message/rfc822" : "text/calendar",
      base64: Buffer.from(
        b.format === "eml" ? artifact.eml : artifact.ics,
      ).toString("base64"),
    });
    return;
  }
  if (path === "rules/save") {
    const recipients = emails(b.recipients || []);
    const start = String(b.start || ""),
      end = String(b.end || "");
    due(start, b.day);
    due(end, b.day);
    if (
      start > end ||
      !["fixed", "variable"].includes(b.mode) ||
      typeof b.active !== "boolean"
    )
      fail("Confira a vigência e o tipo da recorrência.", 400);
    const result = await db.runTransaction(async (tx) => {
      await recheck(tx);
      const replayed = replay((await tx.get(op)).data());
      if (replayed) return replayed;
      const r = payable((await tx.get(ref)).data());
      if (hash(r) !== b.version) fail("Conta alterada.");
      if (r.payableRecurrence) fail("Configure a regra pela conta de origem.");
      const ruleRef = db.collection("payableRecurrences").doc(id);
      const previous = (await tx.get(ruleRef)).data();
      if ((previous?.revision || 0) !== b.ruleRevision)
        fail("Regra alterada. Recarregue.");
      const at = new Date().toISOString();
      const rule = {
        sourceId: id,
        description: r.description || r.client,
        supplier: r.nativeEntry?.supplier || "",
        day: b.day,
        start,
        end,
        mode: b.mode,
        active: b.active,
        recipients,
        revision: (previous?.revision || 0) + 1,
        updatedAt: at,
        updatedBy: uid,
      };
      tx.set(ruleRef, rule);
      tx.create(db.collection("payableAudit").doc(hash([uid, b.requestId])), {
        action: "recurrence-config",
        uid,
        at,
        sourceId: id,
        before: previous || null,
        after: rule,
      });
      tx.create(op, { digest, result: rule, at });
      return rule;
    });
    reply({ rule: result });
    return;
  }
  if (path === "rules/preview" || path === "rules/generate") {
    const ruleRef = db.collection("payableRecurrences").doc(id);
    const result = await db.runTransaction(async (tx) => {
      await recheck(tx);
      const previous = replay((await tx.get(op)).data());
      if (previous) return previous;
      const rule = (await tx.get(ruleRef)).data();
      if (!rule?.active) fail("Recorrência inativa ou não encontrada.");
      const dueDate = due(b.month, rule.day);
      if (b.month < rule.start || b.month > rule.end)
        fail("Competência fora da vigência.");
      const source = payable((await tx.get(ref)).data());
      maintenance.assertActiveCategory(catalogState,source.description);
      if(!catalog.banks.includes(source.bankAccount))fail("Conta de origem sem conta bancária válida. Confira antes de provisionar.",400);
      if (String(source.dueDate).slice(0, 7) === b.month)
        fail("A conta de origem já representa esta competência.");
      const targetId = "native-" + hash(["payable-recurring", id, b.month]);
      const target = db.collection("transactions").doc(targetId);
      if ((await tx.get(target)).exists)
        fail("Competência já provisionada. Consulte o lançamento existente.");
      const value =
        rule.mode === "variable"
          ? String(b.amount || "")
          : String(nominal(source) / 100);
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(value) || Number(value) <= 0)
        fail("Informe o valor confirmado da fatura nesta competência.", 400);
      const amount = Number(value);
      const rows = await tx.get(
        db
          .collection("transactions")
          .where("dueDate", "==", dueDate)
          .limit(1001),
      );
      if (rows.docs.length > 1000) fail("Volume exige conferência manual.");
      if (
        rows.docs.some((d) => {
          const r = d.data();
          return (
            !r.isExcluded &&
            norm(r.movement) === "saida" &&
            maintenance.sameAccount(r.description,source.description) &&
            nominal(r) === Math.round(amount * 100)
          );
        })
      )
        fail(
          "Possível provisão já existente com mesma movimentação, valor e vencimento.",
        );
      const record = {
        source: "native-finance",
        schemaVersion: 1,
        movement: "Saída",
        type: "Saída de Caixa / Contas a Pagar",
        client: source.client || source.description,
        description: source.description || source.client || "Conta a pagar",
        bankAccount: source.bankAccount,
        date: today(),
        dueDate,
        status: "Pendente",
        pago: "Não",
        paymentDate: "",
        dataPagamento: "",
        valorPago: "",
        valorOriginal: amount,
        valuePaid: amount,
        valueReceived: 0,
        metodoPagamento: source.metodoPagamento || source.paymentMethod || "",
        observacaoAPagar: source.observacaoAPagar || "",
        paidBy: source.paidBy || "",
        attachments: [],
        payableRecurrence: { ruleId: id, month: b.month },
        ...(source.nativeEntry
          ? { nativeEntry: { ...source.nativeEntry, recurring: true } }
          : {}),
      };
      const reviewHash = hash([rule, source, record]);
      if (path.endsWith("preview"))
        return { reviewHash, transaction: { ...record, id: targetId } };
      if (b.confirmHash !== reviewHash)
        fail("Regra ou conta alterada. Revise novamente.");
      const at = new Date().toISOString();
      Object.assign(record, {
        createdAt: at,
        updatedAt: at,
        createdBy: uid,
        createdByName: user.name || uid,
      });
      const result = { transaction: { ...record, id: targetId } };
      tx.create(target, record);
      tx.set(db.collection("payableInviteSettings").doc(targetId), {
        recipients: rule.recipients,
        updatedAt: at,
        updatedBy: uid,
      });
      tx.create(db.collection("payableAudit").doc(hash([uid, b.requestId])), {
        action: "provision",
        uid,
        at,
        ruleId: id,
        month: b.month,
        transactionId: targetId,
      });
      tx.create(op, { digest, result, at });
      return result;
    });
    reply(result);
    return;
  }
  fail("Rota não encontrada.", 404);
}
module.exports = {
  handlePayables,
  payment,
  calendar,
  due,
  emails,
  pending,
  nominal,
};
