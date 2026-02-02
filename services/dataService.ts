import { FilterState, KPIData, PaginatedResult, Transaction } from '../types';
import { BackendService } from './backendService';

// In-memory cache to store data fetched from Sheet
let CACHED_TRANSACTIONS: Transaction[] = [];
let isDataLoaded = false;

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
      
      // Robust mapping to ensure dates don't crash the app
      CACHED_TRANSACTIONS = data.map(t => {
        let cleanDate = new Date().toISOString().split('T')[0]; // Default to today if fail
        try {
            if (t.date) {
                const d = new Date(t.date);
                if (!isNaN(d.getTime())) {
                    cleanDate = d.toISOString().split('T')[0];
                }
            }
        } catch (e) {
            console.warn('Date parsing error for transaction:', t.id);
        }

        return {
            ...t,
            date: cleanDate
        };
      });

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

      if (filters.startDate && item.date < filters.startDate) matches = false;
      if (filters.endDate && item.date > filters.endDate) matches = false;
      
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
        const rowString = Object.values(item).join(' ').toLowerCase();
        if (!rowString.includes(searchLower)) matches = false;
      }

      return matches;
    });

    // 2. Calculate KPIs on filtered data
    const kpi: KPIData = filtered.reduce(
      (acc, curr) => ({
        totalPaid: acc.totalPaid + curr.valuePaid,
        totalReceived: acc.totalReceived + curr.valueReceived,
        balance: acc.balance + (curr.valueReceived - curr.valuePaid),
      }),
      { totalPaid: 0, totalReceived: 0, balance: 0 }
    );

    // 3. Paginate
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
    // We reuse the getTransactions logic to get the filtered dataset
    // We pass a huge pageSize to get all filtered rows
    const { result } = DataService.getTransactions(filters, 1, 999999);
    const headers = [
      'ID',
      'Date',
      'Bank Account',
      'Type',
      'Status',
      'Client',
      'Paid By',
      'Movement',
      'Value Paid',
      'Value Received',
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(';')]
        .concat(
          result.data.map((row) =>
            [
              row.id,
              row.date,
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