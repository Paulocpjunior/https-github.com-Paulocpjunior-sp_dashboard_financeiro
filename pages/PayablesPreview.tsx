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
  nativeEntry: {supplier: "Fornecedor fictício", personType: "PJ", authorizedBy: catalog.authorizedBy[0]},
  paidBy: catalog.paidBy[0],
  attachments: [],
};
let rules: any[] = [];
async function demo(path: string, b?: any) {
  if (path === "rules") return { rules };
  if (path === "drafts") return {drafts:[]};
  if (path.startsWith("items/"))
    return {
      transaction: { ...row },
      catalog: {...catalog, authorizedBy: ["Administrador fictício", ...catalog.authorizedBy]},
      actor: {uid:"demo-user",name:"Administrador fictício"},
      version: "demo",
      recipients: [],
    };
  if (path === "payment/preview" || path === "payment/commit") {
    const p = b.payment;
    const old = row.payableBalance || {paidCents:0,interestCents:0,fineCents:0,discountCents:0,remainingCents:15000};
    const amountCents = Math.round(Number(p.amount)*100), interestCents=Math.round(Number(p.interest)*100), fineCents=Math.round(Number(p.fine)*100), discountCents=Math.round(Number(p.discount)*100);
    const remainingCents=old.remainingCents+interestCents+fineCents-discountCents-amountCents;
    if(remainingCents<0 || amountCents<=0 || (p.mode==='full' && remainingCents!==0) || (p.mode==='partial' && remainingCents<=0)) throw Object.assign(Error('Confira valor pago e tipo de baixa.'),{status:400});
    const payableBalance={version:1,paidCents:old.paidCents+amountCents,interestCents:old.interestCents+interestCents,fineCents:old.fineCents+fineCents,discountCents:old.discountCents+discountCents,remainingCents};
    const after={...row,status:remainingCents?'Pendente':'Pago',payableBalance};
    if(path.endsWith('preview')) return {reviewHash:'demo',after};
    Object.assign(row,after);
    row.paymentDate=p.date;
    row.payableSettlement={...p,actor:'Administrador fictício',requestId:b.requestId,amountCents,interestCents,fineCents,discountCents,remainingCents};
    row.payablePayments=[...(row.payablePayments||[]),row.payableSettlement];
    return {transaction:{...row}};
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
