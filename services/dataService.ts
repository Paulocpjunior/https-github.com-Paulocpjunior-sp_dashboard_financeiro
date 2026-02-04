import { FilterState, KPIData, PaginatedResult, Transaction } from '../types';
import { BackendService } from './backendService';

// In-memory cache to store data fetched from Sheet
let CACHED_TRANSACTIONS: Transaction[] = [];
let isDataLoaded = false;

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
    } catch (error) {
      console.error("Failed to load transactions", error);
      throw error;
    }
  },

  refreshCache: async (): Promise<void> => {
    isDataLoaded = false;
    await DataService.loadData();
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

    // 2. Detecta se é modo "Contas a Pagar"
    const normalizedType = normalizeText(filters.type || '');
    const isContasAPagar = normalizedType.includes('saida') || 
                          normalizedType.includes('pagar') ||
                          normalizedType.includes('contas a pagar');

    // 3. Calculate KPIs based on filter type
    let kpi: KPIData;

    if (isContasAPagar) {
      // LÓGICA ESPECIAL PARA CONTAS A PAGAR:
      // - Total Geral = soma de todos os valores (valuePaid) no filtro
      // - Total Pago = soma dos valores onde status = "Pago"
      // - Total Pendente (Saldo) = Total Geral - Total Pago
      
      const totalGeral = filtered.reduce((acc, curr) => acc + curr.valuePaid, 0);
      const totalPago = filtered
        .filter(item => item.status === 'Pago')
        .reduce((acc, curr) => acc + curr.valuePaid, 0);
      const totalPendente = totalGeral - totalPago;

      kpi = {
        totalPaid: totalPago,        // "Total Saídas" = Total já pago
        totalReceived: totalGeral,   // "Total Entradas" = Total Geral (ou pode ser 0)
        balance: totalPendente,      // "Saldo Líquido" = Total pendente a pagar
      };
    } else {
      // LÓGICA PADRÃO para outros tipos
      kpi = filtered.reduce(
        (acc, curr) => ({
          totalPaid: acc.totalPaid + curr.valuePaid,
          totalReceived: acc.totalReceived + curr.valueReceived,
          balance: acc.balance + (curr.valueReceived - curr.valuePaid),
        }),
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