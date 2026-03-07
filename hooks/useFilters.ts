
import { useState, useCallback, useMemo, useEffect } from 'react';
import { FilterState } from '../types';

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

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
}

const STORAGE_KEY = 'sp_contabil_saved_filters';

const normalizeText = (text: string) => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

export const useFilters = () => {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  // Load saved filters on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setSavedFilters(JSON.parse(stored));
      } catch (e) {
        console.error("Error parsing saved filters", e);
      }
    }
  }, []);

  const isContasAPagar = useMemo(() => {
    const normalizedType = normalizeText(filters.type || '');
    return normalizedType.includes('saida') || 
           normalizedType.includes('pagar') ||
           normalizedType.includes('fornecedor') ||
           normalizedType.includes('aluguel') ||
           filters.movement === 'Saída';
  }, [filters.type, filters.movement]);

  const isContasAReceber = useMemo(() => {
    const normalizedType = normalizeText(filters.type || '');
    return normalizedType.includes('entrada') || 
           normalizedType.includes('receber') ||
           normalizedType.includes('servico') ||
           filters.movement === 'Entrada';
  }, [filters.type, filters.movement]);

  const handleFilterChange = useCallback((key: keyof FilterState, value: string) => {
    setFilters(prev => {
      const newFilters = { ...prev, [key]: value };
      
      // Automatic date migration logic
      // If we change startDate/endDate and it's payables/receivables, maybe we want to sync with dueDates?
      // Or if we set a specific date filter, we might want to clear others to avoid conflicts.
      
      return newFilters;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);

  const setDateRange = useCallback((start: string, end: string, isDueDate = false) => {
    setFilters(prev => ({
      ...prev,
      startDate: isDueDate ? '' : start,
      endDate: isDueDate ? '' : end,
      dueDateStart: isDueDate ? start : '',
      dueDateEnd: isDueDate ? end : '',
    }));
  }, []);

  const applyViewMode = useCallback((mode: 'general' | 'payables' | 'receivables') => {
    if (mode === 'general') {
      setFilters(INITIAL_FILTERS);
    } else if (mode === 'payables') {
      setFilters({
        ...INITIAL_FILTERS,
        movement: 'Saída',
        status: 'Pendente'
      });
    } else if (mode === 'receivables') {
      setFilters({
        ...INITIAL_FILTERS,
        movement: 'Entrada',
        status: 'Pendente'
      });
    }
  }, []);

  const saveFilter = useCallback((name: string) => {
    const newFilter: SavedFilter = {
      id: Date.now().toString(),
      name,
      filters: { ...filters }
    };
    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [filters, savedFilters]);

  const loadSavedFilter = useCallback((id: string) => {
    const found = savedFilters.find(f => f.id === id);
    if (found) {
      setFilters(found.filters);
    }
  }, [savedFilters]);

  const deleteSavedFilter = useCallback((id: string) => {
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [savedFilters]);

  return {
    filters,
    setFilters,
    isContasAPagar,
    isContasAReceber,
    handleFilterChange,
    clearFilters,
    setDateRange,
    applyViewMode,
    savedFilters,
    saveFilter,
    loadSavedFilter,
    deleteSavedFilter
  };
};
