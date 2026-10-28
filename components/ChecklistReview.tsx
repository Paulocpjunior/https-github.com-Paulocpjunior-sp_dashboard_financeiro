import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChecklistReview as Review, checklistLoaders, type ChecklistSource } from '../services/checklistReviewService';
import { readableChecklistNotes } from '../utils/checklistNotes';
import { checklistEvent, checklistEventLabels, checklistEventGuidance, checklistStatusDates } from '../utils/checklistStatus';

const copy: Record<ChecklistSource, { heading: string; intro: string[]; idle: string; busy: string; unavailable: string; warning: string; empty: string; row: string; noAmount: string }> = {
  legal: {
    heading: 'Checklist do Legal — leitura e conferência',
    intro: ['Leitura somente consulta do checklist do app Legalização, pelo cadastro do CFI. O formulário do Jotform não é mais lido: cada empresa aparece uma vez, com os dados atuais do Legal.',
      'O STATUS define o evento de cada empresa: entrada, saída, alteração ou suspensão. Datas incompatíveis com esse evento ficam apenas nos dados originais. Honorários, início da responsabilidade, dia de cobrança e última cobrança nas observações precisam de conferência humana.'],
    idle: 'Consultar checklist completo', busy: 'Lendo e validando o checklist...', unavailable: 'Checklist indisponível',
    warning: 'Leitura completa não comprova contrato validado, cliente ainda ativo, cobrança emitida ou dispensa aprovada. O STATUS pode registrar um evento histórico, não o estado atual do contrato. Pendência de campo não comprova erro de cadastro. Datas de saída ou suspensão em uma entrada não autorizam interromper cobrança. Nenhuma cobrança é criada por esta consulta.',
    empty: 'Nenhuma empresa neste filtro.', row: 'Item', noAmount: 'Conferir nas observações',
  },
  registry: {
    heading: 'Cadastro financeiro — conferência contratual',
    intro: ['Consulta direta aos cadastros salvos no Firestore, sem acesso ao Jotform. O histórico de lançamentos permanece disponível no Financeiro.',
      'Cadastros e perfis de faturamento são referências operacionais. Eles não comprovam, sozinhos, entrada, saída, suspensão, honorários ou vigência contratual. Essas informações permanecem pendentes quando não estão confirmadas.'],
    idle: 'Consultar cadastros no Firestore', busy: 'Consultando Firestore...', unavailable: 'Cadastros indisponíveis',
    warning: 'Leitura completa dos cadastros não comprova contrato validado, cliente ainda ativo, cobrança emitida ou dispensa aprovada. Cadastros inativos não autorizam interromper cobrança. Nenhuma cobrança é criada por esta consulta.',
    empty: 'Nenhum cadastro neste filtro.', row: 'Registro', noAmount: 'Não confirmado',
  },
};

const displayDate = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Não informada';

