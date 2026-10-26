import '../design-system/tokens.css';
import './FinancialToolbar.css';
import React from 'react';
import { Link } from 'react-router-dom';
import { Timer, RefreshCw, Filter, Printer, Download, MessageCircle, ArrowUpCircle, ArrowDownCircle, CalendarClock } from 'lucide-react';
interface Props {
 title: string; description?: string; entryActions?: boolean; isAdmin: boolean; canCreateEntries?: boolean; canRecurrences?: boolean; lastUpdated: Date | null; refreshCountdown: number;
 isRefreshing: boolean; hasFilters: boolean; filtersOpen: boolean;
 onNewReceivable: () => void; onNewPayable: () => void; onRecurrences: () => void;
 onRefresh: () => void; onFilters: () => void; onPrint: () => void;
 onExport: () => void; onWhatsApp: () => void;
}
export default function DashboardToolbar({title,description,entryActions = true,isAdmin,canCreateEntries = isAdmin,canRecurrences = isAdmin,lastUpdated,refreshCountdown,isRefreshing,hasFilters,filtersOpen,onNewReceivable,onNewPayable,onRecurrences,onRefresh,onFilters,onPrint,onExport,onWhatsApp}: Props) {
 return (
        <section aria-label="Ações do painel" className="sp-ui sp-finance-toolbar space-y-4 print:hidden">
          <div className="print:hidden">
            <h1 className="sp-toolbar-title">{title}</h1>
            <p className="sp-muted">{description || 'Movimentos do período selecionado. Os saldos em aberto e o acumulado histórico permanecem no resumo acima.'}</p>
          </div>
          
          <div className="sp-card space-y-4">
            {entryActions && (canCreateEntries || canRecurrences) && (
              <div role="group" aria-label="Lançamentos e recorrências" className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {canCreateEntries && <><button type="button" aria-label="Nova conta a receber" onClick={onNewReceivable}
                  className="sp-entry-action">
                  <span className="sp-entry-icon" aria-hidden="true">
                    <ArrowUpCircle className="h-7 w-7" />
                  </span>
                  <span className="min-w-0"><span className="block text-base font-semibold leading-6">Nova conta a receber</span><span className="sp-muted mt-1 block text-sm leading-5">Cadastrar uma receita</span></span>
                </button>
                <button type="button" aria-label="Nova conta a pagar" onClick={onNewPayable}
                  className="sp-entry-action">
                  <span className="sp-entry-icon" aria-hidden="true">
                    <ArrowDownCircle className="h-7 w-7" />
                  </span>
                  <span className="min-w-0"><span className="block text-base font-semibold leading-6">Nova conta a pagar</span><span className="sp-muted mt-1 block text-sm leading-5">Cadastrar uma despesa</span></span>
                </button>
                </>}
                {canRecurrences && <button type="button" aria-label="Recorrências a pagar" onClick={onRecurrences}
                  className="sp-entry-action">
                  <span className="sp-entry-icon" aria-hidden="true"><CalendarClock className="h-7 w-7" /></span>
                  <span className="min-w-0"><span className="block text-base font-semibold leading-6">Recorrências a pagar</span><span className="sp-muted mt-1 block text-sm leading-5">Gerenciar despesas recorrentes</span></span>
                </button>}
              </div>
            )}
            {!entryActions && <div className="flex flex-wrap items-center justify-between gap-3"><p className="sp-muted text-sm">Para cadastrar ou gerenciar contas, acesse Lançamentos.</p><Link to="/lancamentos" className="sp-button sp-button-primary">Ir para Lançamentos</Link></div>}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div role="group" aria-label="Consulta e filtros" className="flex flex-wrap items-center gap-3">
            {/* REFRESH INDICATOR */}
            <div className="sp-refresh-status sp-muted">
              <Timer className="h-3.5 w-3.5" />
              {lastUpdated ? (
                <span>
                  Atualizado: {lastUpdated.toLocaleTimeString('pt-BR')}
                  <span className="ml-1.5 font-medium">
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
              className="sp-button"
              title="Atualizar dados agora"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
            </button>

            <button
              onClick={onFilters}
              aria-expanded={filtersOpen}
              type="button"
              className="sp-button sp-button-primary"
            >
              <Filter className="h-4 w-4" />
              <span>Filtros</span>{hasFilters && <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs">Ativos</span>}
            </button>

            </div>
            <div role="group" aria-label="Relatórios e compartilhamento" className="flex flex-wrap items-center gap-3 lg:border-l lg:border-slate-200 lg:dark:border-slate-700 lg:pl-4">
            <button
              onClick={onPrint}
              className="sp-button"
            >
              <Printer className="h-4 w-4" />
              <span>Imprimir</span>
            </button>

             <button
              onClick={onExport}
              className="sp-button"
            >
              <Download className="h-4 w-4" />
              <span>Exportar</span>
            </button>

             <button
              onClick={onWhatsApp}
              className="sp-button"
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
