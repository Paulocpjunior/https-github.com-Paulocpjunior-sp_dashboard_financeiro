// Trava de faturamento Wix: empresa com Fatura Wix em aberto (qualquer mês) ou
// emitida no mesmo mês de vencimento não recebe nova cobrança pelo app (Nova
// cobrança ou boleto). Só o master (Paulo) libera exceção, com motivo e log.
// As Faturas Wix chegam pelo wix-sync-service como transactions/wix-inv-*
// (source "wix", sem CPF/CNPJ). Pedidos do e-commerce (wix-{UUID}) não travam:
// são vendas pagas na loja, não faturas de serviço.
const { randomUUID } = require("node:crypto");

const LEGAL_SUFFIXES = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s", "a", "ss", "slu", "mei", "cia", "limitada",
]);
// Mesmo UID do master usado em utils/masterAccount.ts e firestore.rules.
const MASTER_USER_ID = "hpdsWehGGAYE3uKCar4pBiRVxFJ3";
const OPEN_STATUSES = ["Pendente", "Vencida", "pendente", "vencida", "PENDENTE", "VENCIDA", "Pending", "Overdue", "Sent", "Enviada"];
const CANCELLED = ["cancelada", "cancelado", "canceled", "cancelled", "void", "anulada", "anulado", "estornada"];

const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const digits = (value) => String(value ?? "").replace(/\D/g, "");
const clientNumber = (value) => digits(value).replace(/^0+(?=\d)/, "");

// "Padaria São José Ltda - ME" e "PADARIA SAO JOSE" são a mesma empresa.
function companyKey(name) {
  return norm(name)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !LEGAL_SUFFIXES.has(word))
    .join(" ");
}

function isWixFatura(id, row) {
  if (!row || norm(row.source) !== "wix") return false;
  if (row.wixOrderNumber || row.wixTransactionId) return false;
  return String(id).startsWith("wix-inv-") || Boolean(row.wixInvoiceNumber || row.wixEntityId);
}

function activeFatura(id, row) {
  return isWixFatura(id, row) && !row.isExcluded && !CANCELLED.includes(norm(row.status));
}

function sameCompany(target, row) {
  const doc = digits(target.cpfCnpj);
  if (doc && digits(row.cpfCnpj)) return doc === digits(row.cpfCnpj);
  const number = clientNumber(target.clientNumber);
  if (number && clientNumber(row.clientNumber) && number === clientNumber(row.clientNumber)) return true;
  const key = companyKey(target.client);
  return Boolean(key) && key === companyKey(row.client);
}

function monthRange(dueDate) {
  const match = String(dueDate || "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  return { month: `${match[1]}-${match[2]}`, start: `${match[1]}-${match[2]}-01`, end: `${match[1]}-${match[2]}-31` };
}

const isMaster = (uid, profile) =>
  uid === MASTER_USER_ID && profile?.role === "admin" && profile?.active === true;

// Retorna as Faturas Wix ativas da mesma empresa: em aberto de qualquer mês e,
// no mês de vencimento informado, também as já pagas.
async function findWixInvoices(db, target, { limit = 5000 } = {}) {
  const range = monthRange(target.dueDate);
  const queries = [db.collection("transactions").where("status", "in", OPEN_STATUSES)];
  if (range)
    queries.push(db.collection("transactions").where("dueDate", ">=", range.start).where("dueDate", "<=", range.end));
  const found = new Map();
  for (const query of queries) {
    const snapshot = await query.limit(limit + 1).get();
    if (snapshot.docs.length > limit)
      throw Object.assign(new Error("Volume de cobranças exige conferência manual das Faturas Wix antes de cobrar."), { status: 409 });
    for (const doc of snapshot.docs) found.set(doc.id, doc);
  }
  return [...found.values()]
    .filter((doc) => activeFatura(doc.id, doc.data()) && sameCompany(target, doc.data()))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        number: String(row.wixInvoiceNumber || doc.id.replace(/^wix-inv-/, "")),
        client: row.client || "",
        dueDate: row.dueDate || "",
        status: row.status || "",
      };
    });
}

function blockedMessage(target, invoices, channel) {
  const list = invoices.map((i) => `#${i.number} (venc. ${String(i.dueDate).split("-").reverse().join("/") || "sem data"}, ${i.status || "sem situação"})`).join(", ");
  const action = channel === "boleto" ? "a emissão de boleto" : "o lançamento pelo app";
  return `Bloqueado: ${target.client || "esta empresa"} já tem Fatura Wix emitida: ${list}. Para não cobrar em dobro, ${action} fica travado. Cobre pela Fatura Wix ou cancele a fatura no Wix antes. Exceção só pelo master, com motivo.`;
}

function overrideReason(override) {
  const reason = String(override?.reason || "").trim();
  return reason.length >= 15 && reason.length <= 1000 ? reason : "";
}

// Toda tentativa gera log: bloqueio ou exceção liberada pelo master.
// Devolve a exceção aplicada (ou null quando não havia Fatura Wix).
async function assertNoWixInvoice(db, target, { channel, uid, actor, stage, transactionId = "", profile = null, override = null }) {
  const invoices = await findWixInvoices(db, target);
  if (!invoices.length) return null;
  const at = new Date().toISOString();
  const reason = override ? overrideReason(override) : "";
  const refusal = !override ? null
    : !isMaster(uid, profile) ? ["Somente o master pode liberar exceção à trava de Fatura Wix.", 403]
      : !reason ? ["Descreva o motivo da exceção (mínimo de 15 caracteres).", 400] : null;
  const allowed = Boolean(override) && !refusal;
  await db.runTransaction(async (tx) => {
    tx.create(db.collection("wixBillingLockAudit").doc(randomUUID()), {
      action: allowed ? "override" : "blocked",
      overrideRequested: Boolean(override),
      reason: reason || String(override?.reason || "").slice(0, 1000),
      channel,
      stage,
      uid,
      actor: actor || uid,
      at,
      transactionId,
      client: target.client || "",
      cpfCnpj: digits(target.cpfCnpj),
      clientNumber: String(target.clientNumber || ""),
      dueDate: target.dueDate,
      invoices: invoices.map((i) => i.id),
    });
  });
  if (allowed) return { at, uid, actor: actor || uid, reason, invoices: invoices.map((i) => i.id) };
  if (refusal) throw Object.assign(new Error(refusal[0]), { status: refusal[1], wixInvoices: invoices });
  throw Object.assign(new Error(blockedMessage(target, invoices, channel)), { status: 409, wixInvoices: invoices });
}

module.exports = { MASTER_USER_ID, companyKey, isWixFatura, activeFatura, sameCompany, monthRange, findWixInvoices, assertNoWixInvoice, blockedMessage, isMaster };
