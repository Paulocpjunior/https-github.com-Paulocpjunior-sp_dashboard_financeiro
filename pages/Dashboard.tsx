
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import KpiCard from '../components/KpiCard';
import DataTable from '../components/DataTable';
import AIAssistant from '../components/AIAssistant';
import { DataService } from '../services/dataService';
import { FilterState, KPIData, Transaction } from '../types';
import { ArrowDown, ArrowUp, DollarSign, Download, Filter, Search, Loader2, XCircle, Printer, MessageCircle, Calendar, Clock, CheckCircle, ChevronDown, ChevronUp, RefreshCw, Timer, Layers, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

const INITIAL_FILTERS: FilterState = {
  id: '',
  startDate: '',
  endDate: '',
  dueDateStart: '',
  dueDateEnd: '',
  paymentDateStart: '',
  paymentDateEnd: '',
  receiptDateStart: '',
  receiptDateEnd: '',
  bankAccount: '',
  type: '',
  status: '',
  client: '',
  paidBy: '',
  movement: '',
  search: '',
};

// Função para normalizar texto (remove acentos)
const normalizeText = (text: string) => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

const Dashboard: React.FC = () => {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Transaction[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [kpi, setKpi] = useState<KPIData>({ totalPaid: 0, totalReceived: 0, balance: 0 });
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [showAdvancedDates, setShowAdvancedDates] = useState(false);
  const [activePeriod, setActivePeriod] = useState<string>('thisMonth');
  
  // Dynamic Options derived from Data
  const [options, setOptions] = useState({
    bankAccounts: [] as string[],
    types: [] as string[],
    statuses: [] as string[],
    movements: [] as string[],
    clients: [] as string[],
    paidBys: [] as string[],
  });

  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState('');

  // Refresh States
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshCountdown, setRefreshCountdown] = useState(60); // segundos até próximo refresh

  // Detecta se está no modo "Contas a Pagar" (Saída) ou "Receber" (Entrada)
  const normalizedType = normalizeText(filters.type || '');
  const isContasAPagar = normalizedType.includes('saida') || 
                        normalizedType.includes('pagar') ||
                        normalizedType.includes('fornecedor') ||
                        normalizedType.includes('aluguel') ||
                        filters.movement === 'Saída';

  const isContasAReceber = normalizedType.includes('entrada') || 
                          normalizedType.includes('receber') ||
                          normalizedType.includes('servico') ||
                          filters.movement === 'Entrada';

  // Initial Data Load
  useEffect(() => {
    const load = async () => {
      try {
        await DataService.loadData();
        
        // Populate filter options dynamically from the loaded data
        setOptions({
          bankAccounts: DataService.getUniqueValues('bankAccount'),
          types: DataService.getUniqueValues('type'),
          statuses: DataService.getUniqueValues('status'),
          movements: DataService.getUniqueValues('movement'),
          clients: DataService.getUniqueValues('client'),
          paidBys: DataService.getUniqueValues('paidBy'),
        });

        // Registrar timestamp da primeira carga
        setLastUpdated(DataService.getLastUpdatedAt());

        // Aplicar filtro "Este Mês" por padrão
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        
        const initialFilters = {
          ...INITIAL_FILTERS,
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        };
        
        setFilters(initialFilters);

        // Initial fetch
        const { result, kpi: newKpi } = DataService.getTransactions(initialFilters, page);
        setData(result.data);
        setTotalPages(result.totalPages);
        setKpi(newKpi);
      } catch (e: any) {
        setInitError(e.message || 'Erro ao conectar com o Banco de Dados Oficial.');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Auto-refresh: Ativar timer de 1 minuto ao montar, parar ao desmontar
  useEffect(() => {
    if (isLoading || initError) return;

    // Listener que recarrega dados quando o auto-refresh atualiza o cache
    const unsubscribe = DataService.onRefresh(() => {
      setLastUpdated(DataService.getLastUpdatedAt());
      setRefreshCountdown(60);
      
      // Atualizar opções de filtro
      setOptions({
        bankAccounts: DataService.getUniqueValues('bankAccount'),
        types: DataService.getUniqueValues('type'),
        statuses: DataService.getUniqueValues('status'),
        movements: DataService.getUniqueValues('movement'),
        clients: DataService.getUniqueValues('client'),
        paidBys: DataService.getUniqueValues('paidBy'),
      });
    });

    // Iniciar auto-refresh
    DataService.startAutoRefresh();

    return () => {
      unsubscribe();
      DataService.stopAutoRefresh();
    };
  }, [isLoading, initError]);

  // Countdown visual: atualiza a cada segundo
  useEffect(() => {
    if (isLoading || initError) return;
    
    const countdownTimer = setInterval(() => {
      setRefreshCountdown(prev => (prev <= 1 ? 60 : prev - 1));
    }, 1000);

    return () => clearInterval(countdownTimer);
  }, [isLoading, initError]);

  // Refresh manual
  const handleManualRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await DataService.refreshCache();
      setLastUpdated(DataService.getLastUpdatedAt());
      setRefreshCountdown(60);
      
      // Recarregar dados com filtros atuais
      const { result, kpi: newKpi } = DataService.getTransactions(filters, page);
      setData(result.data);
      setTotalPages(result.totalPages);
      setKpi(newKpi);

      // Atualizar opções de filtro
      setOptions({
        bankAccounts: DataService.getUniqueValues('bankAccount'),
        types: DataService.getUniqueValues('type'),
        statuses: DataService.getUniqueValues('status'),
        movements: DataService.getUniqueValues('movement'),
        clients: DataService.getUniqueValues('client'),
        paidBys: DataService.getUniqueValues('paidBy'),
      });
    } catch (e) {
      console.error('Erro no refresh manual:', e);
    } finally {
      setIsRefreshing(false);
    }
  }, [filters, page, isRefreshing]);

  // Handle Filter Changes
  useEffect(() => {
    if (!isLoading && !initError) {
      const { result, kpi: newKpi } = DataService.getTransactions(filters, page);
      setData(result.data);
      setTotalPages(result.totalPages);
      setKpi(newKpi);
    }
  }, [filters, page, isLoading, initError]);

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => {
      const updated = { ...prev, [key]: value };
      
      // Detectar se a nova combinação é Contas a Pagar ou Contas a Receber
      const newNormalizedType = normalizeText(updated.type || '');
      const newIsContasMode = newNormalizedType.includes('saida') || 
                              newNormalizedType.includes('pagar') ||
                              newNormalizedType.includes('fornecedor') ||
                              newNormalizedType.includes('aluguel') ||
                              updated.movement === 'Saída' ||
                              newNormalizedType.includes('entrada') || 
                              newNormalizedType.includes('receber') ||
                              newNormalizedType.includes('servico') ||
                              updated.movement === 'Entrada';

      const wasContasMode = isContasAPagar || isContasAReceber;

      // Migrar datas automaticamente ao entrar/sair do modo Contas a Pagar/Receber
      if (key === 'type' || key === 'movement') {
        if (newIsContasMode && !wasContasMode) {
          // Entrando no modo Contas — mover startDate/endDate → dueDateStart/dueDateEnd
          if (updated.startDate || updated.endDate) {
            updated.dueDateStart = updated.startDate;
            updated.dueDateEnd = updated.endDate;
            updated.startDate = '';
            updated.endDate = '';
          }
        } else if (!newIsContasMode && wasContasMode) {
          // Saindo do modo Contas — mover dueDateStart/dueDateEnd → startDate/endDate
          if (updated.dueDateStart || updated.dueDateEnd) {
            updated.startDate = updated.dueDateStart || '';
            updated.endDate = updated.dueDateEnd || '';
            updated.dueDateStart = '';
            updated.dueDateEnd = '';
          }
        }
      }

      return updated;
    });
    setPage(1); // Reset to page 1 on filter change
  };

  const clearFilters = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    setFilters({
      ...INITIAL_FILTERS,
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0]
    });
    setActivePeriod('thisMonth');
    setPage(1);
  };

  const applyViewMode = (mode: 'general' | 'payables' | 'receivables') => {
      const now = new Date();
      // Padrão: Mês atual
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      
      setActivePeriod('thisMonth');

      if (mode === 'payables') {
          setFilters(prev => ({
              ...INITIAL_FILTERS,
              movement: 'Saída',
              status: 'Pendente',
              dueDateStart: start,
              dueDateEnd: end
          }));
      } else if (mode === 'receivables') {
          setFilters(prev => ({
              ...INITIAL_FILTERS,
              movement: 'Entrada',
              status: 'Pendente',
              dueDateStart: start,
              dueDateEnd: end
          }));
      } else {
          setFilters(prev => ({
              ...INITIAL_FILTERS,
              startDate: start,
              endDate: end
          }));
      }
      setPage(1);
  };

  const handleAIUpdate = (newFilters: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  // Função melhorada para definir períodos
  // Quando isContasAPagar ou isContasAReceber, usa Data de Vencimento (dueDate)
  const setDateRange = (type: 'today' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom') => {
    const now = new Date();
    let start: Date, end: Date;

    switch (type) {
      case 'today':
        start = now;
        end = now;
        break;
      case 'thisWeek':
        const dayOfWeek = now.getDay();
        start = new Date(now);
        start.setDate(now.getDate() - dayOfWeek);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        break;
      case 'thisMonth':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'lastMonth':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'thisYear':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
        break;
      case 'custom':
        setActivePeriod('custom');
        return; // Não altera as datas, apenas marca como personalizado
      default:
        return;
    }

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    setActivePeriod(type);

    // Se está em modo Contas a Pagar ou Contas a Receber, usa Data de Vencimento
    if (isContasAPagar || isContasAReceber) {
      setFilters(prev => ({
        ...prev,
        startDate: '',
        endDate: '',
        dueDateStart: startStr,
        dueDateEnd: endStr
      }));
    } else {
      setFilters(prev => ({
        ...prev,
        startDate: startStr,
        endDate: endStr,
        dueDateStart: '',
        dueDateEnd: ''
      }));
    }
    setPage(1);
  };

  // Função para formatar data para exibição
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
  };

  // Texto do período selecionado
  const getPeriodText = () => {
    // Verificar se está usando dueDate (Contas a Pagar/Receber)
    if (filters.dueDateStart && filters.dueDateEnd) {
      return `${formatDateDisplay(filters.dueDateStart)} até ${formatDateDisplay(filters.dueDateEnd)} (Vencimento)`;
    }
    if (filters.startDate && filters.endDate) {
      return `${formatDateDisplay(filters.startDate)} até ${formatDateDisplay(filters.endDate)}`;
    }
    return 'Selecione um período';
  };

  const handlePrint = () => {
    window.print();
  };
  
  const handleDeleteTransaction = (id: string) => {
    console.log(`Exclusão confirmada para: ${id}`);
    alert('Exclusão simulada com sucesso!');
  };

  const handleWhatsAppShare = () => {
    const formatBRL = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    
    const message = `📊 *Resumo Financeiro - CashFlow Pro*%0A` +
      `--------------------------------%0A` +
      `🗓 Período: ${filters.startDate ? new Date(filters.startDate).toLocaleDateString('pt-BR') : 'Início'} a ${filters.endDate ? new Date(filters.endDate).toLocaleDateString('pt-BR') : 'Hoje'}%0A` +
      `✅ Entradas: ${formatBRL(kpi.totalReceived)}%0A` +
      `🔻 Saídas: ${formatBRL(kpi.totalPaid)}%0A` +
      `💰 *Saldo: ${formatBRL(kpi.balance)}*%0A` +
      `--------------------------------%0A` +
      `Gerado via Painel CashFlow Pro`;
    
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  // Prepare chart data
  const chartData = useMemo(() => {
    if (isContasAPagar) {
      const grouped: Record<string, { date: string; Pago: number; Pendente: number }> = {};
      
      data.forEach(t => {
        const dateToUse = t.dueDate || t.date;
        const d = new Date(dateToUse).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        
        if (!grouped[d]) grouped[d] = { date: d, Pago: 0, Pendente: 0 };
        
        if (t.status === 'Pago') {
          grouped[d].Pago += t.valuePaid;
        } else {
          grouped[d].Pendente += t.valuePaid;
        }
      });

      return Object.values(grouped)
        .sort((a, b) => {
          const [dayA, monthA] = a.date.split('/').map(Number);
          const [dayB, monthB] = b.date.split('/').map(Number);
          if (monthA !== monthB) return monthA - monthB;
          return dayA - dayB;
        })
        .slice(-10);
    } else {
      const grouped: Record<string, { date: string; Entradas: number; Saidas: number }> = {};
      
      data.forEach(t => {
        const d = new Date(t.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        if (!grouped[d]) grouped[d] = { date: d, Entradas: 0, Saidas: 0 };
        if (t.movement === 'Entrada') grouped[d].Entradas += t.valueReceived;
        else grouped[d].Saidas += t.valuePaid;
      });

      return Object.values(grouped).slice(0, 10).reverse();
    }
  }, [data, isContasAPagar]);

  if (isLoading && data.length === 0 && !initError) {
    return (
      <Layout>
        <div className="h-[80vh] flex flex-col items-center justify-center">
          <Loader2 className="h-10 w-10 text-blue-600 animate-spin mb-4" />
          <h2 className="text-xl font-semibold text-slate-700 dark:text-slate-300">Acessando Banco de Dados...</h2>
          <p className="text-slate-500 dark:text-slate-500 mt-2">Sincronizando com Google Sheets</p>
        </div>
      </Layout>
    );
  }

  if (initError) {
    return (
      <Layout>
        <div className="h-[80vh] flex flex-col items-center justify-center">
          <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg text-center border border-red-100 dark:border-red-900 max-w-md animate-in zoom-in-95">
            <h2 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">Falha na Conexão</h2>
            <p className="text-red-500 dark:text-red-400/80 mb-4">{initError}</p>
            <p className="text-sm text-slate-500 mb-6">
              Verifique se a aplicação está publicada corretamente e se o ID da planilha é válido.
            </p>
            <div className="flex gap-3 justify-center">
                <button 
                    onClick={() => window.location.reload()} 
                    className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-lg shadow-red-600/30 transition-all font-medium"
                >
                  Tentar Novamente
                </button>
                <button
                    onClick={() => {
                        DataService.loadMockData();
                        setInitError('');
                        setIsLoading(false);
                        // Trigger a local refresh to grab the mock data
                        const { result, kpi: newKpi } = DataService.getTransactions(filters, page);
                        setData(result.data);
                        setTotalPages(result.totalPages);
                        setKpi(newKpi);
                        // Atualizar opções de filtro
                        setOptions({
                            bankAccounts: DataService.getUniqueValues('bankAccount'),
                            types: DataService.getUniqueValues('type'),
                            statuses: DataService.getUniqueValues('status'),
                            movements: DataService.getUniqueValues('movement'),
                            clients: DataService.getUniqueValues('client'),
                            paidBys: DataService.getUniqueValues('paidBy'),
                        });
                    }}
                    className="px-6 py-2.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-all font-medium"
                >
                    Entrar com Dados de Exemplo
                </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        
        {/* Header & Actions */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="print:hidden">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Visão Geral</h1>
            <p className="text-slate-500 dark:text-slate-400">Acompanhe o fluxo de caixa da sua empresa.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 print:hidden">
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
              onClick={handleManualRefresh}
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
              onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors text-sm
                ${Object.values(filters).some(Boolean) 
                  ? 'bg-white dark:bg-slate-800 border-blue-500 text-blue-600 dark:text-blue-400' 
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              <Filter className="h-4 w-4" />
              <span>Filtros</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
            >
              <Printer className="h-4 w-4" />
              <span>Imprimir</span>
            </button>

             <button
              onClick={() => DataService.exportToCSV(filters)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 dark:bg-slate-700 text-white border border-slate-800 dark:border-slate-700 rounded-lg hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors text-sm"
            >
              <Download className="h-4 w-4" />
              <span>Exportar</span>
            </button>

             <button
              onClick={handleWhatsAppShare}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white border border-green-600 rounded-lg hover:bg-green-700 transition-colors text-sm"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>
          </div>
        </div>

        {/* Quick View Modes (Similar to Reports) */}
        <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row gap-2 print:hidden">
            <button
                onClick={() => applyViewMode('general')}
                className={`flex-1 py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all
                ${!isContasAPagar && !isContasAReceber
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white ring-2 ring-slate-400/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
            >
                <Layers className="h-4 w-4" />
                Visão Geral
            </button>
            <button
                onClick={() => applyViewMode('payables')}
                className={`flex-1 py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all
                ${isContasAPagar 
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 ring-2 ring-red-500/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:bg-red-50/50 dark:hover:bg-red-900/10'}`}
            >
                <ArrowDownCircle className="h-4 w-4" />
                A Pagar (Aberto)
            </button>
            <button
                onClick={() => applyViewMode('receivables')}
                className={`flex-1 py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all
                ${isContasAReceber 
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'}`}
            >
                <ArrowUpCircle className="h-4 w-4" />
                A Receber (Aberto)
            </button>
        </div>

        {/* Filters Panel - REDESENHADO */}
        {isFilterMenuOpen && (
          <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-in slide-in-from-top-2 print:hidden transition-colors">
            
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Filter className="h-4 w-4 text-blue-500" />
                Painel de Filtros
              </h3>
              <button onClick={clearFilters} className="text-sm text-red-500 hover:text-red-700 font-medium flex items-center gap-1">
                <XCircle className="h-4 w-4" />
                Limpar filtros
              </button>
            </div>
            
            {/* BUSCA GERAL */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Busca Geral</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Pesquise por qualquer termo..."
                  value={filters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                  className="pl-9 w-full form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* SEÇÃO 1: PERÍODO RÁPIDO */}
            <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Período Rápido
                  {(isContasAPagar || isContasAReceber) && (
                    <span className="ml-2 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                      📅 por Vencimento
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-500 ml-2">({getPeriodText()})</span>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'today', label: 'Hoje' },
                  { key: 'thisWeek', label: 'Esta Semana' },
                  { key: 'thisMonth', label: 'Este Mês' },
                  { key: 'lastMonth', label: 'Mês Anterior' },
                  { key: 'thisYear', label: 'Este Ano' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setDateRange(key as any)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activePeriod === key
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                
                {/* Datas personalizadas inline — usam dueDate quando em Contas a Pagar/Receber */}
                <div className="flex items-center gap-2 ml-2">
                  <input
                    type="date"
                    className="form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500 w-36"
                    value={(isContasAPagar || isContasAReceber) ? (filters.dueDateStart || '') : filters.startDate}
                    onChange={(e) => {
                      if (isContasAPagar || isContasAReceber) {
                        handleFilterChange('dueDateStart', e.target.value);
                      } else {
                        handleFilterChange('startDate', e.target.value);
                      }
                      setActivePeriod('custom');
                    }}
                    title={(isContasAPagar || isContasAReceber) ? "Vencimento Início" : "Data Inicial"}
                  />
                  <span className="text-slate-400 text-sm">até</span>
                  <input
                    type="date"
                    className="form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500 w-36"
                    value={(isContasAPagar || isContasAReceber) ? (filters.dueDateEnd || '') : filters.endDate}
                    onChange={(e) => {
                      if (isContasAPagar || isContasAReceber) {
                        handleFilterChange('dueDateEnd', e.target.value);
                      } else {
                        handleFilterChange('endDate', e.target.value);
                      }
                      setActivePeriod('custom');
                    }}
                    title={(isContasAPagar || isContasAReceber) ? "Vencimento Fim" : "Data Final"}
                  />
                </div>
              </div>
            </div>

            {/* SEÇÃO 2: DATAS AVANÇADAS (Colapsável) */}
            <div className="mb-4">
              <button
                onClick={() => setShowAdvancedDates(!showAdvancedDates)}
                className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {showAdvancedDates ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <Calendar className="h-4 w-4" />
                Datas Detalhadas (Vencimento, Pagamento, Recebimento)
              </button>
              
              {showAdvancedDates && (
                <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  
                  {/* Data Vencimento */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Data Vencimento
                    </label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.dueDateStart || ''}
                        onChange={(e) => handleFilterChange('dueDateStart', e.target.value)}
                      />
                      <span className="text-slate-400 text-xs">-</span>
                      <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.dueDateEnd || ''}
                        onChange={(e) => handleFilterChange('dueDateEnd', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Data Pagamento */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                      <ArrowDown className="h-3 w-3 text-red-500" />
                      Data Pagamento
                      <span className="text-red-500 text-[10px]">(Saídas)</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.paymentDateStart || ''}
                        onChange={(e) => handleFilterChange('paymentDateStart', e.target.value)}
                      />
                      <span className="text-slate-400 text-xs">-</span>
                      <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.paymentDateEnd || ''}
                        onChange={(e) => handleFilterChange('paymentDateEnd', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Data Recebimento */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                      <ArrowUp className="h-3 w-3 text-green-500" />
                      Data Recebimento
                      <span className="text-green-500 text-[10px]">(Entradas)</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.receiptDateStart || ''}
                        onChange={(e) => handleFilterChange('receiptDateStart', e.target.value)}
                      />
                      <span className="text-slate-400 text-xs">-</span>
                      <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.receiptDateEnd || ''}
                        onChange={(e) => handleFilterChange('receiptDateEnd', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* SEÇÃO 3: OUTROS FILTROS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              
              {/* TIPO DE LANÇAMENTO */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Tipo de Lançamento</label>
                <select
                  className="w-full form-select rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.type}
                  onChange={(e) => handleFilterChange('type', e.target.value)}
                >
                  <option value="">Todos os Tipos</option>
                  {options.types.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* MOVIMENTAÇÃO */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Movimentação</label>
                <select
                  className="w-full form-select rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.movement}
                  onChange={(e) => handleFilterChange('movement', e.target.value)}
                >
                  <option value="">Todos</option>
                  {options.movements.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* TIPO DE CONTA */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Conta (Banco)</label>
                <select
                  className="w-full form-select rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.bankAccount}
                  onChange={(e) => handleFilterChange('bankAccount', e.target.value)}
                >
                  <option value="">Todas as Contas</option>
                  {options.bankAccounts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* STATUS */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Status</label>
                <select
                  className="w-full form-select rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                >
                  <option value="">Todos os Status</option>
                  {options.statuses.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* NOME EMPRESA / CREDOR */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Empresa / Credor</label>
                <input
                  list="clients-list"
                  type="text"
                  placeholder="Digite ou selecione..."
                  className="w-full form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.client}
                  onChange={(e) => handleFilterChange('client', e.target.value)}
                />
                <datalist id="clients-list">
                  {options.clients.slice(0, 100).map((o, i) => <option key={i} value={o} />)}
                </datalist>
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {isContasAPagar ? (
            <>
              <KpiCard
                title="Total Geral"
                value={kpi.totalReceived}
                icon={DollarSign}
                color="blue"
              />
              <KpiCard
                title="Total Pago"
                value={kpi.totalPaid}
                icon={CheckCircle}
                color="green"
              />
              <KpiCard
                title="Saldo a Pagar"
                value={kpi.balance}
                icon={Clock}
                color={kpi.balance > 0 ? 'red' : 'green'}
              />
            </>
          ) : isContasAReceber ? (
            <>
              <KpiCard
                title="Total Geral a Receber"
                value={kpi.totalReceived}
                icon={DollarSign}
                color="blue"
              />
              <KpiCard
                title="Valor Recebido"
                value={kpi.totalPaid}
                icon={CheckCircle}
                color="green"
              />
              <KpiCard
                title="Saldo a Receber"
                value={kpi.balance}
                icon={Clock}
                color={kpi.balance > 0 ? 'red' : 'green'}
              />
            </>
          ) : (
            <>
              <KpiCard
                title="Total Entradas"
                value={kpi.totalReceived}
                icon={ArrowUp}
                color="green"
              />
              <KpiCard
                title="Total Saídas"
                value={kpi.totalPaid}
                icon={ArrowDown}
                color="red"
              />
              <KpiCard
                title="Saldo Líquido"
                value={kpi.balance}
                icon={DollarSign}
                color={kpi.balance >= 0 ? 'blue' : 'red'}
              />
            </>
          )}
        </div>

        {/* Charts & Data */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
           <div className="lg:col-span-3 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm print:shadow-none print:border-none transition-colors">
             <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
               {isContasAPagar ? 'Contas a Pagar por Vencimento' : 'Movimentação Recente'}
             </h3>
             <div className="h-64 w-full">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={chartData} margin={{top: 5, right: 30, left: 20, bottom: 5}}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#475569" strokeOpacity={0.1} />
                    <XAxis dataKey="date" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                      formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                    />
                    <Legend wrapperStyle={{ color: '#94a3b8' }} />
                    {isContasAPagar ? (
                      <>
                        <Bar dataKey="Pago" fill="#16a34a" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Pendente" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </>
                    ) : (
                      <>
                        <Bar dataKey="Entradas" fill="#16a34a" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Saidas" fill="#dc2626" radius={[4, 4, 0, 0]} />
                      </>
                    )}
                 </BarChart>
               </ResponsiveContainer>
             </div>
           </div>

           <div className="lg:col-span-3">
              <DataTable
                data={data}
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                onDelete={handleDeleteTransaction}
                clientFilterValue={filters.client}
                onClientFilterChange={(val) => handleFilterChange('client', val)}
                clientOptions={options.clients}
                idFilterValue={filters.id}
                onIdFilterChange={(val) => handleFilterChange('id', val)}
                isLoading={isLoading}
                selectedType={filters.type}
              />
           </div>
        </div>

        <div className="print:hidden">
            <AIAssistant onFiltersUpdate={handleAIUpdate} />
        </div>

      </div>
    </Layout>
  );
};

export default Dashboard;
