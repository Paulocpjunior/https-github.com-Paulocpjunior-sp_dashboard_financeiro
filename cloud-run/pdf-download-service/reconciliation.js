const { createHash } = require("node:crypto");
const { ACCOUNT, StatementError } = require("./itau-ofx");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function amount(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value)
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return 0;
  return Number(text);
}
function source(transaction, id) {
  if (transaction.isExcluded) return null;
  const direction =
    transaction.movement === "Entrada"
      ? 1
      : transaction.movement === "Saída"
        ? -1
        : 0;
  if (!direction) return null;
  if (direction === 1 && /pagar|sa[ií]da/i.test(transaction.type || ""))
    return null;
  if (direction === -1 && /receber|entrada/i.test(transaction.type || ""))
    return null;
  const paid = [
    "pago",
    "paga",
    "recebido",
    "quitado",
    "liquidado",
    "sim",
    "ok",
    "s",
  ].includes(String(transaction.status || "").toLowerCase());
  const fields =
    direction === 1
      ? [
          transaction.totalCobranca,
          transaction.valorOriginal,
          amount(transaction.honorarios) + amount(transaction.valorExtra),
          transaction.valueReceived,
        ]
      : [transaction.valuePaid, transaction.valorOriginal];
  const original = fields.map(amount).find((n) => n > 0) || 0;
  const effective = paid
    ? amount(
        direction === 1 ? transaction.valueReceived : transaction.valuePaid,
      ) || original
    : original;
  const cents = Math.round(effective * 100) * direction;
  const date =
    paid && transaction.paymentDate
      ? transaction.paymentDate
      : transaction.dueDate;
  if (
    !Number.isSafeInteger(cents) ||
    !cents ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date || "")
  )
    return null;
  const record = {
    id,
    client: String(transaction.client || ""),
    date,
    amountCents: cents,
    status: String(transaction.status || ""),
    bankAccount: String(transaction.bankAccount || ""),
    cpfCnpj: String(transaction.cpfCnpj || ""),
  };
  return { ...record, fingerprint: hash(record) };
}
const bankFingerprint = (row) =>
  hash([
    row.id,
    row.date,
    row.amountCents,
    row.fingerprint || "",
    row.fitid,
    row.name,
    row.memo,
  ]);
