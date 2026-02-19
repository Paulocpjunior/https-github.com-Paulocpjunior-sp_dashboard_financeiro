
import { FilterState, KPIData, PaginatedResult, Transaction } from '../types';
import { BackendService } from './backendService';
import { MOCK_TRANSACTIONS } from '../constants';

// In-memory cache to store data fetched from Sheet
let CACHED_TRANSACTIONS: Transaction[] = [];
let isDataLoaded = false;
let lastUpdatedAt: Date | null = null;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let autoRefreshListeners: Array<() => void> = [];

// Intervalo padrão de auto-refresh: 1 minuto (60000ms)
const AUTO_REFRESH_INTERVAL_MS = 1 * 60 * 1000;

// Função para normalizar texto (remove acentos)
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

  /**
   * Fetches data from the backend (Google Sheet) and updates local cache.
   * Call this when Dashboard mounts.
   */
  loadData: async (): Promise<void> => {
    try {
      const data = await BackendService.fetchTransactions();
      
      // Store data directly. BackendService now ensures sorting (Desc) and format.
      CACHED_TRANSACTIONS = data;

      isDataLoaded = true;
      lastUpdatedAt = new Date();
    } catch (error) {
      console.error("Failed to load transactions", error);
      throw error;
    }
  },

  loadMockData: (): void => {
    console.warn("Carregando dados de exemplo (Mock Mode)");
    CACHED_TRANSACTIONS = MOCK_TRANSACTIONS;
    isDataLoaded = true;
    lastUpdatedAt = new Date();
    // Notificar todos os listeners que o cache foi atualizado
    autoRefreshListeners.forEach(fn => fn());
  },

  refreshCache: async (): Promise<void> => {
    isDataLoaded = false;
    await DataService.loadData();
    // Notificar todos os listeners que o cache foi atualizado
    autoRefreshListeners.forEach(fn => fn());
  },

  /**
   * Retorna a data/hora da última atualização dos dados.
   */
  getLastUpdatedAt: (): Date | null => {
    return lastUpdatedAt;
  },

  /**
   * Inicia o auto-refresh periódico. Se já estiver ativo, reinicia o timer.
   * @param intervalMs Intervalo em milissegundos (padrão: AUTO_REFRESH_INTERVAL_MS)
   */
  startAutoRefresh: (intervalMs?: number): void => {
    DataService.stopAutoRefresh(); // Limpa timer anterior se existir
    const interval = intervalMs || AUTO_REFRESH_INTERVAL_MS;
    
    autoRefreshTimer = setInterval(async () => {
      try {
        console.log(`[AutoRefresh] Atualizando dados... (${new Date().toLocaleTimeString('pt-BR')})`);
        await DataService.refreshCache();
      } catch (error) {
        console.error('[AutoRefresh] Erro ao atualizar:', error);
      }
    }, interval);
    
    console.log(`[AutoRefresh] Ativado a cada ${interval / 1000}s`);
  },

  /**
   * Para o auto-refresh periódico.
   */
  stopAutoRefresh: (): void => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      console.log('[AutoRefresh] Desativado');
    }
  },

  /**
   * Verifica se o auto-refresh está ativo.
   */
  isAutoRefreshActive: (): boolean => {
    return autoRefreshTimer !== null;
  },

  /**
   * Registra um listener que será chamado sempre que o cache for atualizado.
   * Retorna uma função de cleanup para remover o listener.
   */
  onRefresh: (callback: () => void): (() => void) => {
    autoRefreshListeners.push(callback);
    return () => {
      autoRefreshListeners = autoRefreshListeners.filter(fn => fn !== callback);
    };
  },

  /**
   * Extracts unique values from a specific column to populate filter dropdowns dynamically.
   */
  getUniqueValues: (field: keyof Transaction): string[] => {
    if (!isDataLoaded) return [];
    const values = new Set(CACHED_TRANSACTIONS.map(t => String(t[field]).trim()).filter(Boolean));
    return Array.from(values).sort();
  },

  /**
   * Calcula estatísticas globais específicas para o Header:
   * - Entradas: Contas a Receber em Aberto (Pendente/Agendado)
   * - Saídas: Contas a Pagar em Aberto (Pendente/Agendado)
   * - Saldo: Saldo Realizado (Caixa atual)
   */
  getGlobalStats: (): KPIData => {
    if (!isDataLoaded) return { totalPaid: 0, totalReceived: 0, balance: 0 };
    
    let pendingReceivables = 0; // Entradas Globais (Em Aberto)
    let pendingPayables = 0;    // Saídas Globais (Em Aberto)
    let actualBalance = 0;      // Saldo Acumulado (Realizado)

    CACHED_TRANSACTIONS.forEach(t => {
        const statusLower = (t.status || '').toLowerCase();
        const isPaid = statusLower === 'pago';
        const isPending = statusLower === 'pendente' || statusLower === 'agendado';

        // 1. Saldo Acumulado (Cash on Hand) -> SOMENTE PAGOS
        // Este é o dinheiro que realmente existe na conta hoje.
        if (isPaid) {
            actualBalance += (t.valueReceived - t.valuePaid);
        }

        // 2. Filtros Solicitados para Entradas/Saídas Globais (EM ABERTO)
        if (isPending) {
            
            // Entradas Globais: "Contas a Receber" e "Saldo a Receber em aberto"
            if (t.movement === 'Entrada' || t.valueReceived > 0) {
                pendingReceivables += t.valueReceived;
            }

            // Saídas Globais: "Contas a Pagar" e "Pendente/A Pagar"
            if (t.movement === 'Saída' || t.valuePaid > 0) {
                pendingPayables += t.valuePaid;
            }
        }
    });

    return {
        totalReceived: pendingReceivables, // Reflete "A Receber em Aberto"
        totalPaid: pendingPayables,       // Reflete "A Pagar em Aberto"
        balance: actualBalance            // Reflete "Saldo em Caixa"
    };
  },

  /**
   * Filters the locally cached data.
   * This remains synchronous for high-performance UI filtering.
   */
  getTransactions: (
    filters: Partial<FilterState>,
    page: number = 1,
    pageSize: number = 20
  ): { result: PaginatedResult<Transaction>; kpi: KPIData } => {
    
    // 1. Filter Data
    let filtered = CACHED_TRANSACTIONS.filter((item) => {
      let matches = true;

      // ID Filter
      if (filters.id && !item.id.toLowerCase().includes(filters.id.toLowerCase())) matches = false;

      // Lançamento Date Filter
      if (filters.startDate && item.date < filters.startDate) matches = false;
      if (filters.endDate && item.date > filters.endDate) matches = false;

      // Due Date Filter (Vencimento)
      if (filters.dueDateStart && item.dueDate < filters.dueDateStart) matches = false;
      if (filters.dueDateEnd && item.dueDate > filters.dueDateEnd) matches = false;

      // Payment Date Filter (Data Pagamento)
      // Aplica-se apenas se a transação tem data de pagamento definida
      if (filters.paymentDateStart && (!item.paymentDate || item.paymentDate < filters.paymentDateStart)) matches = false;
      if (filters.paymentDateEnd && (!item.paymentDate || item.paymentDate > filters.paymentDateEnd)) matches = false;

      // Receipt Date Filter (Data Recebimento)
      // Na prática, usa o mesmo campo 'paymentDate' (Data Baixa), mas a UI separa por contexto
      if (filters.receiptDateStart && (!item.paymentDate || item.paymentDate < filters.receiptDateStart)) matches = false;
      if (filters.receiptDateEnd && (!item.paymentDate || item.paymentDate > filters.receiptDateEnd)) matches = false;
      
      // Strict filtering for dropdowns
      if (filters.bankAccount && item.bankAccount !== filters.bankAccount) matches = false;
      if (filters.type && item.type !== filters.type) matches = false;
      if (filters.status && item.status !== filters.status) matches = false;
      if (filters.movement && item.movement !== filters.movement) matches = false;
      if (filters.paidBy && item.paidBy !== filters.paidBy) matches = false;
      
      // Partial match for Client (allows typing)
      if (filters.client) {
        if (!item.client.toLowerCase().includes(filters.client.toLowerCase())) matches = false;
      }

      // Global Search
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        // Optimize: check common fields first
        if (
            !item.client.toLowerCase().includes(searchLower) &&
            !item.bankAccount.toLowerCase().includes(searchLower) &&
            !item.type.toLowerCase().includes(searchLower)
        ) {
             // Fallback to full string check
             const rowString = Object.values(item).join(' ').toLowerCase();
             if (!rowString.includes(searchLower)) matches = false;
        }
      }

      return matches;
    });

    // 2. Detecta se é modo "Contas a Pagar" ou "Contas a Receber"
    const normalizedType = normalizeText(filters.type || '');
    const isContasAPagar = normalizedType.includes('saida') || 
                          normalizedType.includes('pagar') ||
                          normalizedType.includes('contas a pagar');
    const isContasAReceber = normalizedType.includes('entrada') || 
                          normalizedType.includes('receber');

    // 3. Calculate KPIs based on filter type
    let kpi: KPIData;

    if (isContasAPagar) {
      // ============================================================
      // CORREÇÃO: LÓGICA PARA CONTAS A PAGAR
      // ============================================================
      // - Total Geral = soma de TODOS os valuePaid (independente do status)
      // - Total Pago  = soma dos valuePaid onde status = "Pago"
      // - Saldo a Pagar (Pendente) = soma dos valuePaid onde status = "Pendente" ou "Agendado"
      // ============================================================
      
      const totalGeral = filtered.reduce((acc, curr) => acc + curr.valuePaid, 0);
      
      const totalPago = filtered
        .filter(item => item.status === 'Pago')
        .reduce((acc, curr) => acc + curr.valuePaid, 0);
      
      // CORREÇÃO PRINCIPAL: calcular pendente DIRETAMENTE dos itens pendentes
      // Em vez de (totalGeral - totalPago), que pode dar errado se houver status "Agendado"
      const totalPendente = filtered
        .filter(item => item.status === 'Pendente' || item.status === 'Agendado')
        .reduce((acc, curr) => acc + curr.valuePaid, 0);

      kpi = {
        totalPaid: totalPago,        // Card "Total Pago" (verde)
        totalReceived: totalGeral,   // Card "Total Geral" (azul)
        balance: totalPendente,      // Card "Saldo a Pagar" (vermelho/amber) = PENDENTES
      };
    } else if (isContasAReceber) {
      // ============================================================
      // LÓGICA PARA CONTAS A RECEBER
      // ============================================================
      // - Total Geral a Receber = soma de TODOS os totalCobranca
      // - Valor Recebido = soma dos valueReceived onde status = "Pago"
      // - Saldo a Receber = Total Geral - Valor Recebido
      // ============================================================
      
      const totalGeralReceber = filtered.reduce((acc, curr) => acc + (curr.totalCobranca || curr.valueReceived || 0), 0);
      
      const totalRecebido = filtered
        .filter(item => item.status === 'Pago')
        .reduce((acc, curr) => acc + (curr.valueReceived || curr.totalCobranca || 0), 0);
      
      const saldoReceber = totalGeralReceber - totalRecebido;

      kpi = {
        totalReceived: totalGeralReceber,  // Card "Total Geral a Receber"
        totalPaid: totalRecebido,          // Card "Valor Recebido"
        balance: saldoReceber,             // Card "Saldo a Receber"
      };
    } else {
      // LÓGICA PADRÃO para outros tipos (Entradas, Misto, etc.)
      kpi = filtered.reduce(
        (acc, curr) => {
          // Para Entradas Pendentes, usar totalCobranca como valor de referência
          const entradaVal = curr.movement === 'Entrada' && curr.status === 'Pendente' && curr.valueReceived === 0
            ? (curr.totalCobranca || 0)
            : curr.valueReceived;
          return {
            totalPaid: acc.totalPaid + curr.valuePaid,
            totalReceived: acc.totalReceived + entradaVal,
            balance: acc.balance + (entradaVal - curr.valuePaid),
          };
        },
        { totalPaid: 0, totalReceived: 0, balance: 0 }
      );
    }

    // 4. Paginate
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const data = filtered.slice(start, end);

    return {
      result: {
        data,
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
      'ID',
      'Data Lançamento',
      'Data Vencimento',
      'Data Baixa',
      'Conta',
      'Tipo',
      'Status',
      'Cliente',
      'Pago Por',
      'Movimento',
      'Valor Pago',
      'Valor Recebido',
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(';')]
        .concat(
          result.data.map((row) =>
            [
              row.id,
              row.date,
              row.dueDate,
              row.paymentDate || '',
              row.bankAccount,
              row.type,
              row.status,
              `"${row.client}"`,
              row.paidBy,
              row.movement,
              row.valuePaid.toFixed(2).replace('.', ','),
              row.valueReceived.toFixed(2).replace('.', ','),
            ].join(';')
          )
        )
        .join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `cashflow_export_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};
