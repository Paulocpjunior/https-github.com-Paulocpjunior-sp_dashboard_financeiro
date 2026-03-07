
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Transaction, FilterState, KPIData } from '../types';
import { DataService } from '../services/dataService';

interface FinancialDataContextType {
  transactions: Transaction[];
  allTransactions: Transaction[];
  kpi: KPIData;
  totalPages: number;
  options: {
    bankAccounts: string[];
    types: string[];
    statuses: string[];
    movements: string[];
    clients: string[];
    paidBys: string[];
  };
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  loadData: () => Promise<void>;
  refreshData: () => Promise<void>;
  applyFilters: (filters: Partial<FilterState>, page: number) => void;
  loadMockData: () => void;
}

const FinancialDataContext = createContext<FinancialDataContextType | undefined>(undefined);

export const FinancialDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [kpi, setKpi] = useState<KPIData>({ totalPaid: 0, totalReceived: 0, balance: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const options = useMemo(() => ({
    bankAccounts: DataService.getUniqueValues('bankAccount'),
    types: DataService.getUniqueValues('type'),
    statuses: DataService.getUniqueValues('status'),
    movements: DataService.getUniqueValues('movement'),
    clients: DataService.getUniqueValues('client'),
    paidBys: DataService.getUniqueValues('paidBy'),
  }), [allTransactions]);

  const applyFilters = useCallback((filters: Partial<FilterState>, page: number) => {
    try {
      const { result, kpi: newKpi } = DataService.getTransactions(filters, page, 20);
      setTransactions(result.data);
      setTotalPages(result.totalPages);
      setKpi(newKpi);
      
      // Also get all filtered data for reports/alerts
      const { result: allFiltered } = DataService.getTransactions(filters, 1, 999999);
      setAllTransactions(allFiltered.data);
    } catch (err) {
      console.error("Error applying filters:", err);
    }
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await DataService.loadData();
      setLastUpdated(DataService.getLastUpdatedAt());
      // Initial load with empty filters
      applyFilters({}, 1);
    } catch (err: any) {
      setError(err.message || "Falha ao carregar dados.");
    } finally {
      setIsLoading(false);
    }
  }, [applyFilters]);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await DataService.refreshCache();
      setLastUpdated(DataService.getLastUpdatedAt());
      // Re-apply current filters would be handled by the component using this context
      // but we can trigger a refresh of the current view here if we stored filters in state
    } catch (err: any) {
      console.error("Refresh error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const loadMockData = useCallback(() => {
    DataService.loadMockData();
    setLastUpdated(DataService.getLastUpdatedAt());
    applyFilters({}, 1);
  }, [applyFilters]);

  // Listen for DataService updates (auto-refresh)
  useEffect(() => {
    const unsubscribe = DataService.onRefresh(() => {
      setLastUpdated(DataService.getLastUpdatedAt());
      // When data refreshes, we might want to notify the UI
    });
    return unsubscribe;
  }, []);

  const value = {
    transactions,
    allTransactions,
    kpi,
    totalPages,
    options,
    isLoading,
    error,
    lastUpdated,
    isRefreshing,
    loadData,
    refreshData,
    applyFilters,
    loadMockData,
  };

  return (
    <FinancialDataContext.Provider value={value}>
      {children}
    </FinancialDataContext.Provider>
  );
};

export const useFinancialData = () => {
  const context = useContext(FinancialDataContext);
  if (context === undefined) {
    throw new Error('useFinancialData must be used within a FinancialDataProvider');
  }
  return context;
};
