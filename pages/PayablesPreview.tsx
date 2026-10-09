import React, { useState } from "react";
import PayablesModal from "../components/PayablesModal";
import catalog from "../cloud-run/pdf-download-service/native-entry-catalog.json";
const row: any = {
  id: "demo",
  movement: "Saída",
  description: "Internet — FORNECEDOR FICTÍCIO",
  client: "Fornecedor fictício",
  status: "Pendente",
  valuePaid: 150,
  valorOriginal: 150,
  bankAccount: catalog.banks[0],
  metodoPagamento: catalog.paymentMethods[2],
  dueDate: "2026-11-10",
  date: "2026-10-09",
  attachments: [],
};
let rules: any[] = [];
async function demo(path: string, b?: any) {
  if (path === "rules") return { rules };
  if (path.startsWith("items/"))
    return {
      transaction: { ...row },
      catalog,
      version: "demo",
      recipients: [],
    };
  if (path === "payment/preview")
    return { reviewHash: "demo", after: { ...row, status: "Pago" } };
  if (path === "payment/commit") {
    row.status = "Pago";
    return { transaction: { ...row } };
  }
  if (path === "rules/save") {
    rules = [{ ...b, revision: 1, description: row.description }];
    return { rule: rules[0] };
  }
  if (path === "rules/preview")
    return {
      reviewHash: "demo",
      transaction: { ...row, dueDate: b.month + "-10" },
    };
  if (path === "rules/generate")
    return { transaction: { ...row, dueDate: b.month + "-10" } };
  if (path === "invite/settings") return { saved: true };
  throw Error(
    "Simulação visual: downloads não disponíveis. Use os testes do backend para validar os arquivos.",
  );
}
export default function PayablesPreview() {
  const [open, setOpen] = useState(true);
  return (
    <main className="p-8">
      <h1>SIMULAÇÃO LOCAL — nenhum dado financeiro real</h1>
      <button onClick={() => setOpen(true)}>Abrir contas a pagar</button>
      {open && (
        <PayablesModal
          id="demo"
          api={demo}
          onClose={() => setOpen(false)}
          onSaved={() => {}}
        />
      )}
    </main>
  );
}
