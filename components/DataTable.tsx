import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Search, Loader2, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

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

type SortField = 'client' | 'dueDate' | 'receiptDate' | 'none';
type SortDirection = 'asc' | 'desc';

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
  const [sortField, setSortField] = useState<SortField>('none');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField('none');
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="h-3 w-3 text-slate-400" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="h-3 w-3 text-blue-500" />
      : <ChevronDown className="h-3 w-3 text-blue-500" />;
  };

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

  // Dados ordenados
  const sortedData = useMemo(() => {
    if (sortField === 'none') return data;

    return [...data].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'client':
          const clientA = (a.client || '').toLowerCase();
          const clientB = (b.client || '').toLowerCase();
          comparison = clientA.localeCompare(clientB, 'pt-BR');
          break;
        case 'dueDate':
          const dateA = new Date(a.dueDate || '1970-01-01').getTime();
          const dateB = new Date(b.dueDate || '1970-01-01').getTime();
          comparison = dateA - dateB;
          break;
        case 'receiptDate':
          const recA = new Date(a.receiptDate || a.paymentDate || '1970-01-01').getTime();
          const recB = new Date(b.receiptDate || b.paymentDate || '1970-01-01').getTime();
          comparison = recA - recB;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortField, sortDirection]);

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

  // Cabeçalho ordenável
  const SortableHeader = ({ field, label, className = '' }: { field: SortField; label: string; className?: string }) => (
    <th 
      className={`px-2 py-2 font-medium text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors select-none ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <SortIcon field={field} />
      </div>
    </th>
  );

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
                  <SortableHeader field="dueDate" label="Venc." className="text-left" />
                  <SortableHeader field="receiptDate" label="Pgto." className="text-left" />
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Tipo</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase min-w-[150px]">
                    <div className="flex flex-col gap-1">
                      <div 
                        className="flex items-center gap-1 cursor-pointer hover:text-blue-500 transition-colors"
                        onClick={() => handleSort('client')}
                      >
                        <span>Movimentação</span>
                        <SortIcon field="client" />
                      </div>
                      {onClientFilterChange && (
                        <div className="relative">
                          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                          <input 
                            type="text" 
                            list="table-client-pagar"
                            value={clientFilterValue || ''}
                            onChange={(e) => onClientFilterChange(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
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

              {/* ========== CONTAS A RECEBER ========== */}
              {isContasAReceber && (
                <>
                  <SortableHeader field="dueDate" label="Venc." className="text-left" />
                  <SortableHeader field="receiptDate" label="Receb." className="text-left" />
                  <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Atraso</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase min-w-[140px]">
                    <div className="flex flex-col gap-1">
                      <div 
                        className="flex items-center gap-1 cursor-pointer hover:text-blue-500 transition-colors"
                        onClick={() => handleSort('client')}
                      >
                        <span>Cliente</span>
                        <SortIcon field="client" />
                      </div>
                      {onClientFilterChange && (
                        <div className="relative">
                          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                          <input 
                            type="text" 
                            list="table-client-receber"
                            value={clientFilterValue || ''}
                            onChange={(e) => onClientFilterChange(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Filtrar..."
                            className="w-full text-xs py-0.5 pl-6 pr-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none font-normal"
                          />
                          <datalist id="table-client-receber">
                            {clientOptions.slice(0, 50).map((opt, i) => <option key={i} value={opt} />)}
                          </datalist>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Honor.</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Extras</th>
                  <th className="px-2 py-2 text-right font-medium text-blue-600 dark:text-blue-400 uppercase">Total</th>
                  <th className="px-2 py-2 text-right font-medium text-green-600 dark:text-green-400 uppercase">Recebido</th>
                  <th className="px-2 py-2 text-right font-medium text-amber-600 dark:text-amber-400 uppercase">Saldo</th>
                  <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Método</th>
                </>
              )}

              {/* ========== MODO MISTO ========== */}
              {isMixedMode && (
                <>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Data</th>
                  <SortableHeader field="dueDate" label="Venc." className="text-left" />
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Tipo</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase min-w-[150px]">
                    <div className="flex flex-col gap-1">
                      <div 
                        className="flex items-center gap-1 cursor-pointer hover:text-blue-500 transition-colors"
                        onClick={() => handleSort('client')}
                      >
                        <span>Cliente / Mov.</span>
                        <SortIcon field="client" />
                      </div>
                      {onClientFilterChange && (
                        <div className="relative">
                          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                          <input 
                            type="text" 
                            list="table-client-mixed"
                            value={clientFilterValue || ''}
                            onChange={(e) => onClientFilterChange(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Filtrar..."
                            className="w-full text-xs py-0.5 pl-6 pr-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none font-normal"
                          />
                          <datalist id="table-client-mixed">
                            {clientOptions.slice(0, 50).map((opt, i) => <option key={i} value={opt} />)}
                          </datalist>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Valor</th>
                </>
              )}
            </tr>
          </thead>

          <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
            {isLoading ? (
              <tr>
                <td colSpan={getColSpan()} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                    <span className="text-sm text-slate-500">Carregando...</span>
                  </div>
                </td>
              </tr>
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={getColSpan()} className="px-6 py-10 text-center text-slate-500">
                  Nenhum registro encontrado.
                </td>
              </tr>
            ) : (
              sortedData.map((row) => {
                const rowType = normalizeText(row.type || '');
                const isRowSaida = rowType.includes('saida') || rowType.includes('pagar') || row.valuePaid > 0;
                const isPending = row.status === 'Pendente' || row.status === 'Agendado';
                const diasAtraso = calcDiasAtraso(row.dueDate, row.status);
                const saldoRestante = calcSaldoRestante(row.totalCobranca, row.valueReceived);
                const isVencido = diasAtraso > 0;
                const isPago = row.status === 'Pago' || row.status === 'Recebido';

                return (
                  <tr key={row.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isVencido ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                    
                    {/* ========== LINHAS CONTAS A PAGAR ========== */}
                    {isContasAPagar && (
                      <>
                        <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.paymentDate || '')}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 truncate max-w-[80px] inline-block">
                            Saída
                          </span>
                        </td>
                        <td className="px-2 py-2 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[180px]" title={row.description || row.client || '-'}>
                          {row.description || row.client || '-'}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium inline-flex items-center
                            ${row.status === 'Pago' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                              'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                            {isPending && <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />}
                            {row.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-amber-600 dark:text-amber-400 font-medium">
                          {formatCurrency(row.valuePaid)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-green-600 dark:text-green-400 font-medium">
                          {row.status === 'Pago' ? formatCurrency(row.valuePaid) : 'R$ 0,00'}
                        </td>
                      </>
                    )}

                    {/* ========== LINHAS CONTAS A RECEBER ========== */}
                    {isContasAReceber && (
                      <>
                        <td className={`px-2 py-2 whitespace-nowrap font-medium ${isVencido ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
                          {formatDateFull(row.dueDate)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {isPago ? (
                            <span className="text-green-600 dark:text-green-400">{formatDateFull(row.receiptDate || row.paymentDate || '')}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-center">
                          {diasAtraso > 0 ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              <AlertCircle className="w-2.5 h-2.5" />
                              {diasAtraso}d
                            </span>
                          ) : isPago ? (
                            <span className="text-green-500 text-[10px]">✓</span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[160px]" title={row.client || '-'}>
                          {row.client || '-'}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium inline-flex items-center
                            ${isPago ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                              isVencido ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                              'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                            {isVencido && !isPago && <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />}
                            {row.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                          {formatCurrency(row.honorarios)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                          {formatCurrency(row.valorExtra)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-blue-600 dark:text-blue-400 font-semibold">
                          {formatCurrency(row.totalCobranca)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-green-600 dark:text-green-400 font-medium">
                          {formatCurrency(row.valueReceived)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right">
                          {saldoRestante > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded text-[11px]">
                              {formatCurrency(saldoRestante)}
                            </span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400 text-[10px] font-medium">Quitado</span>
                          )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-center">
                          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">
                            {row.paymentMethod || 'Pix'}
                          </span>
                        </td>
                      </>
                    )}

                    {/* ========== LINHAS MODO MISTO ========== */}
                    {isMixedMode && (
                      <>
                        <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[70px] inline-block ${
                            isRowSaida ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                          }`}>
                            {isRowSaida ? 'Saída' : 'Entrada'}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[180px]">
                          {isRowSaida ? (row.description || row.client || '-') : (row.client || '-')}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium inline-flex items-center
                            ${row.status === 'Pago' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                              'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                            {isPending && <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />}
                            {row.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right">
                          {isRowSaida ? (
                            <span className="text-red-600 dark:text-red-400 flex items-center justify-end gap-0.5 font-medium">
                              <ArrowDownCircle className="h-3 w-3" />
                              {formatCurrency(row.valuePaid)}
                            </span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400 flex items-center justify-end gap-0.5 font-medium">
                              <ArrowUpCircle className="h-3 w-3" />
                              {formatCurrency(row.totalCobranca || row.valueReceived)}
                            </span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="bg-white dark:bg-slate-900 px-3 py-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Pág. <span className="font-medium">{page}</span> de <span className="font-medium">{totalPages}</span>
        </p>
        <div className="flex gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            className="p-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="p-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataTable;