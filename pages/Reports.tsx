import React, { useState, useEffect, useMemo, useRef } from 'react';
import Layout from '../components/Layout';
import { DataService } from '../services/dataService';
import { ReportService } from '../services/reportService';
import { AuthService } from '../services/authService';
import { TRANSACTION_TYPES, BANK_ACCOUNTS, STATUSES } from '../constants';
import { Transaction, KPIData, FilterState } from '../types';
import { FileText, Download, Filter, Calendar, CheckSquare, Square, PieChart, RefreshCw, Landmark, Activity, ArrowDownCircle, ArrowUpCircle, Layers, AlertTriangle, Loader2, ArrowLeftRight, ArrowUpDown, ArrowUp, ArrowDown, Users, Search } from 'lucide-react';
import { logger } from '../utils/logger';
import { formatISODateBR } from '../utils/dateUtils';
import { getOriginalAmount, getPaidAmount, isEntradaTransaction, isPaidStatus, isSaidaTransaction, isWixInvoice, parseMoneyValue } from '../utils/transactionAmounts';
import { formatExtraChargeDescription, hasExtraCharge } from '../utils/extraCharges';

type ReportMode = 'general' | 'payables' | 'receivables';
type DateFilterType = 'date' | 'dueDate' | 'paymentDate';
type SortField = 'date' | 'dueDate' | 'paymentDate' | 'valorOriginal' | 'valorPago' | 'status' | 'client' | 'clientNumber';
type SortDirection = 'asc' | 'desc';

const getClientNumberSortKey = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return { missing: true, number: Number.POSITIVE_INFINITY, text: '' };

  const digits = text.replace(/\D/g, '');
  const parsed = digits ? Number(digits) : Number.NaN;

  return {
    missing: false,
    number: Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY,
    text,
  };
};

const compareClientNumber = (a: Transaction, b: Transaction): number => {
  const left = getClientNumberSortKey(a.clientNumber);
  const right = getClientNumberSortKey(b.clientNumber);

  if (left.missing && right.missing) return 0;
  if (left.missing) return 1;
  if (right.missing) return -1;
  if (left.number !== right.number) return left.number - right.number;

  return left.text.localeCompare(right.text, 'pt-BR', { numeric: true });
};

const getCurrentMonthDateRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

const buildScopedLoadFilters = (
  dateFilterType: DateFilterType,
  startDate: string,
  endDate: string
): Partial<FilterState> => {
  const range = startDate || endDate ? { startDate, endDate } : getCurrentMonthDateRange();

  if (dateFilterType === 'dueDate') {
    return { dueDateStart: range.startDate, dueDateEnd: range.endDate };
  }

  if (dateFilterType === 'paymentDate') {
    return { paymentDateStart: range.startDate, paymentDateEnd: range.endDate };
  }

  return range;
};

const getScopedLoadKey = (dateFilterType: DateFilterType, startDate: string, endDate: string) => {
  const filters = buildScopedLoadFilters(dateFilterType, startDate, endDate);
  return [
    dateFilterType,
    filters.startDate || '',
    filters.endDate || '',
    filters.dueDateStart || '',
    filters.dueDateEnd || '',
    filters.paymentDateStart || '',
    filters.paymentDateEnd || '',
  ].join('|');
};

// Interface estendida localmente para detalhar Pendente vs Pago
interface DetailedKPI extends KPIData {
    pendingPayables: number;
    settledPayables: number;
    pendingReceivables: number;
    settledReceivables: number;
}