function suggest(row, candidates) {
  return candidates
    .filter(
      (t) =>
        Math.sign(t.amountCents) === Math.sign(row.amountCents) &&
        Math.abs(Date.parse(t.date) - Date.parse(row.date)) <= 3 * 86400000,
    )
    .filter(
      (t) =>
        t.amountCents === row.amountCents ||
        (t.cpfCnpj.replace(/\D/g, "").length >= 11 &&
          `${row.name} ${row.memo}`
            .replace(/\D/g, "")
            .includes(t.cpfCnpj.replace(/\D/g, ""))),
    )
    .map((t) => ({ ...t, differenceCents: row.amountCents - t.amountCents }));
}
async function handleReconciliation({
  request,
  url,
  db,
  userId,
  readBody,
  allowed,
  actor,
}) {
  const account = db.collection("bankStatements").doc(ACCOUNT);
  const links = account.collection("reconciliations");
  const history = account.collection("reconciliationHistory");
  const locks = db.collection("bankReconciliationLocks");
  const audit = db.collection("bankStatementAudit");
  if (request.method === "GET") {
    const start = url.searchParams.get("start"),
      end = url.searchParams.get("end");
    // interval validation is also performed by the handler before this function.
    const snapshots = await Promise.all([
      account
        .collection("entries")
        .where("date", ">=", start)
        .where("date", "<=", end)
        .orderBy("date")
        .limit(1001)
        .get(),
      db
        .collection("transactions")
        .where("dueDate", ">=", start)
        .where("dueDate", "<=", end)
        .limit(2501)
        .get(),
      db
        .collection("transactions")
        .where("paymentDate", ">=", start)
        .where("paymentDate", "<=", end)
        .limit(2501)
        .get(),
      links
        .where("date", ">=", start)
        .where("date", "<=", end)
        .limit(1001)
        .get(),
      history
        .where("date", ">=", start)
        .where("date", "<=", end)
        .limit(2001)
        .get(),
    ]);
    if (
      snapshots[0].size > 1000 ||
      snapshots[1].size > 2500 ||
      snapshots[2].size > 2500 ||
      snapshots[3].size > 1000 ||
      snapshots[4].size > 2000
    )
      throw new StatementError(
        "Período com muitos registros. Reduza as datas; nenhum resultado parcial foi exibido.",
      );
    const transactions = new Map();
    [...snapshots[1].docs, ...snapshots[2].docs].forEach((d) => {
      const t = source(d.data(), d.id);
      if (t) transactions.set(d.id, t);
    });
    const activeLinks = snapshots[3].docs
      .map((d) => d.data())
      .filter((r) => r.active);
    // A linked source may have moved outside the selected date range.
    const missing = activeLinks.filter(
      (l) => !transactions.has(l.transactionId),
    );
    if (missing.length)
      (
        await db.getAll(
          ...missing.map((l) =>
            db.collection("transactions").doc(l.transactionId),
          ),
        )
      ).forEach((d) => {
        if (d.exists) {
          const t = source(d.data(), d.id);
          if (t) transactions.set(d.id, t);
        }
      });
    const lockSnapshots = transactions.size
      ? await db.getAll(
          ...[...transactions.keys()].map((id) => locks.doc(hash(id))),
        )
      : [];
    const used = new Set(
      lockSnapshots.filter((d) => d.exists).map((d) => d.data().transactionId),
    );
    const available = [...transactions.values()].filter((t) => !used.has(t.id));
    const result = snapshots[0].docs.map((d) => {
      const row = { ...d.data(), id: d.id };
      const link = activeLinks.find((l) => l.entryId === row.id);
      const stale =
        !!link &&
        (link.bankFingerprint !== bankFingerprint(row) ||
          link.sourceFingerprint !==
            transactions.get(link.transactionId)?.fingerprint);
      return {
        ...row,
        bankFingerprint: bankFingerprint(row),
        link: link || null,
        stale,
        candidates: link ? [] : suggest(row, available),
      };
    });
    if (!allowed((await db.collection("users").doc(userId).get()).data()))
      throw new StatementError("Acesso revogado.", 403);
    await audit.add({
      ...actor,
      action: "reconciliation-read",
      start,
      end,
      count: result.length,
    });
    return {
      rows: result,
      sourceCount: transactions.size,
      history: snapshots[4].docs
        .map((d) => d.data())
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  }
  let body;
  try {
    body = JSON.parse((await readBody(request)).toString("utf8"));
  } catch {
    throw new StatementError("Solicitação inválida.");
  }
  if (
    !/^[a-f0-9]{64}$/.test(body.entryId || "") ||
    !["confirm", "undo"].includes(body.action)
  )
    throw new StatementError("Conciliação inválida.");
  if (
    typeof body.reason !== "string" ||
    body.reason.trim().length < 5 ||
    body.reason.length > 500
  )
    throw new StatementError(
      "Informe uma justificativa de 5 a 500 caracteres.",
    );
  return db.runTransaction(async (tx) => {
    const profile = await tx.get(db.collection("users").doc(userId));
    if (!allowed(profile.data()))
      throw new StatementError("Acesso revogado.", 403);
    const entryRef = account.collection("entries").doc(body.entryId),
      linkRef = links.doc(body.entryId);
    const entry = await tx.get(entryRef),
      previous = await tx.get(linkRef);
    if (!entry.exists)
      throw new StatementError("Movimentação não encontrada.", 404);
    const row = { ...entry.data(), id: body.entryId };
    const old = previous.exists ? previous.data() : null;
    if (body.action === "undo") {
      if (!old?.active)
        throw new StatementError(
          "Conciliação já desfeita ou inexistente.",
          409,
        );
      const lockRef = locks.doc(hash(old.transactionId));
      const lock = await tx.get(lockRef);
      if (!lock.exists || lock.data().entryId !== body.entryId)
        throw new StatementError("Vínculo inconsistente. Requer revisão.", 409);
      tx.create(history.doc(), {
        ...actor,
        date: row.date,
        action: "undo",
        entryId: body.entryId,
        transactionId: old.transactionId,
        reason: body.reason.trim(),
      });
      tx.update(linkRef, {
        active: false,
        undoneAt: actor.at,
        undoneBy: userId,
      });
      tx.delete(lockRef);
      tx.create(audit.doc(), {
        ...actor,
        action: "reconciliation-undo",
        entryId: body.entryId,
        transactionId: old.transactionId,
        reason: body.reason.trim(),
      });
      return { ok: true };
    }
    if (
      typeof body.transactionId !== "string" ||
      !body.transactionId ||
      body.transactionId.includes("/") ||
      body.transactionId.length > 200
    )
      throw new StatementError("Lançamento inválido.");
    const transaction = await tx.get(
      db.collection("transactions").doc(body.transactionId),
    );
    const candidate = transaction.exists
      ? source(transaction.data(), body.transactionId)
      : null;
    const lockRef = locks.doc(hash(body.transactionId)),
      lock = await tx.get(lockRef);
    if (old?.active || lock.exists)
      throw new StatementError(
        "Movimentação ou lançamento já conciliado. Atualize a consulta.",
        409,
      );
    if (
      !candidate ||
      candidate.fingerprint !== body.sourceFingerprint ||
      bankFingerprint(row) !== body.bankFingerprint
    )
      throw new StatementError(
        "Dados alterados desde a consulta. Atualize antes de confirmar.",
        409,
      );
    if (row.amountCents !== candidate.amountCents)
      throw new StatementError(
        "Valores ou naturezas divergentes. Resolva a diferença antes de conciliar.",
        409,
      );
    const record = {
      entryId: body.entryId,
      transactionId: body.transactionId,
      date: row.date,
      amountCents: row.amountCents,
      client: candidate.client,
      sourceFingerprint: candidate.fingerprint,
      bankFingerprint: bankFingerprint(row),
      active: true,
      confirmedAt: actor.at,
      confirmedBy: userId,
      reason: body.reason.trim(),
    };
    tx.create(history.doc(), {
      ...actor,
      date: row.date,
      action: "confirm",
      entryId: body.entryId,
      transactionId: body.transactionId,
      reason: body.reason.trim(),
    });
    tx.set(linkRef, record);
    tx.create(lockRef, {
      entryId: body.entryId,
      transactionId: body.transactionId,
      accountId: ACCOUNT,
    });
    tx.create(audit.doc(), {
      ...actor,
      action: "reconciliation-confirm",
      ...record,
    });
    return { ok: true };
  });
}
module.exports = { source, suggest, bankFingerprint, handleReconciliation };
