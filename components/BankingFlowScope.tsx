import React from 'react';
import { Landmark, ReceiptText } from 'lucide-react';

export default function BankingFlowScope() {
  return <section aria-label="Integrações bancárias" className="grid md:grid-cols-2 gap-4">
    <article className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <h2 className="font-semibold flex items-center gap-2"><ReceiptText size={20} aria-hidden="true"/>Retorno de boletos</h2>
      <p className="text-sm mt-2">Itaú → Boleto Cloud → Financeiro</p>
      <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">A baixa do recebível depende da confirmação bancária recebida pelo Boleto Cloud e do vínculo confirmado com o lançamento. Importar extrato não substitui esse retorno.</p>
    </article>
    <article className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-4">
      <h2 className="font-semibold flex items-center gap-2"><Landmark size={20} aria-hidden="true"/>Conciliação da conta Itaú</h2>
      <p className="text-sm mt-2 font-medium">Hoje: importação OFX · API direta: pendente de habilitação</p>
      <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">O extrato reúne entradas e saídas da única conta bancária. Nesta etapa, a comparação sugere correspondências com baixas nativas a pagar. A integração direta está prevista para contas a pagar e receber.</p>
      <p className="text-sm mt-2">Pagamento já baixado deve ser conciliado sem gerar uma segunda baixa.</p>
    </article>
  </section>;
}
