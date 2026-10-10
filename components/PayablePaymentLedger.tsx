import React, { useState } from 'react';
import { auth } from '../services/firebaseConfig';
import { formatISODateBR, toLocalISODate } from '../utils/dateUtils';
type Ledger = {rows:Array<{id:string;transactionId:string;date:string;amountCents:number;supplier:string;bankAccount:string;method:string;actor:string}>;totalCents:number;coverage:string};
const money = (c:number) => (c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function PayablePaymentLedger() {
  const today = toLocalISODate(new Date());
  const [start,setStart] = useState(today.slice(0,7)+'-01'), [end,setEnd] = useState(today);
  const [result,setResult] = useState<Ledger|null>(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  async function load(e:React.FormEvent) {
    e.preventDefault(); setBusy(true);setError('');setResult(null);
    try {
      if (!auth.currentUser) throw Error('Entre novamente.');
      const response = await fetch(`/api/financial-entries/payables/ledger?${new URLSearchParams({start,end})}`,{headers:{Authorization:`Bearer ${await auth.currentUser.getIdToken()}`}});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Não foi possível consultar as baixas.');
      setResult(data);
    } catch(e:any) {setError(e.message);} finally {setBusy(false);}
  }
  return <details className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
    <summary className="cursor-pointer font-semibold text-blue-700 dark:text-blue-300">Pagamentos por data efetiva — contas a pagar</summary>
    <p className="my-3 text-sm text-slate-600 dark:text-slate-300">Uma linha por baixa ativa realizada no app, inclusive pagamentos parciais. Baixas estornadas são excluídas dos totais; seu histórico permanece na conta. Não inclui pagamentos legados sem histórico de baixa. Acesso administrativo.</p>
    <form onSubmit={load} className="flex flex-wrap gap-3 items-end">
      <label>De<input required disabled={busy} type="date" value={start} onChange={e=>{setStart(e.target.value);setResult(null);}} className="block border rounded p-2 dark:bg-slate-800"/></label>
      <label>Até<input required disabled={busy} type="date" value={end} onChange={e=>{setEnd(e.target.value);setResult(null);}} className="block border rounded p-2 dark:bg-slate-800"/></label>
      <button disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy?'Consultando…':'Consultar pagamentos'}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}
    {result && <div className="mt-4" aria-live="polite"><p className="font-semibold">{result.rows.length} baixa(s) · Total efetivamente pago: {money(result.totalCents)}</p>
      <div className="overflow-x-auto mt-3"><table className="w-full text-sm text-left"><caption className="sr-only">Baixas por data efetiva</caption><thead><tr>{['Data efetiva','Favorecido / lançamento','Conta bancária','Forma','Responsável','Valor pago'].map(v=><th key={v} className="p-2">{v}</th>)}</tr></thead><tbody>{result.rows.map(r=><tr key={r.id} className="border-t dark:border-slate-700"><td className="p-2 whitespace-nowrap">{formatISODateBR(r.date)}</td><td className="p-2">{r.supplier}<small className="block text-slate-500">{r.transactionId}</small></td><td className="p-2">{r.bankAccount}</td><td className="p-2">{r.method}</td><td className="p-2">{r.actor}</td><td className="p-2 whitespace-nowrap">{money(r.amountCents)}</td></tr>)}</tbody></table></div>
      {!result.rows.length && <p>Nenhuma baixa nativa encontrada no período.</p>}
    </div>}
  </details>;
}
