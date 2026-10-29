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
const readOnlyPreview = new URLSearchParams(window.location.search).get('access') === 'read';
const teamPreview = new URLSearchParams(window.location.search).get('access') === 'team';
const approvalPreview = new URLSearchParams(window.location.search).get('access') === 'approve';
let approvals:any[] = approvalPreview ? [{id:'fixture-approval',transactionId:'demo',version:'demo',status:'pending',requesterUid:'another-user',requesterName:'Colaborador fictício',attachments:[],payment:{date:'2026-10-11',amount:'150.00',mode:'full',interest:'0',fine:'0',discount:'0',supplier:'Fornecedor fictício',personType:'PJ',bankAccount:catalog.banks[0],method:catalog.paymentMethods[2],paidBy:catalog.paidBy[0],authorizedBy:'Colaborador fictício',note:'Fatura de demonstração'}}] : [];
let rules: any[] = [];
let previousPayment: any = null;
async function demo(path: string, b?: any) {
  if (readOnlyPreview && b) throw Object.assign(Error("Perfil de consulta não pode alterar dados."),{status:403});
  if (path === "rules") { if (teamPreview) throw Object.assign(Error("Sem acesso às recorrências."),{status:403}); return { rules }; }
  if (path === "due-date/preview" || path === "due-date/commit") {
    const a = b.amendment;
    if (!a.dueDate || a.dueDate === row.dueDate || a.reason.trim().length < 10) throw Object.assign(Error("Confira o vencimento e o motivo."),{status:400});
    const after = {...row, dueDate: a.dueDate};
    if (path.endsWith('preview')) return {reviewHash:'demo-due-date', after};
    row.dueDateAmendments=[...(row.dueDateAmendments||[]),{requestId:b.requestId,before:row.dueDate,after:a.dueDate,reason:a.reason,actor:'Colaboradora fictícia',at:new Date().toISOString()}];
    row.dueDate=a.dueDate;
    return {transaction:{...row}};
  }
  if (path === "drafts") return {drafts:[]};
  if (path.startsWith("items/"))
    return {
      transaction: { ...row },
      catalog: {...catalog, authorizedBy: ["Administrador fictício", ...catalog.authorizedBy]},
      actor: {uid:"demo-user",role:"admin",name:"Administrador fictício"},
      approvalPolicy:{enabled:approvalPreview,thresholdCents:10000},
      approvals,
      capabilities: teamPreview ? {read:false,dueDate:true} : {approve:approvalPreview,read:true,dueDate:!readOnlyPreview,settle:!readOnlyPreview,reverse:!readOnlyPreview,recurrence:!readOnlyPreview,invite:!readOnlyPreview},
      version: "demo",
      recipients: [],
    };
  if(path === 'approvals/decide') {
    approvals=approvals.map(a=>a.id===b.approvalId?{...a,status:b.decision,reason:b.reason,approverName:'Administrador fictício'}:a);
    return {approval:approvals[0]};
  }
  if (path === "payment/preview" || path === "payment/commit") {
    const p = b.payment;
    const old = row.payableBalance || {paidCents:0,interestCents:0,fineCents:0,discountCents:0,remainingCents:15000};
    const amountCents = Math.round(Number(p.amount)*100), interestCents=Math.round(Number(p.interest)*100), fineCents=Math.round(Number(p.fine)*100), discountCents=Math.round(Number(p.discount)*100);
    const remainingCents=old.remainingCents+interestCents+fineCents-discountCents-amountCents;
    if(remainingCents<0 || amountCents<=0 || (p.mode==='full' && remainingCents!==0) || (p.mode==='partial' && remainingCents<=0)) throw Object.assign(Error('Confira valor pago e tipo de baixa.'),{status:400});
    const payableBalance={version:1,paidCents:old.paidCents+amountCents,interestCents:old.interestCents+interestCents,fineCents:old.fineCents+fineCents,discountCents:old.discountCents+discountCents,remainingCents};
    const after={...row,status:remainingCents?'Pendente':'Pago',payableBalance};
    if(path.endsWith('preview')) return {reviewHash:'demo',after};
    previousPayment = structuredClone(row);
    Object.assign(row,after);
    row.paymentDate=p.date;
    row.payableSettlement={...p,actor:'Administrador fictício',requestId:b.requestId,amountCents,interestCents,fineCents,discountCents,remainingCents};
    row.payablePayments=[...(row.payablePayments||[]),row.payableSettlement];
    return {transaction:{...row}};
  }
  if (path === "reversal/preview" || path === "reversal/commit") {
    if (!previousPayment || b.reason.trim().length < 10) throw Object.assign(Error("Confira a baixa e o motivo."),{status:400});
    if (path.endsWith('preview')) return {reviewHash:'demo-reversal',after:previousPayment};
    const history=row.payablePayments;
    const reversal={requestId:b.requestId,paymentRequestId:row.payableSettlement.requestId,amountCents:row.payableSettlement.amountCents,reason:b.reason,actor:'Administrador fictício',at:new Date().toISOString()};
    for (const k of Object.keys(row)) delete row[k];
    Object.assign(row,previousPayment,{payablePayments:history,payableReversals:[reversal]});
    previousPayment=null;
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
