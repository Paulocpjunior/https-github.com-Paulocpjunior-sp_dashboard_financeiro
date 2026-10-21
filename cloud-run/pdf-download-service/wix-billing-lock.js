// Trava de faturamento Wix: empresa com Fatura Wix emitida no mesmo mês de
// vencimento não recebe nova cobrança pelo app (Nova cobrança ou boleto).
// As Faturas Wix chegam pelo wix-sync-service como transactions/wix-inv-*
// (source "wix", sem CPF/CNPJ). Pedidos do e-commerce (wix-{UUID}) não travam:
// são vendas pagas na loja, não faturas de serviço.
const { randomUUID } = require("node:crypto");

const LEGAL_SUFFIXES = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s", "a", "ss", "slu", "mei", "cia", "limitada",
]);
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

// Retorna as Faturas Wix ativas da mesma empresa no mês de vencimento informado.
async function findWixInvoices(db, target, { limit = 5000 } = {}) {
  const range = monthRange(target.dueDate);
  if (!range) return [];
  const snapshot = await db
    .collection("transactions")
    .where("dueDate", ">=", range.start)
    .where("dueDate", "<=", range.end)
    .limit(limit + 1)
    .get();
  if (snapshot.docs.length > limit)
    throw Object.assign(new Error("Volume do mês exige conferência manual das Faturas Wix antes de cobrar."), { status: 409 });
  return snapshot.docs
    .filter((doc) => activeFatura(doc.id, doc.data()) && sameCompany(target, doc.data()))
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
  const list = invoices.map((i) => `#${i.number} (venc. ${i.dueDate.split("-").reverse().join("/")}, ${i.status || "sem situação"})`).join(", ");
  const action = channel === "boleto" ? "a emissão de boleto" : "o lançamento pelo app";
  const month = monthRange(target.dueDate).month.split("-").reverse().join("/");
  return `Bloqueado: ${target.client || "esta empresa"} já tem Fatura Wix emitida em ${month}: ${list}. Para não cobrar em dobro, ${action} fica travado. Cobre pela Fatura Wix ou cancele a fatura no Wix antes.`;
}

// Registra a tentativa bloqueada (toda ação de usuário gera log) e devolve o erro.
async function assertNoWixInvoice(db, target, { channel, uid, actor, stage, transactionId = "" }) {
  const invoices = await findWixInvoices(db, target);
  if (!invoices.length) return;
  const at = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    tx.create(db.collection("wixBillingLockAudit").doc(randomUUID()), {
      action: "blocked",
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
  throw Object.assign(new Error(blockedMessage(target, invoices, channel)), { status: 409, wixInvoices: invoices });
}

module.exports = { companyKey, isWixFatura, activeFatura, sameCompany, monthRange, findWixInvoices, assertNoWixInvoice, blockedMessage };
