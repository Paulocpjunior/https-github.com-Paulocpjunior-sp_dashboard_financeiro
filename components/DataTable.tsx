import React from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

interface DataTableProps {
  data: Transaction[];
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
}

const DataTable: React.FC<DataTableProps> = ({ data, page, totalPages, onPageChange }) => {
  // Garante formatação BRL com separador de milhar e 2 casas decimais
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR');
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-colors">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Data</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Conta</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tipo</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cliente/Descrição</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-red-500 dark:text-red-400 uppercase tracking-wider">Valor Pago</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">Valor Recebido</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
            {data.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                  Nenhum registro encontrado.
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                    {formatDate(row.date)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                    {row.bankAccount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                      {row.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-900 dark:text-slate-100 font-medium max-w-xs truncate" title={row.client}>
                    {row.client}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                     <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                      ${row.status === 'Pago' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                        row.status === 'Pendente' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'}
                     `}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-red-600 dark:text-red-400 bg-red-50/30 dark:bg-red-900/10">
                     {row.valuePaid > 0 ? (
                        <div className="flex items-center justify-end gap-1">
                          <ArrowDownCircle className="h-3 w-3" />
                          {formatCurrency(row.valuePaid)}
                        </div>
                     ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                     )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-green-600 dark:text-green-400 bg-green-50/30 dark:bg-green-900/10">
                     {row.valueReceived > 0 ? (
                        <div className="flex items-center justify-end gap-1">
                          <ArrowUpCircle className="h-3 w-3" />
                          {formatCurrency(row.valueReceived)}
                        </div>
                     ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                     )}
                  </td>
                </tr>
              ))
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
                disabled={page <= 1}
                className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="sr-only">Anterior</span>
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages}
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
  );
};

export default DataTable;