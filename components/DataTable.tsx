import React from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Search, Loader2, Clock, AlertCircle } from 'lucide-react';

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
    idFilterValue,
    onIdFilterChange,
    isLoading = false,
    selectedType = ''
}) => {
  const normalizeText = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
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
    if (isContasAReceber) return 10;
    return 6;
  };

  return (
    <>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-colors">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                {isContasAPagar && (
                  <>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Lançamento</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Vencimento</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Pagamento</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tipo</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[180px]">
                      <div className="flex flex-col gap-1">
                        <span>Movimentação</span>
                        {onClientFilterChange && (
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                            <input 
                              type="text" 
                              list="table-client-options"
                              value={clientFilterValue || ''}
                              onChange={(e) => onClientFilterChange(e.target.value)}
                              placeholder="Filtrar..."
                              className="w-full text-xs py-1 pl-7 pr-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-slate-400 font-normal"
                            />
                            <datalist id="table-client-options">
                              {clientOptions.slice(0, 50).map((opt, i) => <option key={i} value={opt} />)}
                            </datalist>
                          </div>
                        )}
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">Valor a Pagar</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">Valor Pago</th>
                  </>
                )}

                {isContasAReceber && (
                  <>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Vencimento</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[180px]">
                      <div className="flex flex-col gap-1">
                        <span>Cliente / Empresa</span>
                        {onClientFilterChange && (
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                            <input 
                              type="text" 
                              list="table-client-options-receber"
                              value={clientFilterValue || ''}
                              onChange={(e) => onClientFilterChange(e.target.value)}
                              placeholder="Filtrar..."
                              className="w-full text-xs py-1 pl-7 pr-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-slate-400 font-normal"
                            />
                            <datalist id="table-client-options-receber">
                              {clientOptions.slice(0, 50).map((opt, i) => <option key={i} value={opt} />)}
                            </datalist>
                          </div>
                        )}
                      </div>
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Atraso</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Honorários</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Extras</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Total</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">Recebido</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">Saldo</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Método</th>
                  </>
                )}

                {isMixedMode && (
                  <>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Data</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Vencimento</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tipo</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[180px]">
                      <div className="flex flex-col gap-1">
                        <span>Cliente / Movimentação</span>
                        {onClientFilterChange && (
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                            <input 
                              type="text" 
                              list="table-client-options-mixed"
                              value={clientFilterValue || ''}
                              onChange={(e) => onClientFilterChange(e.target.value)}
                              placeholder="Filtrar..."
                              className="w-full text-xs py-1 pl-7 pr-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-slate-400 font-normal"
                            />
                            <datalist id="table-client-options-mixed">
                              {clientOptions.slice(0, 50).map((opt, i) => <option key={i} value={opt} />)}
                            </datalist>
                          </div>
                        )}
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Valor</th>
                  </>
                )}
              </tr>
            </thead>

            <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={getColSpan()} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                      <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">Atualizando dados...</span>
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={getColSpan()} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const rowType = normalizeText(row.type || '');
                  const isRowSaida = rowType.includes('saida') || rowType.includes('pagar') || row.valuePaid > 0;
                  const isPending = row.status === 'Pendente' || row.status === 'Agendado';
                  const diasAtraso = calcDiasAtraso(row.dueDate, row.status);
                  const saldoRestante = calcSaldoRestante(row.totalCobranca, row.valueReceived);
                  const isVencido = diasAtraso > 0;
                  
                  const pendingClass = isPending 
                    ? "font-extrabold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 px-2 py-1 rounded" 
                    : "font-medium";

                  return (
                    <tr key={row.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group ${isVencido ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                      
                      {isContasAPagar && (
                        <>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">{formatDate(row.paymentDate || '')}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate max-w-[100px] bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300">
                              {row.type}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-900 dark:text-slate-100 font-medium max-w-[200px] truncate" title={row.description || row.client || '-'}>
                            {row.description || row.client || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                              ${row.status === 'Pago' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                                isPending ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 
                                'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'}`}>
                              {isPending && <AlertTriangle className="w-3 h-3 mr-1" />}
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right">
                            <span className={`text-amber-600 dark:text-amber-400 ${pendingClass}`}>{formatCurrency(row.valuePaid)}</span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right">
                            <span className="text-green-600 dark:text-green-400 font-medium">
                              {row.status === 'Pago' ? formatCurrency(row.valuePaid) : formatCurrency(0)}
                            </span>
                          </td>
                        </>
                      )}

                      {isContasAReceber && (
                        <>
                          <td className={`px-3 py-3 whitespace-nowrap text-sm font-medium ${isVencido ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
                            {formatDate(row.dueDate)}
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-900 dark:text-slate-100 font-medium max-w-[200px] truncate" title={row.client || '-'}>
                            {row.client || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-center">
                            {diasAtraso > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                <AlertCircle className="w-3 h-3" />
                                {diasAtraso}d
                              </span>
                            ) : row.status === 'Pago' || row.status === 'Recebido' ? (
                              <span className="text-green-600 dark:text-green-400 text-xs">✓</span>
                            ) : (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                              ${row.status === 'Pago' || row.status === 'Recebido' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                                isVencido ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 ring-2 ring-red-500/20' :
                                isPending ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 
                                'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'}`}>
                              {isVencido && <AlertTriangle className="w-3 h-3 mr-1" />}
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right text-slate-600 dark:text-slate-400">
                            {formatCurrency(row.honorarios)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right text-slate-600 dark:text-slate-400">
                            {formatCurrency(row.valorExtra)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right">
                            <span className="text-blue-600 dark:text-blue-400 font-semibold">
                              {formatCurrency(row.totalCobranca)}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right">
                            <span className="text-green-600 dark:text-green-400 font-medium">
                              {formatCurrency(row.valueReceived)}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right">
                            {saldoRestante > 0 ? (
                              <span className="text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded">
                                {formatCurrency(saldoRestante)}
                              </span>
                            ) : (
                              <span className="text-green-600 dark:text-green-400 text-xs">Quitado</span>
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                            <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                              {row.paymentMethod || 'Pix'}
                            </span>
                          </td>
                        </>
                      )}

                      {isMixedMode && (
                        <>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate max-w-[100px] ${
                              isRowSaida ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                            }`}>
                              {row.type}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-900 dark:text-slate-100 font-medium max-w-[200px] truncate">
                            {isRowSaida ? (row.description || row.client || '-') : (row.client || '-')}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                              ${row.status === 'Pago' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                                isPending ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 
                                'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'}`}>
                              {isPending && <AlertTriangle className="w-3 h-3 mr-1" />}
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-right">
                            {isRowSaida ? (
                              <span className={`text-red-600 dark:text-red-400 flex items-center justify-end gap-1 ${pendingClass}`}>
                                <ArrowDownCircle className="h-3 w-3" />
                                {formatCurrency(row.valuePaid)}
                              </span>
                            ) : (
                              <span className={`text-green-600 dark:text-green-400 flex items-center justify-end gap-1 ${pendingClass}`}>
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

        <div className="bg-white dark:bg-slate-900 px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between sm:px-6">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-700 dark:text-slate-400">
                Página <span className="font-medium">{page}</span> de <span className="font-medium">{totalPages}</span>
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                <button
                  onClick={() => onPageChange(page - 1)}
                  disabled={page <= 1 || isLoading}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages || isLoading}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DataTable;