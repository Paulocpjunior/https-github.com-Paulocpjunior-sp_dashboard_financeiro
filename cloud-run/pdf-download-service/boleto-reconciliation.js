const { createHash, randomUUID } = require("node:crypto");
const { amount, money, config } = require("./boleto-cloud");
const catalog = require("./native-entry-catalog.json");
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const digits = (v) => String(v || "").replace(/\D/g, "");
const cents = (v) => Math.round(money(v) * 100);
const admin = (p) =>
  p?.active === true &&
  p.role === "admin" &&
  !["blocked", "deleted"].includes(p.status);
const fail = (message, status = 409) => {
  throw Object.assign(new Error(message), { status, reconciliation: true });
};
const identity = (r) => ({
  payerDocument: digits(r.payerDocument),
  amountCents: r.amountCents,
  dueDate: r.dueDate,
  number: r.number,
  createdAt: r.createdAt,
  beneficiaryDocument: r.beneficiaryDocument,
  bank: r.bank,
});
const revision = (r) => hash(r);
function differences(record, row) {
  const errors = [];
  if (
    !row ||
    row.movement !== "Entrada" ||
    row.isExcluded ||
    row.deletedAt ||
    row.wixEntityId ||
    row.wixInvoiceNumber ||
    row.source === "wix"
  )
    return ["Lançamento indisponível ou fora de Contas a Receber."];
  if (
    ![11, 14].includes(digits(record.payerDocument).length) ||
    digits(row.cpfCnpj) !== digits(record.payerDocument)
  )
    errors.push("CPF/CNPJ divergente ou ausente.");
  if (cents(amount(row)) !== record.amountCents || record.amountCents <= 0)
    errors.push("Valor nominal divergente.");
  if (row.dueDate !== record.dueDate) errors.push("Vencimento divergente.");
  if (record.bank !== "341" || row.bankAccount !== catalog.banks[0])
    errors.push("Conta bancária fora da conta Itaú homologada.");
  if (row.boletoSettlement || row.source === "native-finance")
    errors.push("Lançamento com vínculo nativo ou baixa bancária existente.");
  return errors;
}
function evaluate(record, row, body, at) {
  const errors = differences(record, row),
    b = body?.boleto;
  if (
    !b ||
    b.token !== record.token ||
    String(b.numero) !== String(record.number) ||
    b.emissao !== record.createdAt ||
    b.vencimento !== record.dueDate ||
    cents(b.valor) !== record.amountCents ||
    digits(b.pagador?.cprf) !== digits(record.payerDocument)
  )
    errors.push("Resposta da API diverge do boleto revisado.");
  if (errors.length) return { state: "review", reason: errors.join(" ") };
  const paid = row.status === "Pago";
  if (
    !paid &&
    (!["Pendente", "Agendado", "Vencida"].includes(row.status) ||
      !["Não", "", undefined].includes(row.pago) ||
      ["valueReceived", "valorPago", "valuePaid"].some(
        (k) => money(row[k]) !== 0,
      ) ||
      row.paymentDate ||
      row.dataPagamento)
  )
    return {
      state: "review",
      reason: "Pagamento parcial ou situação do lançamento exige revisão.",
    };
  if (b.situacao === "EM_ABERTO" && !b.pagamento && !paid)
    return {
      state: "waiting",
      reason: "Vincular e aguardar pagamento bancário integral.",
    };
  const p = b.pagamento;
  const validDate = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    b.situacao !== "PAGO" ||
    p?.origem !== "BANCO" ||
    p?.marcadoComoPago !== false ||
    p?.situacao !== "PAGAMENTO_INFORMADO"
  )
    return {
      state: "review",
      reason:
        "Sem confirmação de pagamento bancário; cancelamentos e marcações manuais exigem revisão.",
    };
  if (
    !validDate(p.data) ||
    p.data < record.createdAt ||
    p.data >
      new Date(at).toLocaleDateString("en-CA", {
        timeZone: "America/Sao_Paulo",
      }) ||
    (p.dataCredito != null &&
      (!validDate(p.dataCredito) || p.dataCredito < p.data)) ||
    typeof p.valor !== "number" ||
    cents(p.valor) !== record.amountCents ||
    ["multa", "juros", "desconto"].some((k) => p[k] != null && p[k] !== 0)
  )
    return {
      state: "review",
      reason: "Datas, valor pago, juros ou descontos exigem revisão.",
    };
  const payment = {
    date: p.data,
    cents: cents(p.valor),
    creditedAt: p.dataCredito || null,
  };
  if (paid) {
    if (
      cents(row.valueReceived) !== payment.cents ||
      row.paymentDate !== payment.date
    )
      return {
        state: "review",
        reason: "Conta já paga com valor ou data divergente do banco.",
      };
    return {
      state: "already-paid",
      reason:
        "Registrar somente o vínculo: conta já paga com valor e data conferidos.",
      payment,
    };
  }
  return {
    state: "ready",
    reason: "Vincular e registrar baixa integral confirmada pelo banco.",
    payment,
  };
}
async function queryProvider(record, env, fetchImpl) {
  const cfg = config(env);
  if (cfg.environment !== "production" || !cfg.apiKey)
    fail("Configuração de produção indisponível.", 503);
  const response = await fetchImpl(
    `${cfg.base}/boletos/${encodeURIComponent(record.token)}/situacao`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:token`).toString("base64")}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    fail("Consulta ao banco indisponível. Nenhuma baixa foi registrada.", 502);
  return response.json();
}
function publicRow(id, r, record) {
  return {
    id,
    name: String(r.client || r.description || ""),
    cpfCnpj: String(r.cpfCnpj || ""),
    dueDate: r.dueDate || "",
    amountCents: cents(amount(r)),
    bankAccount: r.bankAccount || "",
    status: r.status || "",
    reference: String(r.document || r.description || r.submissionId || id),
    differences: differences(record, r),
  };
}
async function handleReconciliation({
  req,
  res,
  db,
  uid,
  record,
  operation,
  sendJson,
  env,
  fetchImpl,
}) {
  const profile = db.collection("users").doc(uid),
    linkRef = db.collection("boletoReconciliations").doc(record.id);
  if (!admin((await profile.get()).data()))
    fail("Somente administradores podem conciliar boletos antigos.", 403);
  if (record.transactionId)
    fail("Boleto já possui vínculo de emissão. Utilize a consulta existente.");
  if (req.method === "GET" && operation === "reconcile") {
    const link = (await linkRef.get()).data();
    const docs = await db
      .collection("transactions")
      .where("dueDate", "==", record.dueDate)
      .limit(201)
      .get();
    const rows = docs.docs
      .slice(0, 200)
      .map((d) => publicRow(d.id, d.data(), record))
      .filter(
        (r) =>
          digits(r.cpfCnpj) === digits(record.payerDocument) ||
          r.amountCents === record.amountCents,
      );
    rows.sort(
      (a, b) =>
        a.differences.length - b.differences.length || a.id.localeCompare(b.id),
    );
    if (!admin((await profile.get()).data())) fail("Acesso revogado.", 403);
    sendJson(req, res, 200, {
      rows,
      truncated: docs.docs.length > 200,
      link: link
        ? {
            transactionId: link.transactionId,
            state: link.state,
            reason: link.reason,
            confirmedAt: link.confirmedAt,
            checkedAt: link.checkedAt,
          }
        : null,
    });
    return;
  }
  if (req.method !== "POST") fail("Método inválido.", 405);
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 4096) fail("Solicitação muito grande.", 413);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    fail("Solicitação inválida.", 400);
  }
  const at = new Date().toISOString();
  if (operation === "reconcile-preview") {
    if (
      typeof input.transactionId !== "string" ||
      !/^[-\w]{1,200}$/.test(input.transactionId)
    )
      fail("Identificador de lançamento inválido.", 400);
    const ref = db.collection("transactions").doc(input.transactionId),
      row = (await ref.get()).data();
    if (!row) fail("Lançamento não encontrado.", 404);
    if (
      (
        await db
          .collection("boletoIssues")
          .doc(hash(["production", input.transactionId]))
          .get()
      ).data()
    )
      fail(
        "Lançamento possui uma emissão ou tentativa nativa. Confira o vínculo existente.",
      );
    if (row.boletoReconciliation)
      fail("Este lançamento já está vinculado a um boleto.");
    if ((await linkRef.get()).data())
      fail("Este boleto já está vinculado. Recarregue os detalhes.");
    const body = await queryProvider(record, env, fetchImpl),
      decision = evaluate(record, row, body, at);
    if (
      decision.state === "ready" &&
      env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED !== "true"
    )
      fail("Baixa bancária desativada na configuração.", 503);
    const previewId = randomUUID();
    if (!admin((await profile.get()).data())) fail("Acesso revogado.", 403);
    await db
      .collection("boletoReconciliationPreviews")
      .doc(previewId)
      .set({
        uid,
        boletoId: record.id,
        transactionId: input.transactionId,
        revision: revision(row),
        identity: identity(record),
        decision,
        expiresAt: Date.now() + 10 * 60000,
      });
    sendJson(req, res, 200, {
      previewId,
      decision,
      row: publicRow(input.transactionId, row, record),
    });
    return;
  }
  if (
    operation !== "reconcile-confirm" ||
    typeof input.previewId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(input.previewId)
  )
    fail("Revisão inválida.", 400);
  const previewRef = db
      .collection("boletoReconciliationPreviews")
      .doc(input.previewId),
    preview = (await previewRef.get()).data();
  if (
    !preview ||
    preview.uid !== uid ||
    preview.boletoId !== record.id ||
    preview.expiresAt < Date.now()
  )
    fail("Revisão expirada. Confira os dados novamente.");
  if (preview.decision.state === "review")
    fail("Resolva as divergências antes de confirmar.");
  if (
    preview.decision.state === "ready" &&
    env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED !== "true"
  )
    fail("Baixa bancária desativada na configuração.", 503);
  const body = await queryProvider(record, env, fetchImpl);
  const outcome = await db.runTransaction(async (tx) => {
    const p = (await tx.get(profile)).data(),
      currentPreview = (await tx.get(previewRef)).data(),
      existing = (await tx.get(linkRef)).data();
    const rowRef = db.collection("transactions").doc(preview.transactionId),
      row = (await tx.get(rowRef)).data();
    const nativeIssue = (
      await tx.get(
        db
          .collection("boletoIssues")
          .doc(hash(["production", preview.transactionId])),
      )
    ).data();
    if (nativeIssue)
      fail("Emissão nativa encontrada para o lançamento. Revise o vínculo.");
    if (!admin(p)) fail("Acesso revogado.", 403);
    if (existing?.previewId === input.previewId && currentPreview?.usedAt)
      return { state: existing.state, reason: existing.reason };
    if (existing || row?.boletoReconciliation || currentPreview?.usedAt)
      fail("Vínculo já utilizado. Recarregue os detalhes.");
    if (
      !row ||
      revision(row) !== preview.revision ||
      currentPreview?.expiresAt < Date.now() ||
      hash(identity(record)) !== hash(preview.identity)
    )
      fail("Dados alterados após a revisão. Confira novamente.");
    const decision = evaluate(record, row, body, at);
    if (
      hash(decision) !== hash(preview.decision) ||
      decision.state === "review"
    )
      fail("Retorno bancário mudou após a revisão. Confira novamente.");
    const link = {
      record,
      accountFingerprint: config(env).accountFingerprint,
      transactionId: preview.transactionId,
      uid,
      confirmedAt: at,
      checkedAt: at,
      previewId: input.previewId,
      state: decision.state,
      reason: decision.reason,
      baseline: revision(row),
    };
    await apply(tx, db, rowRef, row, linkRef, link, decision, at, body);
    tx.update(previewRef, { usedAt: at });
    tx.create(db.collection("boletoReconciliationAudit").doc(input.previewId), {
      action: "confirm-link",
      uid,
      boletoId: record.id,
      transactionId: preview.transactionId,
      at,
      decision,
      original: row,
    });
    return decision;
  });
  sendJson(req, res, 200, { ok: true, ...outcome });
}
async function apply(tx, db, rowRef, row, linkRef, link, decision, at, body) {
  const historyRef = db.collection("boletoHistoryUpdates").doc(link.record.id);
  const previous = (await tx.get(historyRef)).data();
  if (previous?.syncedAt > at)
    fail("Uma consulta mais recente foi registrada. Revise novamente.");
  const next = require("./boleto-history").mergeSituation(
    link.record,
    body,
    at,
  );
  const marker = {
    boletoId: link.record.id,
    confirmedBy: link.uid,
    confirmedAt: link.confirmedAt,
  };
  let update = { boletoReconciliation: marker };
  if (decision.state === "ready") {
    const payment = decision.payment;
    update = {
      ...update,
      status: "Pago",
      pago: "Pago",
      paymentDate: payment.date,
      dataPagamento: payment.date.split("-").reverse().join("/"),
      valueReceived: payment.cents / 100,
      valorPago: (payment.cents / 100).toFixed(2),
      updatedAt: at,
      boletoSettlement: {
        boletoId: link.record.id,
        evidenceId: link.record.id,
        origin: "BANCO",
        paymentDate: payment.date,
        paidCents: payment.cents,
        creditedAt: payment.creditedAt,
        appliedAt: at,
        kind: "confirmed-historical-link",
      },
    };
    tx.create(
      db.collection("boletoReconciliationSettlements").doc(link.record.id),
      {
        transactionId: link.transactionId,
        boletoId: link.record.id,
        at,
        before: row,
        after: update,
      },
    );
  }
  tx.set(historyRef, {
    record: next,
    syncedAt: at,
    source: "confirmed-historical-link",
  });
  tx.update(rowRef, update);
  tx.set(linkRef, {
    ...link,
    state: decision.state === "ready" ? "settled" : decision.state,
    reason:
      decision.state === "ready"
        ? "Baixa integral registrada com confirmação bancária."
        : decision.reason,
    checkedAt: at,
    baseline: revision({ ...row, ...update }),
  });
}
// Explicitly confirmed historical links are a separate queue from native issuance.
async function runReconciliations({
  db,
  env = process.env,
  fetchImpl = fetch,
  deadline = Date.now() + 120000,
  dryRun = false,
}) {
  if (
    env.BOLETO_CLOUD_RETURN_ENABLED !== "true" ||
    env.BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED !== "true" ||
    dryRun
  )
    return { disabled: true };
  const jobRef = db
      .collection("boletoReturnJobs")
      .doc("reconciliations-production"),
    lease = randomUUID();
  let prior = {};
  const claimed = await db.runTransaction(async (tx) => {
    prior = (await tx.get(jobRef)).data() || {};
    if (prior.leaseUntil > Date.now()) return false;
    tx.set(jobRef, {
      ...prior,
      lease,
      leaseUntil: Date.now() + 15 * 60000,
      state: "running",
      startedAt: new Date().toISOString(),
    });
    return true;
  });
  if (!claimed) return { busy: true };
  let query = db
    .collection("boletoReconciliations")
    .orderBy("__name__")
    .limit(20);
  if (prior.cursor) query = query.startAfter(prior.cursor);
  const docs = await query.get();
  let last = prior.cursor || "",
    processed = 0;
  const counts = { scanned: 0, settled: 0, review: 0, errors: 0 };
  for (const doc of docs.docs) {
    if (Date.now() + 22000 >= deadline) break;
    const link = doc.data();
    last = doc.id;
    processed++;
    if (link.state !== "waiting") continue;
    counts.scanned++;
    const at = new Date().toISOString();
    try {
      const body = await queryProvider(link.record, env, fetchImpl);
      await db.runTransaction(async (tx) => {
        const owner = (await tx.get(jobRef)).data();
        if (owner?.lease !== lease || owner.leaseUntil <= Date.now())
          throw Error("LEASE_LOST");
        const linkRef = db.collection("boletoReconciliations").doc(doc.id),
          current = (await tx.get(linkRef)).data();
        const rowRef = db.collection("transactions").doc(link.transactionId),
          row = (await tx.get(rowRef)).data();
        if (!current || current.state !== "waiting" || current.checkedAt > at)
          return;
        const result =
          !row ||
          revision(row) !== current.baseline ||
          current.accountFingerprint !== config(env).accountFingerprint
            ? {
                state: "review",
                reason:
                  "Lançamento alterado após o vínculo. Conferência necessária.",
              }
            : evaluate(current.record, row, body, at);
        if (result.state === "ready") {
          await apply(tx, db, rowRef, row, linkRef, current, result, at, body);
          counts.settled++;
        } else {
          tx.update(linkRef, {
            state: result.state,
            reason: result.reason,
            checkedAt: at,
          });
          if (result.state === "review") counts.review++;
        }
      });
    } catch {
      counts.errors++;
    }
  }
  await db.runTransaction(async (tx) => {
    const owner = (await tx.get(jobRef)).data();
    if (owner?.lease !== lease || owner.leaseUntil <= Date.now())
      throw Error("LEASE_LOST");
    tx.update(jobRef, {
      leaseUntil: 0,
      cursor:
        processed === docs.docs.length && docs.docs.length < 20 ? "" : last,
      counts,
      finishedAt: new Date().toISOString(),
      state: counts.errors ? "error" : "complete",
    });
  });
  return counts;
}
module.exports = {
  handleReconciliation,
  runReconciliations,
  evaluate,
  differences,
  apply,
  admin,
  revision,
};
