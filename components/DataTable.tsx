import React, { useState } from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, Trash2, AlertTriangle, X, Search, Loader2 } from 'lucide-react';

interface DataTableProps {
  data: Transaction[];
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onDelete?: (id: string) => void;
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
    onDelete,
    clientFilterValue,
    onClientFilterChange,
    clientOptions = [],
    idFilterValue,
    onIdFilterChange,
    isLoading = false,
    selectedType = ''
}) => {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<string | null>(null);

  // Normaliza o texto para comparação
  const normalizeText = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  };

  const normalizedType = normalizeText(selectedType || '');
  
  // Modos de Exibição
  // 1. Modo Saída: Foca em valor a pagar.
  const isExitMode = normalizedType.includes('saida') || 
                     normalizedType.includes('pagar') ||
                     normalizedType.includes('fornecedor') ||
                     normalizedType.includes('imposto') ||
                     normalizedType.includes('aluguel');
  
  // 2. Modo Entrada: Foca em detalhes de recebimento (Honorários, etc).
  const isEntryMode = normalizedType.includes('entrada') || 
                      normalizedType.includes('receber') ||
                      normalizedType.includes('servico') ||
                      normalizedType.includes('consultoria');

  // 3. Modo Misto (Padrão): Exibe coluna unificada de valor.
  const isMixedMode = !isExitMode && !isEntryMode;

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

  const handleDeleteClick = (id: string) => {
    setTransactionToDelete(id);
    setDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (onDelete && transactionToDelete) {
      onDelete(transactionToDelete);
    }
    setDeleteModalOpen(false);
    setTransactionToDelete(null);
  };

  const cancelDelete = () => {
    setDeleteModalOpen(false);
    setTransactionToDelete(null);
  };

  const getDisplayClient = (row: Transaction) => {
    const rowType = normalizeText(row.type || '');
    if (isExitMode || rowType.includes('saida') || rowType.includes('pagar')) {
      return row.movement || row.client || '-';
    }
    return row.client || '-';
  };

  // Calcula colspan dinâmico
  const getColSpan = () => {
    let base = 6; // Date, Due, Type, Client, Status, Actions
    if (isExitMode) return base + 1; // + Valor
    if (isEntryMode) return base + 4; // + Honorarios, Extra, Total, Recebido
    return base + 1; // Mixed: + Valor Unificado
  };

  return (
    <>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-colors">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider w-[100px]">Data</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider w-[100px]">Vencimento</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tipo</th>
                
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[200px]">
                  <div className="flex flex-col gap-2">
                    <span>{isExitMode ? 'Conta / Credor' : 'Cliente / Pagador'}</span>
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
                          {clientOptions.slice(0, 50).map((opt, i) => (
                            <option key={i} value={opt} />
                          ))}
                        </datalist>
                      </div>
                    )}
                  </div>
                </th>
                
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                
                {/* COLUNAS DINÂMICAS DE VALOR */}
                {isMixedMode && (
                   <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Valor</th>
                )}

                {isExitMode && (
                   <th className="px-6 py-3 text-right text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wider">Valor a Pagar</th>
                )}

                {isEntryMode && (
                  <>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Honorários</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Extras</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Total Cobrança</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">Recebido</th>
                  </>
                )}

                <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ações</th>
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
                  const isRowEntrada = !isRowSaida; // Fallback simplificado
                  
                  // Determinar valor principal para exibição mista
                  const displayValue = isRowSaida ? row.valuePaid : (row.totalCobranca || row.valueReceived);
                  const isPaid = row.status === 'Pago';

                  return (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                      
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate max-w-[150px] ${
                          isRowSaida 
                            ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' 
                            : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                        }`}>
                          {row.type}
                        </span>
                      </td>
                      
                      <td className="px-6 py-4 text-sm text-slate-900 dark:text-slate-100 font-medium max-w-xs truncate" title={getDisplayClient(row)}>
                        {getDisplayClient(row)}
                      </td>
                      
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                          ${row.status === 'Pago' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                            row.status === 'Pendente' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'}
                        `}>
                          {row.status}
                        </span>
                      </td>

                      {/* --- COLUNAS DE VALOR --- */}
                      
                      {/* MODO MISTO: Coluna Única Colorida */}
                      {isMixedMode && (
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold">
                           {isRowSaida ? (
                             <span className="text-red-600 dark:text-red-400 flex items-center justify-end gap-1">
                               <ArrowDownCircle className="h-3 w-3" />
                               {formatCurrency(displayValue)}
                             </span>
                           ) : (
                             <span className="text-green-600 dark:text-green-400 flex items-center justify-end gap-1">
                               <ArrowUpCircle className="h-3 w-3" />
                               {formatCurrency(displayValue)}
                             </span>
                           )}
                        </td>
                      )}

                      {/* MODO SAÍDA: Valor Único */}
                      {isExitMode && (
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-red-600 dark:text-red-400 bg-red-50/20 dark:bg-red-900/10">
                           {formatCurrency(row.valuePaid)}
                        </td>
                      )}

                      {/* MODO ENTRADA: Detalhado */}
                      {isEntryMode && (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-slate-600 dark:text-slate-400">
                             {formatCurrency(row.honorarios)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-slate-600 dark:text-slate-400">
                             {formatCurrency(row.valorExtra)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-600 dark:text-blue-400 bg-blue-50/20 dark:bg-blue-900/10">
                             {formatCurrency(row.totalCobranca)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-green-600 dark:text-green-400 bg-green-50/20 dark:bg-green-900/10">
                             {formatCurrency(row.valueReceived)}
                          </td>
                        </>
                      )}

                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                        <button 
                          onClick={() => handleDeleteClick(row.id)}
                          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Excluir Registro"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-white dark:bg-slate-900 px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between sm:px-6">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-700 dark:text-slate-400">
                Página <span className="font-medium">{page}</span> de <span className="font-medium">{totalPages}</span>
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => onPageChange(page - 1)}
                  disabled={page <= 1 || isLoading}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Anterior</span>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages || isLoading}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Próxima</span>
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 print:hidden">
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
            onClick={cancelDelete}
          ></div>

          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-sm w-full p-6 border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            <button 
              onClick={cancelDelete}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-500 dark:hover:text-slate-300"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                Excluir Transação?
              </h3>
              
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Tem certeza que deseja remover este registro? Esta ação não pode ser desfeita e afetará o saldo atual.
              </p>

              <div className="flex gap-3 w-full">
                <button
                  onClick={cancelDelete}
                  className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 shadow-lg shadow-red-600/30 transition-all hover:translate-y-[-1px]"
                >
                  Sim, Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DataTable;