const test = require("node:test");
const assert = require("node:assert/strict");
const { companyKey, sameCompany, activeFatura, activeWixCharge, sameCharge, amountCents, monthRange } = require("./wix-billing-lock");

test("nome da empresa ignora acentos, pontuação e sufixos societários", () => {
  assert.equal(companyKey("Padaria São José Ltda - ME"), "padaria sao jose");
  assert.equal(companyKey("PADARIA SAO JOSE"), "padaria sao jose");
  assert.equal(companyKey("Comércio X S/A"), "comercio x");
  assert.notEqual(companyKey("Padaria São José II"), companyKey("Padaria São José"));
});

test("CPF/CNPJ diferente prevalece sobre nome igual; N.Cliente igual vincula", () => {
  assert.equal(sameCompany({ client: "Alfa", cpfCnpj: "11222333000181" }, { client: "Alfa", cpfCnpj: "99888777000166" }), false);
  assert.equal(sameCompany({ client: "Alfa", clientNumber: "007" }, { client: "Outra", clientNumber: 7 }), true);
  assert.equal(sameCompany({ client: "Alfa Ltda" }, { client: "ALFA" }), true);
  assert.equal(sameCompany({ client: "" }, { client: "" }), false);
});

test("só Faturas Wix ativas travam; pedidos da loja, canceladas e excluídas não", () => {
  const fatura = { source: "wix", wixInvoiceNumber: "1", status: "Pendente" };
  assert.equal(activeFatura("wix-inv-1", fatura), true);
  assert.equal(activeFatura("wix-inv-1", { ...fatura, status: "Paga" }), true);
  assert.equal(activeFatura("wix-inv-1", { ...fatura, status: "Cancelada" }), false);
  assert.equal(activeFatura("wix-inv-1", { ...fatura, isExcluded: true }), false);
  assert.equal(activeFatura("wix-abc", { source: "wix", wixOrderNumber: "10001", status: "Pago" }), false);
  assert.equal(activeFatura("native-1", { source: "native-finance", wixInvoiceNumber: "" }), false);
  assert.deepEqual(monthRange("2026-02-14"), { month: "2026-02", start: "2026-02-01", end: "2026-02-31" });
  assert.equal(monthRange("14/02/2026"), null);
});

test("duplicata Wix exige mesmo valor em centavos e mesmo vencimento", () => {
  const app = { dueDate: "2026-11-15", totalCobranca: 1621 };
  assert.equal(amountCents({ honorarios: "1.600,00", valorExtra: "21" }), 162100);
  assert.equal(sameCharge(app, { dueDate: "2026-11-15", valorOriginal: 1621 }), true);
  assert.equal(sameCharge(app, { dueDate: "2026-07-19", valorOriginal: 1621 }), false);
  assert.equal(sameCharge(app, { dueDate: "2026-11-15", valorOriginal: 1620.99 }), false);
  assert.equal(sameCharge({ dueDate: "2026-11-15" }, { dueDate: "2026-11-15" }), false);
  assert.equal(activeWixCharge("wix-abc", { source: "wix", wixOrderNumber: "10001", status: "Pago" }), true);
  assert.equal(activeWixCharge("wix-abc", { source: "wix", wixOrderNumber: "10001", status: "Cancelado" }), false);
  assert.equal(activeWixCharge("native-1", { source: "native-finance" }), false);
});
