import React from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Search, Loader2, AlertCircle } from 'lucide-react';

interface DataTableProps {
  data: Transaction[];
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  clientFilterValue?: string;
  onClientFilterChange?: (value: string) => void;
  clientOptions?: string[];
  idFilterValue?: string;
  onIdFilterChange?: (value: string) => void;
  isLoading?: boolean;
  selectedType?: string;
}

const DataTable: React.FC<DataTableProps> = ({ 
    data, 
    page, 
    totalPages, 
    onPageChange, 
    clientFilterValue,
    onClientFilterChange,
    clientOptions = [],
    isLoading = false,
    selectedType = ''
}) => {
  const normalizeText = (text: string) => {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };

  const normalizedType = normalizeText(selectedType || '');
  
  const isContasAPagar = normalizedType.includes('saida') || 
                         normalizedType.includes('pagar') ||
                         normalizedType.includes('fornecedor') ||
                         normalizedType.includes('imposto') ||
                         normalizedType.includes('aluguel');
  
  const isContasAReceber = normalizedType.includes('entrada') || 
                           normalizedType.includes('receber') ||
                           normalizedType.includes('servico') ||
                           normalizedType.includes('consultoria');

  const isMixedMode = !isContasAPagar && !isContasAReceber;

  const formatCurrency = (val: number | string | undefined) => {
    const num = Number(val || 0);
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr === '1970-01-01') return '-';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}`;
  };

  const formatDateFull = (dateStr: string) => {
    if (!dateStr || dateStr === '1970-01-01') return '-';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const calcDiasAtraso = (dueDate: string, status: string) => {
    if (status === 'Pago' || status === 'Recebido') return 0;
    if (!dueDate || dueDate === '1970-01-01') return 0;
    
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const vencimento = new Date(dueDate);
    vencimento.setHours(0, 0, 0, 0);
    
    const diffTime = hoje.getTime() - vencimento.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays > 0 ? diffDays : 0;
  };

  const calcSaldoRestante = (total: number, recebido: number) => {
    const saldo = (total || 0) - (recebido || 0);
    return saldo > 0 ? saldo : 0;
  };

  const getColSpan = () => {
    if (isContasAPagar) return 8;
    if (isContasAReceber) return 11;
    return 6;
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-colors">
      <div className="overflow-x-auto min-h-[400px]">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              {/* ========== CONTAS A PAGAR ========== */}
              {isContasAPagar && (
                <>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Lanç.</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Venc.</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Pgto.</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Tipo</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase min-w-[150px]">
                    <div className="flex flex-col gap-1">
                      <span>Movimentação</span>
                      {onClientFilterChange && (
                        <div className="relative">
                          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                          <input 
                            type="text" 
                            list="table-client-pagar"
                            value={clientFilterValue || ''}
                            onChange={(e) => onClientFilterChange(e.target.value)}
                            placeholder="Filtrar..."
                            className="w-full text-xs py-0.5 pl-6 pr-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none font-normal"
                          />
                          <datalist id="table-client-pagar">
                            {clientOptions.slice(0, 50).map((opt, i) => <option key={i} value={opt} />)}
                          </datalist>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                  <th className="px-2 py-2 text-right font-medium text-amber-600 dark:text-amber-400 uppercase">A Pagar</th>
                  <th className="px-2 py-2 text-right font-medium text-green-600 dark:text-green-400 uppercase">Pago</th>
                </>
              )}

              {/* ========== CONTAS A RECEBER (PAISAGEM) ========== */}
              {isContasAReceber && (
                <>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Venc.</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-5