const Reports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState(''); // Estado de erro adicionado
  const [generating, setGenerating] = useState(false);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  
  // Filter States
  const [dateFilterType, setDateFilterType] = useState<DateFilterType>('date'); 
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>(''); 
  const [selectedBank, setSelectedBank] = useState<string>(''); 
  const [selectedMovement, setSelectedMovement] = useState<string>(''); 
  const [selectedClient, setSelectedClient] = useState<string>(''); // Novo estado para Cliente
  const [extraChargesOnly, setExtraChargesOnly] = useState(false);
  const [wixInvoicesOnly, setWixInvoicesOnly] = useState(false);
  
  // Sort States
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const loadedScopeRef = useRef('');
  
  // Report Mode
  const [reportMode, setReportMode] = useState<ReportMode>('general');

  // Preview Data
  const [filteredData, setFilteredData] = useState<Transaction[]>([]);
  const [kpi, setKpi] = useState<DetailedKPI>({ 
      totalPaid: 0, 
      totalReceived: 0, 
      balance: 0,
      pendingPayables: 0,
      settledPayables: 0,
      pendingReceivables: 0,
      settledReceivables: 0
  });

  // Initial Load with Cache Priority & Error Handling
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setInitError(''); // Reset error

        // Se os dados já estiverem carregados, evita recarregar tudo quando o Firestore não mudou.
        if (DataService.isDataLoaded) {
             await DataService.refreshCacheIfChanged();
             const { result } = DataService.getTransactions({});
             setAllTransactions(result.allData ?? result.data);
        } else {
             const initialRange = getCurrentMonthDateRange();
             setStartDate(initialRange.startDate);
             setEndDate(initialRange.endDate);
             loadedScopeRef.current = getScopedLoadKey(dateFilterType, initialRange.startDate, initialRange.endDate);
             await DataService.loadDataForFilters(
               buildScopedLoadFilters(dateFilterType, initialRange.startDate, initialRange.endDate)
             );
             const { result } = DataService.getTransactions({});
             setAllTransactions(result.allData ?? result.data);
        }
      } catch (e: any) {
        logger.error("Erro ao carregar dados em Relatórios:", e);
        setInitError(e.message || 'Falha na conexão com os dados.');
      } finally {
        setLoading(false);
      }
    };
    load();

    // Listener para atualizar quando dados mudam (ex: após dar baixa no Dashboard)
    const unsubscribe = DataService.onRefresh(() => {
      if (DataService.isDataLoaded) {
        const { result } = DataService.getTransactions({});
        setAllTransactions(result.allData ?? result.data);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!DataService.isDataLoaded) return;

    const scopeKey = getScopedLoadKey(dateFilterType, startDate, endDate);
    if (loadedScopeRef.current === scopeKey) return;

    let cancelled = false;

    const loadScope = async () => {
      try {
        setLoading(true);
        setInitError('');
        await DataService.loadDataForFilters(buildScopedLoadFilters(dateFilterType, startDate, endDate), true);
        if (cancelled) return;
        loadedScopeRef.current = scopeKey;
        const { result } = DataService.getTransactions({});
        setAllTransactions(result.allData ?? result.data);
      } catch (e: any) {
        if (!cancelled) {
          logger.error("Erro ao carregar período em Relatórios:", e);
          setInitError(e.message || 'Falha na conexão com os dados.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadScope();

    return () => {
      cancelled = true;
    };
  }, [dateFilterType, startDate, endDate]);

  // Compute available types dynamically
  const availableTypes = useMemo(() => {
    const mandatoryTypes = [
      'Entrada de Caixa / Contas a Receber', 
      'Saída de Caixa / Contas a Pagar'
    ];
    
    const typesFromData = Array.from(new Set(allTransactions.map(t => t.type).filter(Boolean)));
    const otherTypesFromConstants = TRANSACTION_TYPES.filter(t => !mandatoryTypes.includes(t));
    
    const combined = new Set([
      ...mandatoryTypes,
      ...otherTypesFromConstants,
      ...typesFromData
    ]);

    return Array.from(combined);
  }, [allTransactions]);

  // Compute available clients dynamically
  const availableClients = useMemo(() => {
    const clients = new Set(allTransactions.map(t => t.client).filter(Boolean));
    return Array.from(clients).sort();
  }, [allTransactions]);

  // ★ FIX: Compute available bank accounts from data (não usar constantes hardcoded)
  const availableBanks = useMemo(() => {
    const banksFromData = Array.from(new Set(allTransactions.map(t => t.bankAccount).filter(Boolean)));
    // Combinar com constantes para garantir que apareçam opções mesmo sem dados
    const combined = new Set([...BANK_ACCOUNTS, ...banksFromData]);
    return Array.from(combined).sort();
  }, [allTransactions]);

  const handleModeChange = (mode: ReportMode) => {
    setReportMode(mode);
    setExtraChargesOnly(false);
    setWixInvoicesOnly(false);
    
    // Reset filters before applying new mode specifics to avoid conflicts
    setSelectedStatus('');
    setSelectedBank('');
    // Nota: Não resetamos o Cliente aqui intencionalmente, para permitir "Recebíveis do Cliente X"
    
    if (mode === 'payables') {
      setSelectedMovement('Saída');
      setSelectedTypes(['Saída de Caixa / Contas a Pagar']);
      setDateFilterType('dueDate');
      setSelectedStatus('Pendente'); // FORÇA STATUS PENDENTE (Apenas em aberto)
      setSortField('dueDate'); // Ordenar por vencimento
      setSortDirection('asc');
    } else if (mode === 'receivables') {
      setSelectedMovement('Entrada');
      setSelectedTypes(['Entrada de Caixa / Contas a Receber']);
      setDateFilterType('dueDate'); 
      setSelectedStatus('Pendente'); // FORÇA STATUS PENDENTE (Apenas em aberto)
      setSortField('dueDate'); // Ordenar por vencimento
      setSortDirection('asc');
    } else {
      setSelectedMovement('');
      setSelectedTypes([]);
      setDateFilterType('date');
      setSelectedStatus(''); // Modo geral permite ver tudo
      setSortField('date');
      setSortDirection('desc');
    }
  };

  useEffect(() => {
    let result = allTransactions;

    // 1. Date Filtering (RIGOROSA)
    if (startDate || endDate) {
      result = result.filter(t => {
        let checkDate: string | undefined;
        
        // Seleção explícita da data baseada no filtro escolhido
        if (dateFilterType === 'dueDate') {
            checkDate = t.dueDate;
        } else if (dateFilterType === 'paymentDate') {
            checkDate = t.paymentDate;
        } else {
            checkDate = t.date; // Lançamento
        }

        // Se filtrar por data de pagamento e o item não tiver pagamento, remove (correto para Pendentes)
        if (dateFilterType === 'paymentDate' && (!checkDate || checkDate === '1970-01-01')) {
             return false; 
        }
        
        // Se a data for inválida ou vazia, não passa no filtro
        if (!checkDate || checkDate === '1970-01-01') return false;

        let matchesStart = true;
        let matchesEnd = true;

        if (startDate) matchesStart = checkDate >= startDate;
        if (endDate) matchesEnd = checkDate <= endDate;

        return matchesStart && matchesEnd;
      });
    }

    // 2. Movement Filtering (normalizado para tratar acentuação: Saída/Saida)
    if (selectedMovement) {
      const normalizeMovement = (m: string) => (m || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const targetMovement = normalizeMovement(selectedMovement);
      result = result.filter(t => normalizeMovement(t.movement) === targetMovement);
    }

    // 3. Type Filtering
    if (selectedTypes.length > 0) {
      result = result.filter(t => selectedTypes.includes(t.type));
    }

    // 4. Status Filtering (★ FIX: normalizar antes de comparar)
    if (selectedStatus) {
      const normalizeStatus = (s: string): string => {
        const v = (s || '').toLowerCase().trim();
        if (['sim', 'recebido', 'quitado', 'ok', 'liquidado', 's', 'pago', 'paga'].includes(v)) return 'Pago';
        if (['agendado', 'programado'].includes(v)) return 'Agendado';
        return 'Pendente';
      };
      result = result.filter(t => normalizeStatus(t.status) === selectedStatus);
    }

    // 5. Bank Filtering (★ FIX: case-insensitive e accent-insensitive)
    if (selectedBank) {
      const normalizeBank = (b: string) => (b || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const targetBank = normalizeBank(selectedBank);
      result = result.filter(t => normalizeBank(t.bankAccount) === targetBank);
    }

    // 6. Client Filtering (NOVO)
    if (selectedClient) {
      const search = selectedClient.toLowerCase();
      result = result.filter(t => (t.client || '').toLowerCase().includes(search));
    }

    // 7. Cobranças extras (exclusivo do modo Contas a Receber)
    if (reportMode === 'receivables' && extraChargesOnly) {
      result = result.filter(hasExtraCharge);
    }

    // 8. Faturas Wix (exclusivo do modo Contas a Receber)
    if (reportMode === 'receivables' && wixInvoicesOnly) {
      result = result.filter(isWixInvoice);
    }

    // 9. Sorting
    result = [...result].sort((a, b) => {
      let valA: any;
      let valB: any;
      
      switch (sortField) {
        case 'date':
          valA = a.date || '';
          valB = b.date || '';
          break;
        case 'dueDate':
          valA = a.dueDate || '';
          valB = b.dueDate || '';
          break;
        case 'paymentDate':
          valA = a.paymentDate || '';
          valB = b.paymentDate || '';
          break;
        case 'valorOriginal': {
          valA = getOriginalAmount(a);
          valB = getOriginalAmount(b);
          break;
        }
        case 'valorPago': {
          valA = getPaidAmount(a);
          valB = getPaidAmount(b);
          break;
        }
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
          break;
        case 'client':
          valA = (a.client || '').toLowerCase();
          valB = (b.client || '').toLowerCase();
          break;
        case 'clientNumber':
          return sortDirection === 'asc' ? compareClientNumber(a, b) : compareClientNumber(b, a);
        default:
          valA = a.date || '';
          valB = b.date || '';
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    setFilteredData(result);

    // Calculate Detailed KPIs
    const newKpi = result.reduce(
      (acc, curr) => {
        const isPaid = isPaidStatus(curr.status);

        // Detalhamento Saídas (Contas a Pagar)
        if (isSaidaTransaction(curr)) {
            if (isPaid) acc.settledPayables += getPaidAmount(curr);
        }

        // Detalhamento Entradas (Contas a Receber)
        if (isEntradaTransaction(curr)) {
            if (isPaid) acc.settledReceivables += getPaidAmount(curr);
        }

        return acc;
      },
      { 
          totalPaid: 0, totalReceived: 0, balance: 0,
          pendingPayables: 0, settledPayables: 0,
          pendingReceivables: 0, settledReceivables: 0
      }
    );

    // Mesma fórmula usada pelo Painel Principal: total original menos valor efetivado.
    // Isso preserva no saldo eventuais diferenças de registros marcados como pagos.
    newKpi.totalPaid = result
      .filter(isSaidaTransaction)
      .reduce((total, transaction) => total + getOriginalAmount(transaction), 0);
    newKpi.totalReceived = result
      .filter(isEntradaTransaction)
      .reduce((total, transaction) => total + getOriginalAmount(transaction), 0);
    newKpi.pendingPayables = Math.max(0, newKpi.totalPaid - newKpi.settledPayables);
    newKpi.pendingReceivables = Math.max(0, newKpi.totalReceived - newKpi.settledReceivables);
    newKpi.balance = newKpi.totalReceived - newKpi.totalPaid;

    setKpi(newKpi);

  }, [allTransactions, startDate, endDate, selectedTypes, selectedStatus, selectedBank, dateFilterType, selectedMovement, sortField, sortDirection, selectedClient, reportMode, extraChargesOnly, wixInvoicesOnly]);

  const toggleType = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
    setReportMode('general');
    setExtraChargesOnly(false);
    setWixInvoicesOnly(false);
  };

  const selectAllTypes = () => setSelectedTypes([...availableTypes]);
  const clearTypes = () => setSelectedTypes([]);

  const handleGeneratePDF = () => {
    setGenerating(true);
    
    const dateLabelMap: Record<string, string> = {
        'date': 'Data de Lançamento',
        'dueDate': 'Data de Vencimento',
        'paymentDate': 'Data de Pagamento/Baixa'
    };

    // ★ FIX: Capturar snapshot dos dados ANTES do setTimeout para evitar dados stale
    const snapshotData = [...filteredData];
    const snapshotKpi = { ...kpi };
    const snapshotFilters = {
        startDate, 
        endDate, 
        types: [...selectedTypes], 
        status: selectedStatus, 
        bankAccount: selectedBank,
        movement: selectedMovement,
        client: selectedClient,
        dateContext: dateLabelMap[dateFilterType],
        sortField,
        sortDirection,
        extraChargesOnly: reportMode === 'receivables' && extraChargesOnly,
        wixInvoicesOnly: reportMode === 'receivables' && wixInvoicesOnly
    };

    setTimeout(async () => {
      try {
        if (snapshotData.length === 0) {
          alert('Nenhum registro encontrado com os filtros aplicados. Ajuste os filtros e tente novamente.');
          return;
        }
        await ReportService.generatePDF(
          snapshotData, 
          snapshotKpi, 
          snapshotFilters,
          AuthService.getCurrentUser()
        );
      } catch (err) {
        logger.error('Erro ao gerar PDF:', err);
        alert('Erro ao gerar o relatório PDF. Verifique os filtros e tente novamente.');
      } finally {
        setGenerating(false);
      }
    }, 500);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const formatDate = (dateStr: string | undefined) => {
    return formatISODateBR(dateStr) || '-';
  };

  // --- ERROR FALLBACK UI (Mesma do Dashboard) ---
  if (initError) {
    return (
      <Layout>
        <div className="h-[80vh] flex flex-col items-center justify-center">
          <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg text-center border border-red-100 dark:border-red-900 max-w-md animate-in zoom-in-95">
            <h2 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">Falha ao Carregar Relatórios</h2>
            <p className="text-red-500 dark:text-red-400/80 mb-4">{initError}</p>
            <p className="text-sm text-slate-500 mb-6">
              Não foi possível carregar os dados do Firebase. Verifique a conexão e tente novamente.
            </p>
            <div className="flex justify-center">
                <button 
                    onClick={() => window.location.reload()} 
                    className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-lg shadow-red-600/30 transition-all font-medium"
                >
                  Tentar Novamente
                </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const isEntrada = selectedMovement === 'Entrada' || selectedTypes.includes('Entrada de Caixa / Contas a Receber');
  const isSaida = selectedMovement === 'Saída' || selectedTypes.includes('Saída de Caixa / Contas a Pagar');
  const extraChargesFilterActive = reportMode === 'receivables' && extraChargesOnly;

  return (
    <Layout>
      <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            Relatórios Personalizados
          </h1>
          <p className="text-slate-500 dark:text-slate-400">Gere relatórios PDF com filtros granulares e totais evidenciados.</p>
        </div>

        {/* Quick Report Mode Selector */}
        <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row gap-2">
            <button
                onClick={() => handleModeChange('general')}
                className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all
                ${reportMode === 'general' 
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white ring-2 ring-slate-400/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
            >
                <Layers className="h-4 w-4" />
                Geral (Lançamento)
            </button>
            <button
                onClick={() => handleModeChange('payables')}
                className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all
                ${reportMode === 'payables' 
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 ring-2 ring-red-500/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:bg-red-50/50 dark:hover:bg-red-900/10'}`}
            >
                <ArrowDownCircle className="h-4 w-4" />
                Contas a Pagar (Vencimento)
            </button>
            <button
                onClick={() => handleModeChange('receivables')}
                className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all
                ${reportMode === 'receivables' 
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'}`}
            >
                <ArrowUpCircle className="h-4 w-4" />
                Contas a Receber (Vencimento)
            </button>
        </div>

        {/* Filters and Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
                {/* Filters UI (Config Panel, Specific Filters, Sort, Types) */}
                 <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                        Período e Base de Data
                      </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                     <div className="sm:col-span-3">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Considerar data de:</label>
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                            <button onClick={() => setDateFilterType('date')} className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors ${dateFilterType === 'date' ? 'bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Lançamento</button>
                            <button onClick={() => setDateFilterType('dueDate')} className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors ${dateFilterType === 'dueDate' ? 'bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Vencimento</button>
                            <button onClick={() => setDateFilterType('paymentDate')} className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors ${dateFilterType === 'paymentDate' ? 'bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Pagamento/Baixa</button>
                        </div>
                     </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Data Início</label>
                      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full form-input rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"/>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Data Fim</label>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full form-input rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"/>
                    </div>
                  </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                        <Filter className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                        Filtros Específicos
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                             <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1"><Activity className="h-4 w-4" /> Status</label>
                             <select className="w-full form-select rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                                <option value="">Todos (Aberto + Pago)</option>
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                             </select>
                        </div>
                        <div>
                             <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1"><Landmark className="h-4 w-4" /> Conta Bancária</label>
                             <select className="w-full form-select rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500" value={selectedBank} onChange={(e) => setSelectedBank(e.target.value)}>
                                <option value="">Todas</option>
                                {availableBanks.map(b => <option key={b} value={b}>{b}</option>)}
                             </select>
                        </div>
                        <div>
                             <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1"><ArrowLeftRight className="h-4 w-4" /> Movimentação</label>
                             <select className="w-full form-select rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500" value={selectedMovement} onChange={(e) => { setSelectedMovement(e.target.value); setReportMode('general'); setExtraChargesOnly(false); setWixInvoicesOnly(false); }}>
                                <option value="">Todas</option>
                                <option value="Entrada">Entradas / Receitas</option>
                                <option value="Saída">Saídas / Despesas</option>
                             </select>
                        </div>
                         {/* NOVO CAMPO: SELETOR DE CLIENTES */}
                        <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                <Users className="h-4 w-4" /> 
                                Cliente / Favorecido
                            </label>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                <input 
                                    type="text" 
                                    list="report-clients-list"
                                    value={selectedClient} 
                                    onChange={(e) => setSelectedClient(e.target.value)}
                                    placeholder="Buscar cliente..."
                                    className="w-full pl-8 form-input rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400"
                                />
                                <datalist id="report-clients-list">
                                    {availableClients.map((client, idx) => (
                                        <option key={`${client}-${idx}`} value={client} />
                                    ))}
                                </datalist>
                                {selectedClient && (
                                    <button 
                                        onClick={() => setSelectedClient('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500"
                                    >
                                        <span className="text-xs font-bold">✕</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        {reportMode === 'receivables' && (
                          <>
                            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${extraChargesOnly ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                                <input
                                    type="checkbox"
                                    checked={extraChargesOnly}
                                    onChange={(e) => {
                                      setExtraChargesOnly(e.target.checked);
                                      if (e.target.checked) setWixInvoicesOnly(false);
                                    }}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                        Somente lançamentos com Cobranças Extras
                                    </span>
                                    <span className="block mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        No PDF, a coluna Lanç. será substituída por Cobrança Extra; CPF/CNPJ será preservado e o valor cobrado continuará na coluna Extras.
                                    </span>
                                </span>
                            </label>
                            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${wixInvoicesOnly ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                                <input
                                    type="checkbox"
                                    checked={wixInvoicesOnly}
                                    onChange={(e) => {
                                      setWixInvoicesOnly(e.target.checked);
                                      if (e.target.checked) setExtraChargesOnly(false);
                                    }}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                        Somente Faturas Wix
                                    </span>
                                    <span className="block mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        Exibe apenas as faturas emitidas pelo Wix, preservando as datas originais de lançamento, vencimento e recebimento.
                                    </span>
                                </span>
                            </label>
                          </>
                        )}
                    </div>
            </div>

            {/* SEÇÃO DE ORDENAÇÃO */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                    <ArrowUpDown className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                    Ordenação
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                         <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Ordenar Por</label>
                         <select 
                            className="w-full form-select rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500"
                            value={sortField}
                            onChange={(e) => setSortField(e.target.value as SortField)}
                         >
                            <option value="date">Data Lançamento</option>
                            <option value="dueDate">Data Vencimento</option>
                            <option value="paymentDate">Data Pagamento/Baixa</option>
                            <option value="client">Cliente / Favorecido</option>
                            {isEntrada && <option value="clientNumber">N.Cliente</option>}
                            <option value="valorOriginal">Valor (Original)</option>
                         </select>
                    </div>
                    <div>
                         <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Ordem</label>
                         <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                            <button 
                              onClick={() => setSortDirection('asc')} 
                              className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2 ${sortDirection === 'asc' ? 'bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                            >
                                <ArrowUp className="h-4 w-4" /> Crescente
                            </button>
                            <button 
                              onClick={() => setSortDirection('desc')} 
                              className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2 ${sortDirection === 'desc' ? 'bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                            >
                                <ArrowDown className="h-4 w-4" /> Decrescente
                            </button>
                         </div>
                    </div>
                </div>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Layers className="h-5 w-5 text-slate-500 dark:text-slate-400" /> Tipos de Transação</h3>
                 <div className="text-sm space-x-3">
                    <button onClick={selectAllTypes} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">Todos</button>
                    <button onClick={clearTypes} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">Nenhum</button>
                 </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                {availableTypes.map((type) => {
                  const isSelected = selectedTypes.includes(type);
                  const isSpecial = type.includes('Entrada de Caixa') || type.includes('Saida de Caixa');
                  return (
                    <div key={type} onClick={() => toggleType(type)} className={`cursor-pointer flex items-center p-3 rounded-lg border transition-all ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-200' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'} ${isSpecial ? 'ring-1 ring-blue-100 dark:ring-blue-800' : ''}`}>
                      {isSelected ? <CheckSquare className="h-5 w-5 mr-3 text-blue-600 dark:text-blue-400 shrink-0" /> : <Square className="h-5 w-5 mr-3 text-slate-400 dark:text-slate-500 shrink-0" />}
                      <span className={`text-sm font-medium break-words leading-tight ${isSpecial ? 'font-bold' : ''}`}>{type}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            </div>

            <div className="lg:col-span-1">
                 {/* Preview Panel - Reused from previous implementation */}
                 <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg sticky top-6 transition-colors">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-6">
                  <PieChart className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                  Prévia e Totais
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

                    <div className="space-y-4">
                       
                       {/* ENTRADAS */}
                       <div className="space-y-1">
                           <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 px-1">
                               <span>Entradas Efetivadas</span>
                               <span>A Receber (Pendente)</span>
                           </div>
                           <div className="flex gap-2">
                               <div className="flex-1 bg-green-50 dark:bg-green-900/20 p-2 rounded border border-green-100 dark:border-green-900/30 flex flex-col justify-center">
                                   <span className="text-[10px] text-green-600 dark:text-green-400/70">Pago</span>
                                   <span className="font-bold text-green-700 dark:text-green-400 text-sm">{formatCurrency(kpi.settledReceivables)}</span>
                               </div>
                               <div className="flex-1 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded border border-yellow-100 dark:border-yellow-900/30 flex flex-col justify-center">
                                   <span className="text-[10px] text-yellow-600 dark:text-yellow-400/70">Pendente</span>
                                   <span className="font-bold text-yellow-700 dark:text-yellow-400 text-sm">{formatCurrency(kpi.pendingReceivables)}</span>
                               </div>
                           </div>
                           <div className="text-right text-xs font-semibold text-green-600 dark:text-green-400 mt-1">
                               Total Previsto: {formatCurrency(kpi.totalReceived)}
                           </div>
                       </div>
                       
                       <hr className="border-slate-100 dark:border-slate-800" />

                       {/* SAÍDAS */}
                       <div className="space-y-1">
                           <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 px-1">
                               <span>Saídas Efetivadas</span>
                               <span className="font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1">
                                   <AlertTriangle className="h-3 w-3" />
                                   A Pagar (Pendente)
                               </span>
                           </div>
                           <div className="flex gap-2">
                               <div className="flex-1 bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700 flex flex-col justify-center opacity-70">
                                   <span className="text-[10px] text-slate-500">Pago</span>
                                   <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">{formatCurrency(kpi.settledPayables)}</span>
                               </div>
                               <div className="flex-1 bg-red-50 dark:bg-red-900/30 p-2 rounded border border-red-200 dark:border-red-800 flex flex-col justify-center shadow-inner">
                                   <span className="text-[10px] text-red-600 dark:text-red-400/70 font-bold uppercase">A Pagar</span>
                                   <span className="font-extrabold text-red-700 dark:text-red-400 text-sm">{formatCurrency(kpi.pendingPayables)}</span>
                               </div>
                           </div>
                           <div className="text-right text-xs font-semibold text-red-600 dark:text-red-400 mt-1">
                               Total Previsto (Saídas): {formatCurrency(kpi.totalPaid)}
                           </div>
                       </div>

                       <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                          <span className="font-medium text-slate-700 dark:text-slate-300">Saldo Previsto</span>
                          <span className={`font-bold text-lg ${kpi.balance >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                             {formatCurrency(kpi.balance)}
                          </span>
                       </div>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={handleGeneratePDF}
                            disabled={filteredData.length === 0 || generating}
                            className="w-full py-3 bg-slate-900 dark:bg-slate-700 text-white rounded-xl font-semibold shadow-lg hover:bg-slate-800 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group"
                        >
                            {generating ? (
                                <>
                                <RefreshCw className="h-5 w-5 animate-spin" />
                                <span>Gerando PDF...</span>
                                </>
                            ) : (
                                <>
                                <Download className="h-5 w-5 group-hover:translate-y-1 transition-transform" />
                                <span>Baixar PDF</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* TABELA DE PRÉVIA */}
                    <div className="mt-8">
                       <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Prévia dos Dados (Primeiros 50 registros)
                       </h3>
                       <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-[10px]">
                             <thead className="bg-slate-50 dark:bg-slate-800">
                                <tr>
                                   <th className="px-3 py-2 text-left font-medium text-slate-500 uppercase">{extraChargesFilterActive ? 'Cobrança Extra' : 'Data'}</th>
                                   <th className="px-3 py-2 text-left font-medium text-slate-500 uppercase">Venc.</th>
                                   <th className="px-3 py-2 text-left font-medium text-slate-500 uppercase">Cliente</th>
                                   {isEntrada && <th className="px-3 py-2 text-left font-medium text-slate-500 uppercase">N.Cliente</th>}
                                   {isSaida && <th className="px-3 py-2 text-left font-medium text-slate-500 uppercase">Observação - A Pagar</th>}
                                   <th className="px-3 py-2 text-left font-medium text-slate-500 uppercase">Status</th>
                                   <th className="px-3 py-2 text-right font-medium text-slate-500 uppercase">{extraChargesFilterActive ? 'Valor Extra' : 'Valor'}</th>
                                </tr>
                             </thead>
                             <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                                {filteredData.slice(0, 50).map((row) => (
                                   <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td
                                          className={`px-3 py-2 text-slate-600 dark:text-slate-400 ${extraChargesFilterActive ? 'truncate max-w-[180px]' : 'whitespace-nowrap'}`}
                                          title={extraChargesFilterActive ? formatExtraChargeDescription(row.cobrancaExtra) : undefined}
                                      >
                                          {extraChargesFilterActive ? formatExtraChargeDescription(row.cobrancaExtra) || '-' : formatDate(row.date)}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400 font-medium">{formatDate(row.dueDate)}</td>
                                      <td className="px-3 py-2 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[150px]">{row.client || '-'}</td>
                                      {isEntrada && <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-500">{row.clientNumber ?? '-'}</td>}
                                      {isSaida && <td className="px-3 py-2 text-slate-500 dark:text-slate-500 truncate max-w-[150px]">{row.observacaoAPagar || '-'}</td>}
                                      <td className="px-3 py-2 whitespace-nowrap">
                                         <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                                            isPaidStatus(row.status) ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                                         }`}>
                                            {row.status}
                                         </span>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-slate-700 dark:text-slate-300">
                                         {formatCurrency(extraChargesFilterActive ? parseMoneyValue(row.valorExtra) : getOriginalAmount(row))}
                                      </td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>
                    </div>
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
