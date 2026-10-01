import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BillingReviewService } from '../services/billingReviewService';
import { fetchChecklistReview } from '../services/checklistReviewService';
import { auth } from '../services/firebaseConfig';
import { buildBillingObligations, obligationSituationLabels, type ObligationSituation } from '../utils/billingObligations';
import { checklistEvent, checklistEventLabels } from '../utils/checklistStatus';
import { readableChecklistNotes } from '../utils/checklistNotes';
import BillingConfirmationDialog from './BillingConfirmationDialog';
import { AuthService } from '../services/authService';
import { fetchSavedBillingReview, type IdentityLink } from '../services/billingConfirmationService';
import { fingerprintMonthlyRow, type SavedMonthlyTerms } from '../utils/billingConfirmation';
import type { ObligationReviewRow } from '../utils/billingObligations';
import type { BillingPeriodField } from '../utils/billingCompleteness';

const currentMonth = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const time = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
type Loaded = { review: ReturnType<typeof buildBillingObligations>; financialReadAt: string; checklistReadAt: string; documentCount: number; terms: SavedMonthlyTerms[]; fingerprints: Record<string,string>; links:IdentityLink[] };

export default function BillingObligationsReview() {
  const isAdmin = AuthService.getCurrentUser()?.role === 'admin';
  const [selected,setSelected] = useState<ObligationReviewRow | null>(null);
  const [editingLink,setEditingLink]=useState<IdentityLink|undefined>(undefined);
  const [message,setMessage] = useState('');
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
    setLoading(true); setSelected(null); setData(null); setError(''); setPage(1);
    try {
      if (!user) throw new Error('Entre novamente para consultar as fontes.');
      const [financial, checklist, persisted] = await Promise.all([BillingReviewService.fetch(), fetchChecklistReview(controller.signal), fetchSavedBillingReview(month)]);
      if (version !== request.current) return;
      if (controller.signal.aborted) throw new Error('Leitura não concluída no prazo.');
      if (auth.currentUser !== user) throw new Error('Sessão alterada durante a consulta.');
      const review=buildBillingObligations(financial.transactions, checklist.records, month, field,persisted.links);
      const fingerprints=Object.fromEntries(await Promise.all(review.rows.map(async row=>[row.identity,await fingerprintMonthlyRow(row,month,field)])));
      if(version!==request.current||auth.currentUser!==user)return;
      setData({ review, terms:persisted.terms, fingerprints, links:persisted.links,
        financialReadAt: financial.readTime, checklistReadAt: checklist.readAt, documentCount: financial.documentCount });
    } catch (failure) {
      if (version === request.current) setError(controller.signal.aborted ? 'Leitura não concluída no prazo. Consulte novamente.' : failure instanceof Error ? failure.message : 'Não foi possível cruzar as fontes.');
    } finally {
      clearTimeout(timeout); controller.abort();
      if (version === request.current) { setLoading(false); pending.current = null; }
    }
  };
  const changePeriod = () => { request.current++; pending.current?.abort(); setLoading(false); setSelected(null); setData(null); setError(''); setPage(1); };
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
    {message && <p role="status" className="text-green-700 dark:text-green-300">{message}</p>}
    {error && <p role="alert" className="text-red-700 dark:text-red-300">Lista indisponível: {error} Nenhuma lista parcial foi apresentada.</p>}
    {data && <>
      <p className="text-xs text-slate-500">Comparação {data.review.previousMonth} → {data.review.targetMonth}. Financeiro: {data.documentCount.toLocaleString('pt-BR')} registros, leitura em {time(data.financialReadAt)}. Checklist: {data.review.checklistRecords.toLocaleString('pt-BR')} respostas, leitura em {time(data.checklistReadAt)} (Brasília). As duas fontes têm horários próprios; atualize após alterações.</p>
      <p className="text-sm"><strong>{data.review.linkedChecklistRecords} / {data.review.checklistRecords}</strong> respostas vinculadas a itens com lançamento em algum dos dois meses. Esta métrica mede a associação das fontes, não a cobertura contratual.</p>
      <details className="text-sm"><summary>Revisões sem item correspondente nesta leitura</summary>{data.terms.filter(term=>!data.fingerprints[term.identity]).map(term=><p key={term.identity}>{term.client} • {term.identity} • revisão {term.revision}. Decisão histórica: {term.decision==='charge'?'obrigação confirmada':'revisão pendente'}. Evidência: {term.evidence}. Revalidar identificação e vigência; este registro não foi descartado.</p>)}</details>
      <details className="text-sm"><summary>{data.links.length} vínculos comprovados registrados</summary>{data.links.map(link=><p key={link.sourceIdentity}>{link.sourceIdentity} → {link.targetIdentity} • revisão {link.revision}. {link.evidence} {isAdmin&&<button className="underline" onClick={()=>{setEditingLink(link);setSelected({identity:link.sourceIdentity,client:'Vínculo de identificação',previousAmount:0,currentAmount:0,previousIds:[],currentIds:[],checklist:[],issues:[],situation:'identificacao'});}}>Revisar vínculo</button>}</p>)}</details>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">{Object.entries(data.review.counts).map(([key,count]) => <p key={key}><strong>{count}</strong> {obligationSituationLabels[key as ObligationSituation]}</p>)}</div>
      <p className="text-sm"><strong>{data.terms.filter(term=>term.decision==='charge'&&term.sourceFingerprint===data.fingerprints[term.identity]).length}</strong> obrigações confirmadas com fontes correspondentes; <strong>{data.terms.filter(term=>term.sourceFingerprint!==data.fingerprints[term.identity]).length}</strong> revisões que exigem revalidação ou não aparecem mais na lista.</p>
      <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">Lista preparatória: uma resposta histórica não comprova contrato vigente no mês. STATUS de saída ou suspensão não aprova dispensa nem elimina saldos. Lançamento localizado não comprova boleto emitido ou enviado. O mês permanece sem validação para fechamento.</p>
      {data.review.sourceIssues.length > 0 && <details className="text-sm text-red-700 dark:text-red-300"><summary>{data.review.sourceIssues.length} lançamentos com datas ausentes ou inválidas</summary><ul>{data.review.sourceIssues.slice(0,100).map((issue,i) => <li key={i}>{issue}</li>)}</ul><p>A lista mostra os primeiros 100 problemas. Esses registros não comprovam presença em nenhum dos dois meses.</p></details>}
      <div className="flex flex-wrap gap-3"><label className="text-sm">Buscar cliente ou identificação<input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="block border rounded p-2 dark:bg-slate-950" /></label><label className="text-sm">Situação<select value={situation} onChange={e => { setSituation(e.target.value as ObligationSituation | ''); setPage(1); }} className="block border rounded p-2 dark:bg-slate-950"><option value="">Todas</option>{Object.entries(obligationSituationLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Cliente</th><th className="p-2">Referência anterior</th><th className="p-2">Lançamentos atuais</th><th className="p-2">Checklist por STATUS</th><th className="p-2">Situação e conferência</th></tr></thead><tbody>{rows.slice((page-1)*20,page*20).map(row => <tr key={row.identity} className="border-t border-slate-200 dark:border-slate-700">
        <td className="p-2">{row.client}<span className="block text-xs">{row.identity}</span></td>
        <td className="p-2">{money(row.previousAmount)}<span className="block text-xs">{row.previousIds.length} lançamento(s)</span></td>
        <td className="p-2">{money(row.currentAmount)}<span className="block text-xs">{row.currentIds.length} lançamento(s)</span></td>
        <td className="p-2">{row.checklist.length ? row.checklist.map(record => <details key={record.submissionId} className="mb-2"><summary>{checklistEventLabels[checklistEvent(record.status)]} • resposta {record.submissionId}</summary><p>STATUS: {record.status || 'Ausente'}</p><p>Honorários no campo: {record.amount == null ? 'Conferir nas observações' : money(record.amount)}</p><p>Cadastrada em: {record.sourceCreatedAt || 'Não informado'} — conferir vigência.</p><p className="whitespace-pre-wrap max-w-xl">{readableChecklistNotes(record.notes)}</p></details>) : 'Sem resposta vinculada'}</td>
        <td className="p-2"><strong>{obligationSituationLabels[row.situation]}</strong><p>{(()=>{const saved=data.terms.find(t=>t.identity===row.identity);return !saved?'Sem conferência salva':saved.sourceFingerprint!==data.fingerprints[row.identity]?'Fontes alteradas — revalidar':saved.decision==='charge'?'Obrigação confirmada':'Revisão pendente salva';})()}</p><button type="button" className="text-blue-700 dark:text-blue-300 underline" onClick={()=>{setEditingLink(undefined);setSelected(row);}}>{row.situation==='identificacao'?'Conferir identificação':'Registrar conferência'}</button><details><summary>O que conferir</summary><ul className="list-disc pl-4">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>IDs financeiros anteriores: {row.previousIds.join(', ') || 'Nenhum'}<br/>IDs financeiros atuais: {row.currentIds.join(', ') || 'Nenhum'}</p></details></td>
      </tr>)}</tbody></table></div>
      {!rows.length && <p className="text-sm">Nenhum item neste filtro. Isso não comprova ausência de obrigações.</p>}
      <div className="flex gap-3 text-sm"><button disabled={page <= 1} onClick={() => setPage(p => p-1)}>Anterior</button><span>{rows.length} item(ns) • página {page} de {Math.max(1,Math.ceil(rows.length/20))}</span><button disabled={page*20 >= rows.length} onClick={() => setPage(p => p+1)}>Próxima</button></div>
    </>}
    {selected&&data&&<BillingConfirmationDialog key={selected.identity} row={selected} month={data.review.targetMonth} fingerprint={data.fingerprints[selected.identity]||''} saved={data.terms.find(t=>t.identity===selected.identity)} isAdmin={isAdmin} savedLink={editingLink} verifyCurrent={editingLink?undefined:async()=>{const [financial,checklist,persisted]=await Promise.all([BillingReviewService.fetch(),fetchChecklistReview(AbortSignal.timeout(180000)),fetchSavedBillingReview(data.review.targetMonth)]);const fresh=buildBillingObligations(financial.transactions,checklist.records,data.review.targetMonth,field,persisted.links).rows.find(row=>row.identity===selected.identity);if(!fresh||await fingerprintMonthlyRow(fresh,data.review.targetMonth,field)!==data.fingerprints[selected.identity])throw new Error('Fontes alteradas. Recarregue a lista antes de registrar a conferência.');}} onClose={()=>setSelected(null)} onSaved={()=>{setSelected(null);setMessage('Revisão registrada com responsável e histórico. Recarregando fontes.');void load();}}/>}
  </section>;
}
