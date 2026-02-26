
import { FilterState, KPIData, PaginatedResult, Transaction } from '../types';
import { BackendService } from './backendService';
import { MOCK_TRANSACTIONS } from '../constants';

// In-memory cache
let CACHED_TRANSACTIONS: Transaction[] = [];
let isDataLoaded = false;
let isMockMode = false;
let lastUpdatedAt: Date | null = null;

// Controle de Concorrência (Evita requisições simultâneas/loops)
let currentLoadPromise: Promise<void> | null = null;

// Timer para Auto-Refresh
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let autoRefreshListeners: Array<() => void> = [];

// Constante de Refresh (2 minutos para evitar excesso de requisições)
const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

// Normalização de texto auxiliar
const normalizeText = (text: string) => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

export const DataService = {
  
  get isDataLoaded() {
    return isDataLoaded;
  },

  get isMockMode() {
    return isMockMode;
  },

  /**
   * Carrega os dados.
   * BLINDADO: Se já estiver carregando, retorna a promessa em andamento.
   * Se já estiver carregado e não for refresh forçado, retorna imediatamente.
   */
  loadData: async (forceRefresh = false): Promise<void> => {
    // 1. Loop Breaker: Se já carregou e não é refresh forçado, retorna.
    if (isDataLoaded && !forceRefresh) {
        return;
    }

    // 2. Concurrency Lock: Se já existe uma requisição em andamento, espera por ela.
    if (currentLoadPromise) {
        console.log("[DataService] Requisição já em andamento. Aguardando...");
        return currentLoadPromise;
    }

    // 3. Mock Mode Check
    if (isMockMode) {
        if (CACHED_TRANSACTIONS.length === 0) {
            CACHED_TRANSACTIONS = MOCK_TRANSACTIONS;
        }
        isDataLoaded = true;
        lastUpdatedAt = new Date();
        return;
    }

    // 4. Inicia nova requisição e guarda a promessa
    currentLoadPromise = (async () => {
        try {
            console.log("[DataService] Iniciando fetch de transações...");
            const data = await BackendService.fetchTransactions();
            
            if (!data || !Array.isArray(data)) {
                throw new Error("Formato de dados inválido recebido do backend.");
            }

            CACHED_TRANSACTIONS = data;
            isDataLoaded = true;
            lastUpdatedAt = new Date();
            console.log(`[DataService] Sucesso. ${data.length} registros carregados.`);
        } catch (error) {
            console.error("[DataService] Erro fatal no carregamento:", error);
            isDataLoaded = false;
            // Repassa o erro para a UI tratar (ex: mostrar mensagem de erro),
            // mas garante que o estado de "carregando" seja limpo no finally.
            throw error;
        } finally {
            // Libera o lock para permitir novas tentativas futuras (ex: clique no botão "Tentar Novamente")
            currentLoadPromise = null;
        }
    })();

    return currentLoadPromise;
  },

  /**
   * Ativa modo de demonstração com dados locais.
   */
  loadMockData: (): void => {
    console.warn("[DataService] Ativando Modo Mock");
    CACHED_TRANSACTIONS = MOCK_TRANSACTIONS;
    isDataLoaded = true;
    isMockMode = true;
    lastUpdatedAt = new Date();
    DataService.notifyListeners();
  },

  /**
   * Força uma atualização dos dados.
   */
  refreshCache: async (): Promise<void> => {
    if (isMockMode) return;
    try {
        await DataService.loadData(true);
        DataService.notifyListeners();
    } catch (e) {
        console.error("[DataService] Falha ao recarregar cache:", e);
    }
  },

  getLastUpdatedAt: (): Date | null => lastUpdatedAt,

  // --- Auto Refresh Logic ---

  startAutoRefresh: (intervalMs = AUTO_REFRESH_INTERVAL_MS): void => {
    DataService.stopAutoRefresh();
    if (isMockMode) return;

    autoRefreshTimer = setInterval(async () => {
        console.log('[DataService] Auto-refresh executando...');
        try {
            await DataService.refreshCache();
        } catch (e) {
            console.error('[DataService] Erro silencioso no auto-refresh:', e);
        }
    }, intervalMs);
  },

  stopAutoRefresh: (): void => {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
  },

  onRefresh: (callback: () => void): (() => void) => {
    autoRefreshListeners.push(callback);
    return () => {
      autoRefreshListeners = autoRefreshListeners.filter(fn => fn !== callback);
    };
  },

  notifyListeners: () => {
      autoRefreshListeners.forEach(fn => fn());
  },

  // --- Data Access & Filtering ---

  getUniqueValues: (field: keyof Transaction): string[] => {
    if (!isDataLoaded) return [];
    const values = new Set(CACHED_TRANSACTIONS.map(t => String(t[field] || '').trim()).filter(Boolean));
    return Array.from(values).sort();
  },

  getGlobalStats: (): KPIData => {
    if (!isDataLoaded) return { totalPaid: 0, totalReceived: 0, balance: 0 };
    
    let pendingReceivables = 0;
    let pendingPayables = 0;
    let actualBalance = 0;

    CACHED_TRANSACTIONS.forEach(t => {
        const statusLower = (t.status || '').toLowerCase();
        const isPaid = statusLower === 'pago' || statusLower === 'recebido' || statusLower === 'sim' || statusLower === 'ok';
        const isPending = !isPaid;

        if (isPaid) {
            // Saldo Realizado = Recebido - Pago
            actualBalance += (t.valueReceived - t.valuePaid);
        }

        if (isPending) {
            // Entradas Pendentes
            if (t.movement === 'Entrada' || (t.valueReceived > 0 && t.valuePaid === 0)) {
                // Se tiver TotalCobrança, usa. Senão valueReceived.
                const val = (t.totalCobranca && t.totalCobranca > 0) ? t.totalCobranca : t.valueReceived;
                pendingReceivables += val;
            }
            // Saídas Pendentes
            if (t.movement === 'Saída' || (t.valuePaid > 0 && t.valueReceived === 0)) {
                pendingPayables += t.valuePaid;
            }
        }
    });

    return {
        totalReceived: pendingReceivables, // A Receber
        totalPaid: pendingPayables,       // A Pagar
        balance: actualBalance            // Saldo em Caixa
    };
  },

  getTransactions: (
    filters: Partial<FilterState>,
    page: number = 1,
    pageSize: number = 20
  ): { result: PaginatedResult<Transaction>; kpi: KPIData } => {
    
    let filtered = CACHED_TRANSACTIONS;

    // Apply Filters only if data exists
    if (filtered.length > 0) {
        filtered = filtered.filter((item) => {
          let matches = true;

          if (filters.id && !item.id.toLowerCase().includes(filters.id.toLowerCase())) matches = false;
          
          // Date Filtering
          if (filters.startDate && item.date < filters.startDate) matches = false;
          if (filters.endDate && item.date > filters.endDate) matches = false;

          // Due Date (Vencimento)
          if (filters.dueDateStart && item.dueDate < filters.dueDateStart) matches = false;
          if (filters.dueDateEnd && item.dueDate > filters.dueDateEnd) matches = false;

          // Payment Date
          if (filters.paymentDateStart && (!item.paymentDate || item.paymentDate < filters.paymentDateStart)) matches = false;
          if (filters.paymentDateEnd && (!item.paymentDate || item.paymentDate > filters.paymentDateEnd)) matches = false;

          // Receipt Date
          if (filters.receiptDateStart && (!item.paymentDate || item.paymentDate < filters.receiptDateStart)) matches = false;
          if (filters.receiptDateEnd && (!item.paymentDate || item.paymentDate > filters.receiptDateEnd)) matches = false;
          
          if (filters.bankAccount && item.bankAccount !== filters.bankAccount) matches = false;
          if (filters.type && item.type !== filters.type) matches = false;
          if (filters.status && item.status !== filters.status) matches = false;
          if (filters.movement && item.movement !== filters.movement) matches = false;
          if (filters.paidBy && item.paidBy !== filters.paidBy) matches = false;
          
          if (filters.client && !item.client.toLowerCase().includes(filters.client.toLowerCase())) matches = false;

          if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const rowString = Object.values(item).join(' ').toLowerCase();
            if (!rowString.includes(searchLower)) matches = false;
          }

          return matches;
        });
    }

    // Determine Logic Context (Payables vs Receivables vs General)
    const normalizedType = normalizeText(filters.type || '');
    const isContasAPagar = normalizedType.includes('saida') || normalizedType.includes('pagar') || filters.movement === 'Saída';
    const isContasAReceber = normalizedType.includes('entrada') || normalizedType.includes('receber') || filters.movement === 'Entrada';

    let kpi: KPIData;

    if (isContasAPagar) {
      // KPI Contexto Saída: Total Pago vs Total Pendente
      const totalGeral = filtered.reduce((acc, curr) => acc + curr.valuePaid, 0);
      const totalPago = filtered.filter(i => i.status === 'Pago' || (i.status as string) === 'Recebido').reduce((acc, curr) => acc + curr.valuePaid, 0);
      const totalPendente = totalGeral - totalPago;

      kpi = { totalPaid: totalPago, totalReceived: totalGeral, balance: totalPendente }; 
    } else if (isContasAReceber) {
      // KPI Contexto Entrada: Total Recebido vs Total Pendente
      const totalGeralReceber = filtered.reduce((acc, curr) => acc + (curr.totalCobranca || curr.valueReceived || 0), 0);
      const totalRecebido = filtered.filter(i => i.status === 'Pago' || (i.status as string) === 'Recebido').reduce((acc, curr) => acc + (curr.valueReceived || 0), 0);
      const saldoReceber = totalGeralReceber - totalRecebido;

      kpi = { totalReceived: totalGeralReceber, totalPaid: totalRecebido, balance: saldoReceber };
    } else {
      // KPI Geral (Entradas vs Saídas)
      kpi = filtered.reduce(
        (acc, curr) => ({
            totalPaid: acc.totalPaid + curr.valuePaid,
            totalReceived: acc.totalReceived + curr.valueReceived,
            balance: acc.balance + (curr.valueReceived - curr.valuePaid),
        }),
        { totalPaid: 0, totalReceived: 0, balance: 0 }
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    
    return {
      result: {
        data: filtered.slice(start, end),
        total,
        page,
        pageSize,
        totalPages,
      },
      kpi,
    };
  },

  exportToCSV: (filters: Partial<FilterState>): void => {
    const { result } = DataService.getTransactions(filters, 1, 999999);
    const headers = [
      'ID', 'Data', 'Vencimento', 'Pagamento', 'Conta', 'Tipo', 'Status', 
      'Cliente', 'CPF / CNPJ', 'Movimento', 'Valor Pago', 'Valor Recebido',
      'Honorários', 'Extras', 'Total Cobrança', 'Observação - A Pagar'
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(';')]
        .concat(result.data.map(row => [
              row.id, row.date, row.dueDate, row.paymentDate || '', row.bankAccount, row.type, row.status,
              `"${row.client}"`, `"${row.cpfCnpj || ''}"`, row.movement,
              row.valuePaid.toFixed(2).replace('.', ','),
              row.valueReceived.toFixed(2).replace('.', ','),
              (row.honorarios || 0).toFixed(2).replace('.', ','),
              (row.valorExtra || 0).toFixed(2).replace('.', ','),
              (row.totalCobranca || 0).toFixed(2).replace('.', ','),
              `"${(row.observacaoAPagar || '').replace(/"/g, '""')}"`
            ].join(';')
        )).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `export_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};
