import React from 'react';
import { Timer, RefreshCw, Filter, Printer, Download, MessageCircle } from 'lucide-react';
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
            {isAdmin && <div role="group" aria-label="Lançamentos e recorrências" className="flex flex-wrap items-center gap-3">
            {isAdmin && <><button className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm" onClick={() => onNewReceivable()}>Nova conta a receber</button><button className="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm" onClick={() => onNewPayable()}>Nova conta a pagar</button><button className="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm" onClick={() => onRecurrences()}>Recorrências a pagar</button></>}
            </div>}
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
