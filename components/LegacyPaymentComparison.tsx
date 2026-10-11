import React from 'react';
import type {LegacyComparison} from '../services/itauStatementService';
const money=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(value:string)=>value.split('-').reverse().join('/');
export default function LegacyPaymentComparison({comparison}:{comparison:LegacyComparison}) {
 const withCandidates=comparison.rows.filter(r=>r.candidates.length);
 return <section className="mt-6 border-t border-slate-300 dark:border-slate-700 pt-5 space-y-3" aria-label="Conferência de pagamentos antigos">
  <h3 className="text-lg font-bold">Pagamentos antigos — revisão separada</h3>
  <p className="text-sm">{comparison.coverage}</p>
  <p className="text-sm">{comparison.examined} registros encontrados pelas datas · {comparison.paymentCount} pagamentos elegíveis · {withCandidates.length} débitos com candidatos.</p>
  <p className="text-sm">Fora desta revisão: {comparison.excluded.native} nativos · {comparison.excluded.inactiveOrOutsideScope} excluídos ou fora do escopo · {comparison.excluded.invalidEvidence} com evidência incompleta ou conflitante · {comparison.excluded.differentBank} de outra conta.</p>
  <div role="note" className="rounded-lg bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100 p-4">Mesmo valor e até 3 dias de diferença indicam apenas um candidato. Confira o favorecido e o comprovante. Conta bancária ausente precisa ser comprovada; esta tela não confirma conciliação.</div>
  {!withCandidates.length && <p>Nenhum candidato antigo com valor pago e data válidos. Isso não comprova ausência de pagamento.</p>}
  {withCandidates.map(row=><details key={row.statement.id} className="rounded-lg border border-slate-300 dark:border-slate-700 p-4">
   <summary className="cursor-pointer font-medium">{date(row.statement.date)} · {row.statement.name||row.statement.memo} · {money(row.statement.amountCents)} · {row.candidates.length} candidato(s){row.ambiguous?' · Ambíguo':''}</summary>
   <p className="text-xs my-2 break-all">FITID: {row.statement.fitid}</p>
   {row.candidates.map(p=><div key={p.id} className="border-t border-slate-200 dark:border-slate-700 py-3">
    <p className="font-medium">{p.supplier} · {money(p.amountCents)}</p>
    <p className="text-sm">Pagamento informado: {date(p.date)} · {p.bankEvidence==='missing'?'Conta bancária não informada — comprovação necessária':'Mesma conta informada — conferir favorecido'}</p>
    <p className="text-xs break-all">Lançamento: {p.transactionId}</p>
   </div>)}
  </details>)}
 </section>;
}
