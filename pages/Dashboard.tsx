import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import KpiCard from '../components/KpiCard';
import DataTable from '../components/DataTable';
import AIAssistant from '../components/AIAssistant';
import { DataService } from '../services/dataService';
import { AuthService } from '../services/authService';
import { FilterState, KPIData, Transaction } from '../types';
import { ArrowDown, ArrowUp, DollarSign, Download, Filter, Search, Loader2, XCircle, Printer, MessageCircle, User, X, Check } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

const INITIAL_FILTERS: FilterState = {
  startDate: '',
  endDate: '',
  bankAccount: '',
  type: '',
  status: '',
  client: '',
  paidBy: '',
  movement: '',
  search: '',
};

const Dashboard: React.FC = () => {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Transaction[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [kpi, setKpi] = useState<KPIData>({ totalPaid: 0, totalReceived: 0, balance: 0 });
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  
  // Login Alert State
  const [showWelcomeAlert, setShowWelcomeAlert] = useState(true);
  const currentUser = AuthService.getCurrentUser();

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
    
    // Auto-dismiss welcome alert after 4 seconds
    const timer = setTimeout(() => setShowWelcomeAlert(false), 4000);
    return () => clearTimeout(timer);
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

  const handlePrint = () => {
    window.print();
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
    const grouped: Record<string, { date: string; Entradas: number; Saidas: number }> = {};
    
    data.forEach(t => {
      const d = new Date(t.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (!grouped[d]) grouped[d] = { date: d, Entradas: 0, Saidas: 0 };
      if (t.movement === 'Entrada') grouped[d].Entradas += t.valueReceived;
      else grouped[d].Saidas += t.valuePaid;
    });

    return Object.values(grouped).slice(0, 10).reverse();
  }, [data]);

  if (isLoading) {
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
          <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg text-center border border-red-100 dark:border-red-900 max-w-md">
            <h2 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">Falha na Conexão</h2>
            <p className="text-red-500 dark:text-red-400/80 mb-4">{initError}</p>
            <p className="text-sm text-slate-500 mb-4">
              Verifique se a aplicação está publicada corretamente como Web App no Google Apps Script.
            </p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
              Tentar Novamente
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
       {/* Welcome Alert Toast */}
       {showWelcomeAlert && currentUser && (
        <div className="fixed top-20 right-5 z-50 animate-in slide-in-from-right fade-in duration-500 print:hidden">
           <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-l-4 border-emerald-500 shadow-xl rounded-r-lg p-4 flex items-center gap-4 max-w-sm">
              <div className="bg-emerald-100 dark:bg-emerald-900/50 p-2 rounded-full shrink-0">
                 <User className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                 <h4 className="font-bold text-slate-800 dark:text-white text-sm">Bem-vindo(a), {currentUser.name}!</h4>
                 <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Sessão iniciada com sucesso.</p>
              </div>
              <button 
                onClick={() => setShowWelcomeAlert(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                 <X className="h-4 w-4" />
              </button>
           </div>
        </div>
      )}

      <div className="space-y-6">
        
        {/* Header & Actions */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="print:hidden">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Visão Geral</h1>
            <p className="text-slate-500 dark:text-slate-400">Acompanhe o fluxo de caixa da sua empresa.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {/* Filtros Toggle */}
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

            {/* Imprimir */}
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
            >
              <Printer className="h-4 w-4" />
              <span>Imprimir</span>
            </button>

             {/* Exportar CSV */}
             <button
              onClick={() => DataService.exportToCSV(filters)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 dark:bg-slate-700 text-white border border-slate-800 dark:border-slate-700 rounded-lg hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors text-sm"
            >
              <Download className="h-4 w-4" />
              <span>Exportar</span>
            </button>

             {/* Exportar WhatsApp */}
             <button
              onClick={handleWhatsAppShare}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white border border-green-600 rounded-lg hover:bg-green-700 transition-colors text-sm"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>
          </div>
        </div>

        {/* Filters Panel - Matches Google Sheet Columns */}
        {isFilterMenuOpen && (
          <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-in slide-in-from-top-2 print:hidden transition-colors">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Filter className="h-4 w-4 text-blue-500" />
                Filtros (Baseados na Planilha)
              </h3>
              <button onClick={clearFilters} className="text-sm text-red-500 hover:text-red-700 font-medium flex items-center gap-1">
                <XCircle className="h-4 w-4" />
                Limpar filtros
              </button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
               {/* SEARCH GERAL (Top Priority) */}
               <div className="space-y-1 lg:col-span-4 mb-2">
                 <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Busca Geral</label>
                 <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Pesquise por qualquer termo em todas as colunas..."
                      value={filters.search}
                      onChange={(e) => handleFilterChange('search', e.target.value)}
                      className="pl-9 w-full form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                 </div>
               </div>

              {/* DATE RANGE */}
              <div className="space-y-1 lg:col-span-2">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Período de Análise (Data Início - Fim)</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    className="w-full form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                    value={filters.startDate}
                    onChange={(e) => handleFilterChange('startDate', e.target.value)}
                    title="Data Inicial"
                  />
                  <div className="flex items-center text-slate-400">-</div>
                  <input
                    type="date"
                    className="w-full form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                    value={filters.endDate}
                    onChange={(e) => handleFilterChange('endDate', e.target.value)}
                    title="Data Final"
                  />
                </div>
              </div>

              {/* MOVIMENTO */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Movimento</label>
                <select
                  className="w-full form-select rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.movement}
                  onChange={(e) => handleFilterChange('movement', e.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="Entrada">Entrada</option>
                  <option value="Saída">Saída</option>
                  {/* Dynamic options fallback if sheet has different casing */}
                  {options.movements
                    .filter(m => m !== 'Entrada' && m !== 'Saída')
                    .map(o => <option key={o} value={o}>{o}</option>)
                  }
                </select>
              </div>

              {/* CONTA */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Conta</label>
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
                  <option value="">Todos Tipos</option>
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
                  <option value="">Todos Status</option>
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

               {/* CLIENTE / DESCRIÇÃO (Digitação Habilitada) */}
               <div className="space-y-1 lg:col-span-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Cliente / Descrição</label>
                <input
                  list="clients-list"
                  type="text"
                  placeholder="Digite ou selecione..."
                  className="w-full form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                  value={filters.client}
                  onChange={(e) => handleFilterChange('client', e.target.value)}
                />
                <datalist id="clients-list">
                  {options.clients.map(o => <option key={o} value={o} />)}
                </datalist>
              </div>

            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
        </div>

        {/* Charts & Data */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
           {/* Chart */}
           <div className="lg:col-span-3 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm print:shadow-none print:border-none transition-colors">
             <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">Movimentação Recente</h3>
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
                    <Bar dataKey="Entradas" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Saidas" fill="#dc2626" radius={[4, 4, 0, 0]} />
                 </BarChart>
               </ResponsiveContainer>
             </div>
           </div>

           {/* Table */}
           <div className="lg:col-span-3">
              <DataTable
                data={data}
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
           </div>
        </div>

        {/* Floating AI Assistant - Hidden on print */}
        <div className="print:hidden">
            <AIAssistant onFiltersUpdate={handleAIUpdate} />
        </div>

      </div>
    </Layout>
  );
};

export default Dashboard;