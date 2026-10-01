import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChecklistReview as Review, fetchChecklistReview } from '../services/checklistReviewService';

export default function ChecklistReview() {
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
    try { const data = await fetchChecklistReview(controller.signal); if (!controller.signal.aborted) setReview(data); }
    catch (failure) { if (pending.current === controller) setError(controller.signal.aborted ? 'Leitura não concluída no prazo. Consulte novamente.' : failure instanceof Error ? failure.message : 'Checklist indisponível.'); }
    finally { clearTimeout(timeout); if (pending.current === controller) { pending.current = null; setLoading(false); } }
  };
  const matches = useMemo(() => review?.records.filter(row => `${row.client || ''} ${row.clientNumber || ''} ${row.identity}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) || [], [review, search]);
  return <section className="rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 p-5 space-y-4" aria-labelledby="checklist-heading">
    <h2 id="checklist-heading" className="text-lg font-bold">Checklist contratual — leitura e conferência</h2>
    <p className="text-sm">Consulta o Check List Atual 2026 sem alterar respostas ou lançamentos. Dia de cobrança e última cobrança estão nas observações e precisam de conferência humana; não são inferidos automaticamente.</p>
    <button type="button" disabled={loading} onClick={load} className="bg-blue-700 text-white rounded-lg px-4 py-2 disabled:opacity-50">{loading ? 'Lendo e validando o checklist...' : 'Consultar checklist completo'}</button>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">Checklist indisponível: {error} Nenhum fechamento foi liberado.</p>}
    {review && <>
      <p className="text-xs text-slate-500">Leitura completa em {new Date(review.readAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília). Atualize após alterações na fonte.</p>
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <p><strong>{review.received} / {review.expected}</strong> respostas recebidas / esperadas</p>
        <p><strong>{review.validRecords}</strong> registros sem divergência de campos</p>
        <p><strong>{review.conflictRecords}</strong> registros com pendências</p>
        <p><strong>{review.observationsToReview}</strong> observações a conferir</p>
        <p><strong>{review.active}</strong> respostas ativas na fonte</p>
        <p><strong>{review.excluded}</strong> respostas fora do status ACTIVE</p>
      </div>
      <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">Leitura completa não comprova contrato validado, cliente ainda ativo, cobrança emitida ou dispensa aprovada. Respostas repetidas e datas divergentes permanecem pendentes. Nenhuma cobrança é criada por esta consulta.</p>
      <label className="block text-sm">Localizar cliente ou número<input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="block border rounded p-2 dark:bg-slate-950" /></label>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Cliente</th><th className="p-2">Honorários</th><th className="p-2">Datas informadas</th><th className="p-2">Conferência e observações</th></tr></thead><tbody>
        {matches.slice((page-1)*20, page*20).map(row => <tr key={row.submissionId} className="border-t border-slate-200 dark:border-slate-700">
          <td className="p-2">{row.client || 'Nome ausente'}<span className="block text-xs">{row.identity || 'Identificação pendente'}</span><span className="block text-xs">Resposta {row.submissionId} • {row.status || 'Status não informado'}</span></td>
          <td className="p-2">{row.amount == null ? 'Revisar' : row.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
          <td className="p-2">Entrada: {row.entryDate || 'Não confirmada'}<br/>Saída: {row.exitDate || 'Não confirmada'}<br/>Suspensão: {row.suspensionDate || 'Não confirmada'}</td>
          <td className="p-2">{row.issues.join('; ') || 'Campos lidos; contrato ainda precisa de validação.'}<details><summary>Observações da fonte</summary><p className="whitespace-pre-wrap max-w-xl">{row.notes || 'Sem observações.'}</p></details></td>
        </tr>)}
      </tbody></table></div>
      {!matches.length && <p className="text-sm">Nenhuma resposta neste filtro.</p>}
      <div className="flex items-center gap-3 text-sm"><button disabled={page <= 1} onClick={() => setPage(p => p-1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(matches.length/20))}</span><button disabled={page*20 >= matches.length} onClick={() => setPage(p => p+1)}>Próxima</button></div>
    </>}
  </section>;
}
