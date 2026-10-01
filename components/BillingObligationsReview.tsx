import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BillingReviewService } from '../services/billingReviewService';
import { fetchChecklistReview } from '../services/checklistReviewService';
import { auth } from '../services/firebaseConfig';
import { buildBillingObligations, obligationSituationLabels, type ObligationSituation } from '../utils/billingObligations';
import { checklistEvent, checklistEventLabels } from '../utils/checklistStatus';
import { readableChecklistNotes } from '../utils/checklistNotes';
import type { BillingPeriodField } from '../utils/billingCompleteness';

const currentMonth = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const time = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
type Loaded = { review: ReturnType<typeof buildBillingObligations>; financialReadAt: string; checklistReadAt: string; documentCount: number };

export default function BillingObligationsReview() {
  const [month, setMonth] = useState(currentMonth);
  const [field, setField] = useState<BillingPeriodField>('dueDate');
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [situation, setSituation] = useState<ObligationSituation | ''>('');
  const [page, setPage] = useState(1);
  const request = useRef(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current++; pending.current?.abort(); }, []);
  const load = async () => {
    const version = ++request.current;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);
    const user = auth.currentUser;
    setLoading(true); setData(null); setError(''); setPage(1);
    try {
      if (!user) throw new Error('Entre novamente para consultar as fontes.');
      const [financial, checklist] = await Promise.all([BillingReviewService.fetch(), fetchChecklistReview(controller.signal)]);
      if (version !== request.current) return;
      if (controller.signal.aborted) throw new Error('Leitura não concluída no prazo.');
      if (auth.currentUser !== user) throw new Error('Sessão alterada durante a consulta.');
      setData({ review: buildBillingObligations(financial.transactions, checklist.records, month, field),
        financialReadAt: financial.readTime, checklistReadAt: checklist.readAt, documentCount: financial.documentCount });
    } catch (failure) {
      if (version === request.current) setError(controller.signal.aborted ? 'Leitura não concluída no prazo. Consulte novamente.' : failure instanceof Error ? failure.message : 'Não foi possível cruzar as fontes.');
    } finally {
      clearTimeout(timeout); controller.abort();
      if (version === request.current) { setLoading(false); pending.current = null; }
    }
  };
  const changePeriod = () => { request.current++; pending.current?.abort(); setLoading(false); setData(null); setError(''); setPage(1); };
  const rows = useMemo(() => data?.review.rows.filter(row => (!situation || row.situation === situation) &&
    `${row.client} ${row.identity}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) || [], [data, search, situation]);
  return <section aria-labelledby="obligations-heading" className="rounded-xl border border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900 p-5 space-y-4">
    <h2 id="obligations-heading" className="text-lg font-bold">Lista mensal — checklist e lançamentos</h2>
    <p className="text-sm">Cruza os eventos do checklist com o mês anterior e o mês escolhido, por CPF/CNPJ ou Nosso Número. Inclui eventos sem lançamento para revisão de novas entradas, saídas e alterações. As situações apontam o que conferir; valores exibidos são referências.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Mês a conferir<input type="month" value={month} onChange={e => { changePeriod(); setMonth(e.target.value); }} className="block border rounded p-2 dark:bg-slate-950" /></label>
      <label className="text-sm">Critério do mês<select value={field} onChange={e => { changePeriod(); setField(e.target.value as BillingPeriodField); }} className="block border rounded p-2 dark:bg-slate-950"><option value="dueDate">Vencimento</option><option value="date">Emissão / lançamento</option></select></label>
      <button type="button" disabled={loading || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)} onClick={load} className="bg-blue-700 text-white rounded-lg px-4 py-2 disabled:opacity-50">{loading ? 'Cruzando fontes completas...' : 'Gerar lista mensal de conferência'}</button>
    </div>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">Lista indisponível: {error} Nenhuma lista parcial foi apresentada.</p>}
    {data && <>
      <p className="text-xs text-slate-500">Comparação {data.review.previousMonth} → {data.review.targetMonth}. Financeiro: {data.documentCount.toLocaleString('pt-BR')} registros, leitura em {time(data.financialReadAt)}. Checklist: {data.review.checklistRecords.toLocaleString('pt-BR')} respostas, leitura em {time(data.checklistReadAt)} (Brasília). As duas fontes têm horários próprios; atualize após alterações.</p>
      <p className="text-sm"><strong>{data.review.linkedChecklistRecords} / {data.review.checklistRecords}</strong> respostas vinculadas a itens com lançamento em algum dos dois meses. Esta métrica mede a associação das fontes, não a cobertura contratual.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">{Object.entries(data.review.counts).map(([key,count]) => <p key={key}><strong>{count}</strong> {obligationSituationLabels[key as ObligationSituation]}</p>)}</div>
      <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">Lista preparatória: uma resposta histórica não comprova contrato vigente no mês. STATUS de saída ou suspensão não aprova dispensa nem elimina saldos. Lançamento localizado não comprova boleto emitido ou enviado. O mês permanece sem validação para fechamento.</p>
      {data.review.sourceIssues.length > 0 && <details className="text-sm text-red-700 dark:text-red-300"><summary>{data.review.sourceIssues.length} lançamentos com datas ausentes ou inválidas</summary><ul>{data.review.sourceIssues.slice(0,100).map((issue,i) => <li key={i}>{issue}</li>)}</ul><p>A lista mostra os primeiros 100 problemas. Esses registros não comprovam presença em nenhum dos dois meses.</p></details>}
      <div className="flex flex-wrap gap-3"><label className="text-sm">Buscar cliente ou identificação<input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="block border rounded p-2 dark:bg-slate-950" /></label><label className="text-sm">Situação<select value={situation} onChange={e => { setSituation(e.target.value as ObligationSituation | ''); setPage(1); }} className="block border rounded p-2 dark:bg-slate-950"><option value="">Todas</option>{Object.entries(obligationSituationLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Cliente</th><th className="p-2">Referência anterior</th><th className="p-2">Lançamentos atuais</th><th className="p-2">Checklist por STATUS</th><th className="p-2">Situação e conferência</th></tr></thead><tbody>{rows.slice((page-1)*20,page*20).map(row => <tr key={row.identity} className="border-t border-slate-200 dark:border-slate-700">
        <td className="p-2">{row.client}<span className="block text-xs">{row.identity}</span></td>
        <td className="p-2">{money(row.previousAmount)}<span className="block text-xs">{row.previousIds.length} lançamento(s)</span></td>
        <td className="p-2">{money(row.currentAmount)}<span className="block text-xs">{row.currentIds.length} lançamento(s)</span></td>
        <td className="p-2">{row.checklist.length ? row.checklist.map(record => <details key={record.submissionId} className="mb-2"><summary>{checklistEventLabels[checklistEvent(record.status)]} • resposta {record.submissionId}</summary><p>STATUS: {record.status || 'Ausente'}</p><p>Honorários no campo: {record.amount == null ? 'Conferir nas observações' : money(record.amount)}</p><p>Cadastrada em: {record.sourceCreatedAt || 'Não informado'} — conferir vigência.</p><p className="whitespace-pre-wrap max-w-xl">{readableChecklistNotes(record.notes)}</p></details>) : 'Sem resposta vinculada'}</td>
        <td className="p-2"><strong>{obligationSituationLabels[row.situation]}</strong><details><summary>O que conferir</summary><ul className="list-disc pl-4">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>IDs financeiros anteriores: {row.previousIds.join(', ') || 'Nenhum'}<br/>IDs financeiros atuais: {row.currentIds.join(', ') || 'Nenhum'}</p></details></td>
      </tr>)}</tbody></table></div>
      {!rows.length && <p className="text-sm">Nenhum item neste filtro. Isso não comprova ausência de obrigações.</p>}
      <div className="flex gap-3 text-sm"><button disabled={page <= 1} onClick={() => setPage(p => p-1)}>Anterior</button><span>{rows.length} item(ns) • página {page} de {Math.max(1,Math.ceil(rows.length/20))}</span><button disabled={page*20 >= rows.length} onClick={() => setPage(p => p+1)}>Próxima</button></div>
    </>}
  </section>;
}
