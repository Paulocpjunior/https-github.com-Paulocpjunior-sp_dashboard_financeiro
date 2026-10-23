// Trava de faturamento Wix: Faturas Wix, vendas do e-commerce Wix e boletos do
// app são serviços distintos e convivem na mesma empresa. Só trava a cobrança em
// dobro de fato: mesma empresa + mesmo valor + mesmo vencimento de uma Fatura
// Wix ou pedido Wix ativo (Paulo, 2026-10-23). Só o master libera exceção, com
// motivo e log. As Faturas Wix chegam pelo wix-sync-service como
// transactions/wix-inv-* e os pedidos da loja como wix-{UUID} (source "wix").
const { randomUUID } = require("node:crypto");

const LEGAL_SUFFIXES = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s", "a", "ss", "slu", "mei", "cia", "limitada",
]);
// Mesmo UID do master usado em utils/masterAccount.ts e firestore.rules.
const MASTER_USER_ID = "hpdsWehGGAYE3uKCar4pBiRVxFJ3";
const CANCELLED = ["cancelada", "cancelado", "canceled", "cancelled", "void", "anulada", "anulado", "estornada"];

const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const digits = (value) => String(value ?? "").replace(/\D/g, "");
const clientNumber = (value) => digits(value).replace(/^0+(?=\d)/, "");
function money(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return Number(s) || 0;
}
// Mesmo critério de valor do boleto-cloud.js (total da cobrança primeiro).
function amountCents(row) {
  const value = [row.totalCobranca, row.valorOriginal, money(row.honorarios) + money(row.valorExtra), row.valueReceived]
    .map(money)
    .find((n) => n > 0) || 0;
  return Math.round(value * 100);
}

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

function isWixOrder(id, row) {
  return Boolean(row) && norm(row.source) === "wix" && !isWixFatura(id, row);
}

function activeFatura(id, row) {
  return isWixFatura(id, row) && !row.isExcluded && !CANCELLED.includes(norm(row.status));
}

function activeWixCharge(id, row) {
  return (isWixFatura(id, row) || isWixOrder(id, row)) && !row.isExcluded && !CANCELLED.includes(norm(row.status));
}

// Duplicidade = mesmo valor (centavos) e mesmo vencimento; a empresa é conferida à parte.
function sameCharge(target, row) {
  const cents = amountCents(target);
  return Boolean(target.dueDate) && cents > 0 && String(row.dueDate || "") === String(target.dueDate) && amountCents(row) === cents;
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

// Retorna as cobranças Wix ativas (Fatura Wix ou pedido da loja) da mesma
// empresa com o mesmo valor e o mesmo vencimento da cobrança do app.
async function findWixInvoices(db, target, { limit = 5000 } = {}) {
  if (!monthRange(target.dueDate) || amountCents(target) <= 0) return [];
  const snapshot = await db.collection("transactions").where("dueDate", "==", target.dueDate).limit(limit + 1).get();
  if (snapshot.docs.length > limit)
    throw Object.assign(new Error("Volume de cobranças exige conferência manual das Faturas Wix antes de cobrar."), { status: 409 });
  return snapshot.docs
    .filter((doc) => activeWixCharge(doc.id, doc.data()) && sameCompany(target, doc.data()) && sameCharge(target, doc.data()))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) => {
      const row = doc.data();
      const fatura = isWixFatura(doc.id, row);
      return {
        id: doc.id,
        kind: fatura ? "fatura" : "pedido",
        number: String(fatura ? row.wixInvoiceNumber || doc.id.replace(/^wix-inv-/, "") : row.wixOrderNumber || doc.id.replace(/^wix-/, "").slice(0, 8)),
        client: row.client || "",
        dueDate: row.dueDate || "",
        amount: amountCents(row) / 100,
        status: row.status || "",
      };
    });
}

function blockedMessage(target, invoices, channel) {
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const list = invoices.map((i) => `${i.kind === "pedido" ? "Pedido Wix" : "Fatura Wix"} #${i.number} (${brl(i.amount)}, venc. ${String(i.dueDate).split("-").reverse().join("/") || "sem data"}, ${i.status || "sem situação"})`).join(", ");
  const action = channel === "boleto" ? "a emissão de boleto" : "o lançamento pelo app";
  return `Bloqueado: ${target.client || "esta empresa"} já tem cobrança no Wix com o mesmo valor e o mesmo vencimento: ${list}. Para não cobrar em dobro, ${action} fica travado. Se for outro serviço, ajuste valor ou vencimento; se for a mesma cobrança, cobre pelo Wix ou cancele lá antes. Exceção só pelo master, com motivo.`;
}

function overrideReason(override) {
  const reason = String(override?.reason || "").trim();
  return reason.length >= 15 && reason.length <= 1000 ? reason : "";
}

// Toda tentativa gera log: bloqueio ou exceção liberada pelo master.
// Devolve a exceção aplicada (ou null quando não há cobrança Wix duplicada).
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
      amountCents: amountCents(target),
      invoices: invoices.map((i) => i.id),
    });
  });
  if (allowed) return { at, uid, actor: actor || uid, reason, invoices: invoices.map((i) => i.id) };
  if (refusal) throw Object.assign(new Error(refusal[0]), { status: refusal[1], wixInvoices: invoices });
  throw Object.assign(new Error(blockedMessage(target, invoices, channel)), { status: 409, wixInvoices: invoices });
}

module.exports = { MASTER_USER_ID, companyKey, isWixFatura, isWixOrder, activeFatura, activeWixCharge, sameCompany, sameCharge, amountCents, monthRange, findWixInvoices, assertNoWixInvoice, blockedMessage, isMaster };
