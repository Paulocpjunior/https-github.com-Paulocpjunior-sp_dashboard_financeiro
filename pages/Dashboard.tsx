import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import KpiCard from '../components/KpiCard';
import DataTable from '../components/DataTable';
import AIAssistant from '../components/AIAssistant';
import { DataService } from '../services/dataService';
import { FilterState, KPIData, Transaction } from '../types';
import { ArrowDown, ArrowUp, DollarSign, Download, Filter, Search, Loader2, XCircle, Printer, MessageCircle, Calendar, Clock, CheckCircle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

const INITIAL_FILTERS: FilterState = {
  id: '',
  startDate: '',
  endDate: '',
  dueDateStart: '',
  dueDateEnd: '',
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

  // Detecta se está no modo "Contas a Pagar"
  const normalizedType = normalizeText(filters.type || '');
  const isContasAPagar = normalizedType.includes('saida') || 
                        normalizedType.includes('pagar') ||
                        normalizedType.includes('contas a pagar');

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

        // Initial fetch
        const { result, kpi: newKpi } = DataService.getTransactions(filters, page);
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
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to page 1 on filter change
  };

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setPage(1);
  };

  const handleAIUpdate = (newFilters: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  const setDateRange = (type: 'thisMonth' | 'lastMonth') => {
      const now = new Date();
      let start, end;

      if (type === 'thisMonth') {
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else {
          start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          end = new Date(now.getFullYear(), now.getMonth(), 0);
      }

      setFilters(prev => ({
          ...prev,
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
      }));
      setPage(1);
  };

  const handlePrint = () => {
    window.print();
  };
  
  const handleDeleteTransaction = (id: string) => {
    // A lógica do modal está no componente DataTable, aqui só passamos o callback
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

  // Prepare chart data - DINÂMICO baseado no tipo de filtro
  const chartData = useMemo(() => {
    if (isContasAPagar) {
      // MODO CONTAS A PAGAR: Agrupa por data de VENCIMENTO, separando Pago vs Pendente
      const grouped: Record<string, { date: string; Pago: number; Pendente: number }> = {};
      
      data.forEach(t => {
        // Usa data de vencimento para contas a pagar
        const dateToUse = t.dueDate || t.date;
        const d = new Date(dateToUse).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        
        if (!grouped[d]) grouped[d] = { date: d, Pago: 0, Pendente: 0 };
        
        if (t.status === 'Pago') {
          grouped[d].Pago += t.valuePaid;
        } else {
          grouped[d].Pendente += t.valuePaid;
        }
      });

      // Ordena por data e retorna os últimos 10
      return Object.values(grouped)
        .sort((a, b) => {
          const [dayA, monthA] = a.date.split('/').map(Number);
          const [dayB, monthB] = b.date.split('/').map(Number);
          if (monthA !== monthB) return monthA - monthB;
          return dayA - dayB;
        })
        .slice(-10);
    } else {
      // MODO PADRÃO: Entradas vs Saídas por data de lançamento
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
            <button 
                onClick={() => window.location.reload()} 
                className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-lg shadow-red-600/30 transition-all font-medium"
            >
              Tentar Novamente
            </button>
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

        {/* Filters Panel */}
        {isFilterMenuOpen && (
          <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-in slide-in-from-top-2 print:hidden transition-colors">
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
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
               {/* SEARCH GERAL */}
               <div className="space-y-1 lg:col-span-4 mb-2">
                 <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Busca Geral</label>
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

              {/* DATA LANÇAMENTO */}
              <div className="space-y-1 lg:col-span-2">
                <div className="flex justify-between items-end mb-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data de Lançamento</label>
                    <div className="flex gap-1">
                        <button onClick={() => setDateRange('thisMonth')} className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors">Este Mês</button>
                        <button onClick={() => setDateRange('lastMonth')} className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors">Mês Anterior</button>
                    </div>
                </div>
                <div className="flex gap-2 items-center">
                    <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.startDate}
                        onChange={(e) => handleFilterChange('startDate', e.target.value)}
                        title="De"
                    />
                    <span className="text-slate-400 text-sm">-</span>
                    <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.endDate}
                        onChange={(e) => handleFilterChange('endDate', e.target.value)}
                        title="Até"
                    />
                </div>
              </div>

              {/* DATA VENCIMENTO - NOVO */}
              <div className="space-y-1 lg:col-span-2">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Data de Vencimento</label>
                <div className="flex gap-2 items-center">
                    <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.dueDateStart || ''}
                        onChange={(e) => handleFilterChange('dueDateStart', e.target.value)}
                        title="Vencimento De"
                    />
                    <span className="text-slate-400 text-sm">-</span>
                    <input
                        type="date"
                        className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                        value={filters.dueDateEnd || ''}
                        onChange={(e) => handleFilterChange('dueDateEnd', e.target.value)}
                        title="Vencimento Até"
                    />
                </div>
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

              {/* TIPO DE CONTA (Conta Bancária) - Populado dinamicamente */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Tipo de Conta (Banco)</label>
                <select
                  className="w-full form-select rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.bankAccount}
                  onChange={(e) => handleFilterChange('bankAccount', e.target.value)}
                >
                  <option value="">Todas as Contas</option>
                  {options.bankAccounts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

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

              {/* PAGO POR */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Pago Por</label>
                <select
                  className="w-full form-select rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.paidBy}
                  onChange={(e) => handleFilterChange('paidBy', e.target.value)}
                >
                  <option value="">Todos</option>
                  {options.paidBys.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

               {/* NOME EMPRESA / CREDOR */}
               <div className="space-y-1 lg:col-span-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Nome Empresa / Credor</label>
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