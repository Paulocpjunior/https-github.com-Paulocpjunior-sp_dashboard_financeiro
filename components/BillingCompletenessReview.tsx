import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Transaction } from '../types';
import { FirebaseService } from '../services/firebaseService';
import { BillingPeriodField, buildBillingCompleteness } from '../utils/billingCompleteness';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const monthNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());

export default function BillingCompletenessReview() {
  const [month, setMonth] = useState(monthNow);
  const [field, setField] = useState<BillingPeriodField>('dueDate');
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readAt, setReadAt] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(true);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const review = useMemo(() => transactions && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? buildBillingCompleteness(transactions, month, field) : null, [transactions, month, field]);
  const load = async () => {
    const version = ++request.current;
    setTransactions(null);
    setError('');
    setReadAt('');
    setLoading(true);
    try {
      const result = await FirebaseService.fetchTransactionsForBillingReview();
      if (request.current !== version) return;
      setTransactions(result);
      setReadAt(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    } catch (failure) {
      if (request.current === version) setError(failure instanceof Error ? failure.message : 'Não foi possível consultar os lançamentos atuais.');
    } finally {
      if (request.current === version) setLoading(false);
    }
  };
  const displayed = review?.rows.filter(row => !onlyIssues || row.issues.length) || [];
  return <section aria-labelledby="billing-review-heading" className="rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-5 space-y-4">
    <div>
      <h2 id="billing-review-heading" className="text-lg font-bold">Conferência mensal dos lançamentos</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">Cada cliente cobrado no mês anterior precisa de cobrança no mês atual ou dispensa contratual comprovada. Pagamento anterior não dispensa a cobrança seguinte.</p>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-semibold">Mês a conferir
        <input type="month" value={month} onChange={event => setMonth(event.target.value)} className="block border rounded-lg p-2 dark:bg-slate-950" />
      </label>
      <label className="text-sm font-semibold">Critério do mês
        <select value={field} onChange={event => setField(event.target.value as BillingPeriodField)} className="block border rounded-lg p-2 dark:bg-slate-950">
          <option value="dueDate">Vencimento</option><option value="date">Emissão / lançamento</option>
        </select>
      </label>
      <button type="button" disabled={loading || !month} onClick={load} className="bg-blue-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50">{loading ? 'Conferindo...' : 'Consultar lançamentos atuais'}</button>
    </div>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">Conferência indisponível: {error} O mês não foi validado.</p>}
    {review && <>
      <p className="text-xs text-slate-500">Comparação {review.previousMonth} → {review.targetMonth}. Dados consultados em {readAt} (Brasília). Atualize após corrigir os lançamentos.</p>
      <div className="grid sm:grid-cols-4 gap-3 text-sm">
        <p><strong>{review.previousClients}</strong> clientes no mês anterior</p>
        <p><strong>{review.missingClients}</strong> sem lançamento atual</p>
        <p><strong>{money(review.missingReferenceAmount)}</strong> valor anterior desses clientes</p>
        <p><strong>{review.postingCoverage === null ? 'Sem base anterior' : review.postingCoverage.toLocaleString('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> cobertura de lançamentos</p>
      </div>
      <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200"><strong>Mês ainda não validado para fechamento.</strong> Checklist contratual e confirmação de emissão dos boletos ainda não estão integrados nesta conferência. Cobertura de lançamentos não comprova cobrança emitida. Saídas de clientes precisam da data da última cobrança e da evidência do contrato.</p>
      {review.sourceIssues.length > 0 && <details className="text-sm text-red-700 dark:text-red-300"><summary>{review.sourceIssues.length} lançamentos a receber com data ausente ou inválida: revisar antes de concluir</summary><ul className="list-disc pl-5">{review.sourceIssues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={onlyIssues} onChange={event => setOnlyIssues(event.target.checked)} /> Mostrar somente pendências</label>
      <div className="overflow-x-auto max-h-96"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Cliente</th><th className="p-2">Mês anterior</th><th className="p-2">Mês atual</th><th className="p-2">Conferência</th></tr></thead><tbody>
        {displayed.map(row => <tr key={row.identity} className="border-t border-slate-200 dark:border-slate-700"><td className="p-2">{row.client}<span className="block text-xs text-slate-500">{row.identity}</span></td><td className="p-2">{money(row.previousAmount)} ({row.previousIds.length})</td><td className="p-2">{money(row.currentAmount)} ({row.currentIds.length})</td><td className="p-2">{row.issues.length ? row.issues.join(' ') : 'Lançamento localizado; emissão e contrato ainda precisam ser conferidos.'}</td></tr>)}
      </tbody></table></div>
      {!displayed.length && <p className="text-sm">{review.rows.length ? 'Nenhuma pendência de lançamento nesse filtro. Checklist e emissão continuam pendentes.' : 'Nenhum lançamento localizado nos dois meses. Isso não comprova ausência de clientes a cobrar.'}</p>}
    </>}
  </section>;
}