export default function ChecklistReview({ source = 'legal', loadReview = checklistLoaders[source] }: { source?: ChecklistSource; loadReview?: (signal: AbortSignal) => Promise<Review> } = {}) {
  const text = copy[source];
  const headingId = `checklist-heading-${source}`;
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const load = async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);
    setLoading(true); setReview(null); setError(''); setPage(1);
    try { const data = await loadReview(controller.signal); if (!controller.signal.aborted) setReview(data); }
    catch (failure) { if (pending.current === controller) setError(controller.signal.aborted ? 'Leitura não concluída no prazo. Consulte novamente.' : failure instanceof Error ? failure.message : 'Checklist indisponível.'); }
    finally { clearTimeout(timeout); if (pending.current === controller) { pending.current = null; setLoading(false); } }
  };
  const matches = useMemo(() => review?.records.filter(row => `${row.client || ''} ${row.clientNumber || ''} ${row.identity}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) || [], [review, search]);
  const events = useMemo(() => {
    const counts = { entrada: 0, saida: 0, alteracao: 0, suspensao: 0, pendente: 0 };
    review?.records.forEach(row => counts[checklistEvent(row.status)]++);
    return counts;
  }, [review]);
  return <section className="rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 p-5 space-y-4" aria-labelledby={headingId}>
    <h2 id={headingId} className="text-lg font-bold">{text.heading}</h2>
    {text.intro.map(line => <p key={line} className="text-sm">{line}</p>)}
    <button type="button" disabled={loading} onClick={load} className="bg-blue-700 text-white rounded-lg px-4 py-2 disabled:opacity-50">{loading ? text.busy : text.idle}</button>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{text.unavailable}: {error} Nenhum fechamento foi liberado.</p>}
    {review && <>
      <p className="text-xs text-slate-500">Leitura completa em {new Date(review.readAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília). Atualize após alterações na fonte.</p>
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <p><strong>{review.received} / {review.expected}</strong> documentos consultados / recebidos</p>
        <p><strong>{review.validRecords}</strong> registros sem divergência de campos</p>
        <p><strong>{review.conflictRecords}</strong> registros que precisam de conferência</p>
        <p><strong>{review.observationsToReview}</strong> observações a conferir</p>
        <p><strong>{review.active}</strong> registros incluídos na consulta</p>
        <p><strong>{review.excluded}</strong> registros excluídos da consulta</p>
      </div>
      <div className="flex flex-wrap gap-4 text-sm" aria-label="Registros por evento contratual informado">{Object.entries(events).map(([event, count]) => <span key={event}><strong>{count}</strong> {checklistEventLabels[event as keyof typeof checklistEventLabels]}</span>)}</div>
      <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">{text.warning}</p>
      <label className="block text-sm">Localizar cliente ou número<input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="block border rounded p-2 dark:bg-slate-950" /></label>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Cliente</th><th className="p-2">Honorários</th><th className="p-2">Evento contratual</th><th className="p-2">Conferência e observações</th></tr></thead><tbody>
        {matches.slice((page-1)*20, page*20).map(row => {
          const dates = checklistStatusDates(row);
          return <tr key={row.submissionId} className="border-t border-slate-200 dark:border-slate-700">
          <td className="p-2">{row.client || 'Nome ausente'}<span className="block text-xs">{row.identity || 'Identificação pendente'}</span><span className="block text-xs">{text.row} {row.submissionId} • {row.status || 'Status não informado'}</span></td>
          <td className="p-2">{row.amount == null ? text.noAmount : row.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
          <td className="p-2"><strong>{checklistEventLabels[dates.event]}</strong><br/>{dates.event === 'entrada' && <>Cadastro: {displayDate(dates.registrationDate)}<br/>Início da responsabilidade: conferir observações.</>}{dates.event === 'saida' && <>Saída informada: {displayDate(dates.exitDate)}</>}{dates.event === 'suspensao' && <>Suspensão informada: {displayDate(dates.suspensionDate)}</>}{dates.event === 'alteracao' && <>Vigência: conferir observações.</>}{dates.event === 'pendente' && <>Informação contratual pendente.</>}</td>
          <td className="p-2"><p>{checklistEventGuidance[dates.event]}</p><details><summary>Conferência dos campos originais</summary><p>{row.issues.join('; ') || 'Campos lidos; contrato ainda precisa de validação.'}</p><p>Cadastro: {displayDate(row.entryDate)}<br/>Saída: {displayDate(row.exitDate)}<br/>Suspensão: {displayDate(row.suspensionDate)}</p><p>Datas contratuais não confirmadas permanecem sem preenchimento.</p></details><details><summary>Instruções operacionais da fonte</summary><p className="whitespace-pre-wrap max-w-xl">{readableChecklistNotes(row.notes)}</p></details></td>
        </tr>; })}
      </tbody></table></div>
      {!matches.length && <p className="text-sm">{text.empty}</p>}
      <div className="flex items-center gap-3 text-sm"><button disabled={page <= 1} onClick={() => setPage(p => p-1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(matches.length/20))}</span><button disabled={page*20 >= matches.length} onClick={() => setPage(p => p+1)}>Próxima</button></div>
    </>}
  </section>;
}
