import React from 'react';
import { Timer, RefreshCw, Filter, Printer, Download, MessageCircle, ArrowUpCircle, ArrowDownCircle, CalendarClock, Plus } from 'lucide-react';
interface Props {
 title: string; isAdmin: boolean; lastUpdated: Date | null; refreshCountdown: number;
 isRefreshing: boolean; hasFilters: boolean; filtersOpen: boolean;
 onNewReceivable: () => void; onNewPayable: () => void; onRecurrences: () => void;
 onRefresh: () => void; onFilters: () => void; onPrint: () => void;
 onExport: () => void; onWhatsApp: () => void;
}
export default function DashboardToolbar({title,isAdmin,lastUpdated,refreshCountdown,isRefreshing,hasFilters,filtersOpen,onNewReceivable,onNewPayable,onRecurrences,onRefresh,onFilters,onPrint,onExport,onWhatsApp}: Props) {
 return (
        <section aria-label="Ações do painel" className="space-y-4 print:hidden">
          <div className="print:hidden">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
            <p className="text-slate-500 dark:text-slate-400">Movimentos do período selecionado. Os saldos em aberto e o acumulado histórico permanecem no resumo acima.</p>
          </div>
          
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
            {isAdmin && (
              <div role="group" aria-label="Lançamentos e recorrências" className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button type="button" aria-label="Nova conta a receber" onClick={onNewReceivable}
                  className="group flex min-h-28 items-center gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-left text-blue-950 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-50 dark:hover:bg-blue-900/60 dark:focus-visible:ring-offset-slate-900">
                  <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white" aria-hidden="true">
                    <ArrowUpCircle className="h-7 w-7" /><Plus className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-blue-800 p-0.5 ring-2 ring-blue-50 dark:ring-blue-950" />
                  </span>
                  <span className="min-w-0"><span className="block text-base font-semibold leading-6">Nova conta a receber</span><span className="mt-1 block text-sm leading-5 text-blue-800 dark:text-blue-200">Cadastrar uma receita</span></span>
                </button>
                <button type="button" aria-label="Nova conta a pagar" onClick={onNewPayable}
                  className="group flex min-h-28 items-center gap-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-left text-rose-950 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-50 dark:hover:bg-rose-900/60 dark:focus-visible:ring-offset-slate-900">
                  <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white" aria-hidden="true">
                    <ArrowDownCircle className="h-7 w-7" /><Plus className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-rose-800 p-0.5 ring-2 ring-rose-50 dark:ring-rose-950" />
                  </span>
                  <span className="min-w-0"><span className="block text-base font-semibold leading-6">Nova conta a pagar</span><span className="mt-1 block text-sm leading-5 text-rose-800 dark:text-rose-200">Cadastrar uma despesa</span></span>
                </button>
                <button type="button" aria-label="Recorrências a pagar" onClick={onRecurrences}
                  className="group flex min-h-28 items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-left text-violet-950 transition-colors hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-50 dark:hover:bg-violet-900/60 dark:focus-visible:ring-offset-slate-900">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white" aria-hidden="true"><CalendarClock className="h-7 w-7" /></span>
                  <span className="min-w-0"><span className="block text-base font-semibold leading-6">Recorrências a pagar</span><span className="mt-1 block text-sm leading-5 text-violet-800 dark:text-violet-200">Gerenciar despesas recorrentes</span></span>
                </button>
              </div>
            )}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div role="group" aria-label="Consulta e filtros" className="flex flex-wrap items-center gap-3">
            {/* REFRESH INDICATOR */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-500 dark:text-slate-400">
              <Timer className="h-3.5 w-3.5" />
              {lastUpdated ? (
                <span>
                  Atualizado: {lastUpdated.toLocaleTimeString('pt-BR')}
                  <span className="ml-1.5 text-blue-500 dark:text-blue-400 font-medium">
                    ({refreshCountdown}s)
                  </span>
                </span>
              ) : (
                <span>Carregando...</span>
              )}
            </div>

            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors text-sm
                ${isRefreshing 
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-500 cursor-not-allowed' 
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-600 dark:hover:text-blue-400'
                }`}
              title="Atualizar dados agora"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
            </button>

            <button
              onClick={onFilters}
              aria-expanded={filtersOpen}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors text-sm
                ${hasFilters 
                  ? 'bg-white dark:bg-slate-800 border-blue-500 text-blue-600 dark:text-blue-400' 
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              <Filter className="h-4 w-4" />
              <span>Filtros</span>
            </button>

            </div>
            <div role="group" aria-label="Relatórios e compartilhamento" className="flex flex-wrap items-center gap-3 lg:border-l lg:border-slate-200 lg:dark:border-slate-700 lg:pl-4">
            <button
              onClick={onPrint}
              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
            >
              <Printer className="h-4 w-4" />
              <span>Imprimir</span>
            </button>

             <button
              onClick={onExport}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 dark:bg-slate-700 text-white border border-slate-800 dark:border-slate-700 rounded-lg hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors text-sm"
            >
              <Download className="h-4 w-4" />
              <span>Exportar</span>
            </button>

             <button
              onClick={onWhatsApp}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white border border-green-600 rounded-lg hover:bg-green-700 transition-colors text-sm"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="inline">WhatsApp</span>
            </button>
            </div>
            </div>
          </div>
        </section>

 );
}
