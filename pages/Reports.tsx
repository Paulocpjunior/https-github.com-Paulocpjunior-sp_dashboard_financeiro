import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { DataService } from '../services/dataService';
import { ReportService } from '../services/reportService';
import { AuthService } from '../services/authService';
import { TRANSACTION_TYPES, BANK_ACCOUNTS, STATUSES } from '../constants';
import { Transaction, KPIData } from '../types';
import { FileText, Download, Filter, Calendar, CheckSquare, Square, PieChart, RefreshCw, Landmark, Activity } from 'lucide-react';

const Reports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  
  // Filter States
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>(''); // Empty = All
  const [selectedBank, setSelectedBank] = useState<string>(''); // Empty = All
  
  // Preview Data
  const [filteredData, setFilteredData] = useState<Transaction[]>([]);
  const [kpi, setKpi] = useState<KPIData>({ totalPaid: 0, totalReceived: 0, balance: 0 });

  // Initial Load
  useEffect(() => {
    const load = async () => {
      try {
        if (!DataService.isDataLoaded) {
             await DataService.loadData();
        }
        // Hack to get all data: use a very loose filter first
        const { result } = DataService.getTransactions({}, 1, 99999);
        setAllTransactions(result.data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Filter Logic specific for Report
  useEffect(() => {
    let result = allTransactions;

    if (startDate) {
      result = result.filter(t => t.date >= startDate);
    }
    if (endDate) {
      result = result.filter(t => t.date <= endDate);
    }
    if (selectedTypes.length > 0) {
      result = result.filter(t => selectedTypes.includes(t.type));
    }
    if (selectedStatus) {
      result = result.filter(t => t.status === selectedStatus);
    }
    if (selectedBank) {
      result = result.filter(t => t.bankAccount === selectedBank);
    }

    setFilteredData(result);

    // Calc KPI
    const newKpi = result.reduce(
      (acc, curr) => ({
        totalPaid: acc.totalPaid + curr.valuePaid,
        totalReceived: acc.totalReceived + curr.valueReceived,
        balance: acc.balance + (curr.valueReceived - curr.valuePaid),
      }),
      { totalPaid: 0, totalReceived: 0, balance: 0 }
    );
    setKpi(newKpi);

  }, [allTransactions, startDate, endDate, selectedTypes, selectedStatus, selectedBank]);

  const toggleType = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const selectAllTypes = () => setSelectedTypes([...TRANSACTION_TYPES]);
  const clearTypes = () => setSelectedTypes([]);

  const handleGenerate = () => {
    setGenerating(true);
    // Timeout to allow UI to show loading state
    setTimeout(() => {
      ReportService.generatePDF(
        filteredData, 
        kpi, 
        { startDate, endDate, types: selectedTypes, status: selectedStatus, bankAccount: selectedBank },
        AuthService.getCurrentUser()
      );
      setGenerating(false);
    }, 500);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <Layout>
      <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            Relatórios Personalizados
          </h1>
          <p className="text-slate-500 dark:text-slate-400">Configure os filtros abaixo para gerar um PDF detalhado.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LEFT: Configuration Panel */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Date Range & Specific Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {/* Date Range Card */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                    <Calendar className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                    Período de Análise
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Data Início</label>
                      <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full form-input rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Data Fim</label>
                      <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full form-input rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Status & Bank Filter */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                        <Filter className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                        Filtros Específicos
                    </h3>
                    <div className="space-y-4">
                        <div>
                             <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                <Activity className="h-4 w-4" /> Status
                             </label>
                             <select
                                className="w-full form-select rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                                value={selectedStatus}
                                onChange={(e) => setSelectedStatus(e.target.value)}
                             >
                                <option value="">Todos</option>
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                             </select>
                        </div>
                        <div>
                             <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                <Landmark className="h-4 w-4" /> Conta Bancária
                             </label>
                             <select
                                className="w-full form-select rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                                value={selectedBank}
                                onChange={(e) => setSelectedBank(e.target.value)}
                             >
                                <option value="">Todas</option>
                                {BANK_ACCOUNTS.map(b => <option key={b} value={b}>{b}</option>)}
                             </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Transaction Types Card */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Filter className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                    Tipos de Transação
                 </h3>
                 <div className="text-sm space-x-3">
                    <button onClick={selectAllTypes} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">Todos</button>
                    <button onClick={clearTypes} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">Nenhum</button>
                 </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {TRANSACTION_TYPES.map((type) => {
                  const isSelected = selectedTypes.includes(type);
                  return (
                    <div 
                      key={type}
                      onClick={() => toggleType(type)}
                      className={`
                        cursor-pointer flex items-center p-3 rounded-lg border transition-all
                        ${isSelected 
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-200' 
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}
                      `}
                    >
                      {isSelected 
                        ? <CheckSquare className="h-5 w-5 mr-3 text-blue-600 dark:text-blue-400" /> 
                        : <Square className="h-5 w-5 mr-3 text-slate-400 dark:text-slate-500" />
                      }
                      <span className="text-sm font-medium">{type}</span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* RIGHT: Preview & Action */}
          <div className="lg:col-span-1">
             <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg sticky top-6 transition-colors">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-6">
                  <PieChart className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                  Prévia do Relatório
                </h3>

                {loading ? (
                   <div className="flex justify-center py-10">
                      <RefreshCw className="h-8 w-8 text-blue-400 animate-spin" />
                   </div>
                ) : (
                  <div className="space-y-6">
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-100 dark:border-slate-700 text-center">
                       <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Registros Encontrados</p>
                       <p className="text-3xl font-bold text-slate-800 dark:text-white">{filteredData.length}</p>
                    </div>

                    <div className="space-y-3">
                       <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-500 dark:text-slate-400">Entradas</span>
                          <span className="font-semibold text-green-600 dark:text-green-400">{formatCurrency(kpi.totalReceived)}</span>
                       </div>
                       <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-500 dark:text-slate-400">Saídas</span>
                          <span className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(kpi.totalPaid)}</span>
                       </div>
                       <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                          <span className="font-medium text-slate-700 dark:text-slate-300">Saldo</span>
                          <span className={`font-bold text-lg ${kpi.balance >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                             {formatCurrency(kpi.balance)}
                          </span>
                       </div>
                    </div>

                    <button
                      onClick={handleGenerate}
                      disabled={filteredData.length === 0 || generating}
                      className="w-full py-4 bg-slate-900 dark:bg-slate-700 text-white rounded-xl font-semibold shadow-lg hover:bg-slate-800 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group"
                    >
                      {generating ? (
                        <>
                          <RefreshCw className="h-5 w-5 animate-spin" />
                          <span>Gerando PDF...</span>
                        </>
                      ) : (
                        <>
                          <Download className="h-5 w-5 group-hover:translate-y-1 transition-transform" />
                          <span>Baixar Relatório PDF</span>
                        </>
                      )}
                    </button>
                    
                    {filteredData.length === 0 && (
                      <p className="text-xs text-center text-red-400">
                        Nenhum dado encontrado com os filtros atuais.
                      </p>
                    )}
                  </div>
                )}
             </div>
          </div>

        </div>
      </div>
    </Layout>
  );
};

export default Reports;