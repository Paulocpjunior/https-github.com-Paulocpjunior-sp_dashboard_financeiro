import NativeEntryDetails from './NativeEntryDetails';
import BoletoIssueModal from './BoletoIssueModal';

import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Search, Loader2, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown, Download, Ban } from 'lucide-react';
import { getOriginalAmount, getPaidAmount, getOutstandingAmount, isPaidStatus, isSaidaTransaction } from '../utils/transactionAmounts';
import { getPaymentMethod } from '../utils/paymentMethod';
import { PossibleDuplicateScan, TransactionSortDirection, TransactionSortField } from '../utils/transactionTable';

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
  isReceivablesMode?: boolean;
  allData?: Transaction[];
  canDelete?: boolean;
  canExportBoletoCloud?: boolean;
  onDelete?: (id: string) => void;
  onPayable?: (id: string) => void;
  onClientClick?: (clientName: string) => void;
  sortField: TransactionSortField;
  sortDirection: TransactionSortDirection;
  onSortChange: (field: TransactionSortField, direction: TransactionSortDirection) => void;
  possibleDuplicates?: PossibleDuplicateScan;
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
    selectedType = '',
    isReceivablesMode = false,
    allData = [],
    canDelete = false,
    canExportBoletoCloud = false,
    onDelete,
    onPayable,
    onClientClick,
    sortField,
    sortDirection,
    onSortChange,
    possibleDuplicates,
}) => {

  const [nativeDetails, setNativeDetails] = useState<Transaction | null>(null);
  const [showBoletoModal, setShowBoletoModal] = useState(false);

  const handleSort = (field: TransactionSortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        onSortChange(field, 'desc');
      } else {
        onSortChange('none', 'asc');
      }
    } else {
      onSortChange(field, 'asc');
    }
  };

  const canUseDelete = canDelete && Boolean(onDelete);

  const renderDeleteButton = (id: string) => (
    <button
      onClick={() => canUseDelete && onDelete?.(id)}
      disabled={!canUseDelete}
      className={`p-1 transition-colors rounded-md ${
        canUseDelete
          ? 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-slate-300 dark:text-slate-700 opacity-50 cursor-not-allowed'
      }`}
      title={canUseDelete ? 'Excluir' : 'Apenas administradores podem excluir'}
    >
      <Ban className="h-4 w-4" />
    </button>
  );

  const SortIcon = ({ field }: { field: TransactionSortField }) => {
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

  const getClientNumber = (row: Transaction): string => {
    const rawValue = row.clientNumber;
    if (rawValue === null || rawValue === undefined || rawValue === '') return '-';
    return String(rawValue).trim() || '-';
  };

  const normalizedType = normalizeText(selectedType || '');
  
  const isContasAPagar = normalizedType.includes('saida') || 
                         normalizedType.includes('pagar') ||
                         normalizedType.includes('fornecedor') ||
                         normalizedType.includes('imposto') ||
                         normalizedType.includes('aluguel');
  
  const isContasAReceber = isReceivablesMode ||
                           normalizedType.includes('entrada') ||
                           normalizedType.includes('receber') ||
                           normalizedType.includes('servico') ||
                           normalizedType.includes('consultoria');

  const isMixedMode = !isContasAPagar && !isContasAReceber;

  // Cobranças pendentes exibidas no contador de boletos.

  // 1. Identificar todos os dados pendentes disponíveis (não apenas da página atual)
  const pendingReceivablesData = useMemo(() => {
    const source = (allData && allData.length > 0) ? allData : data;
    return source.filter(row => {
      const paymentMethod = normalizeText(getPaymentMethod(row));
      return !row.isExcluded && (row.status === 'Pendente' || row.status === 'Agendado' || row.status === 'Vencida') &&
        !isSaidaTransaction(row) &&
        paymentMethod.includes('boleto');
    });
  }, [allData, data]);

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

  // Cálculo Robusto de Dias em Atraso
  const calcDiasAtraso = (dueDate: string, status: string) => {
    // 1. Normalizar status para ignorar pagos
    if (isPaidStatus(status)) return 0;

    // 2. Verificar se data existe
    if (!dueDate || dueDate === '1970-01-01') return 0;
    
    // 3. Obter data de Hoje (00:00:00)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    // 4. Parse manual da data de vencimento (YYYY-MM-DD) para evitar bugs de timezone (UTC vs Local)
    const parts = dueDate.split('-');
    if (parts.length !== 3) return 0;
    
    // new Date(ano, mesIndex, dia) cria data no fuso local corretamente
    const vencimento = new Date(
        parseInt(parts[0]), 
        parseInt(parts[1]) - 1, 
        parseInt(parts[2])
    );
    vencimento.setHours(0, 0, 0, 0);
    
    // 5. Comparação: Atraso só existe se Vencimento < Hoje
    if (vencimento.getTime() >= hoje.getTime()) return 0;
    
    // 6. Diferença em dias
    const diffTime = hoje.getTime() - vencimento.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  };

  const getColSpan = () => {
    if (isContasAPagar) return 8;
    if (isContasAReceber) return 12;
    return 6;
  };

  const SortableHeader = ({ field, label, className = '' }: { field: TransactionSortField; label: string; className?: string }) => (
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

  const boletoEligibleCount = pendingReceivablesData.length;

  // Derivar estado do botão "Selecionar Todos" com base na busca atual

  const renderDuplicateBadge = (row: Transaction) => {
    const signal = possibleDuplicates?.byTransactionId.get(row.id);
    if (!signal) return null;
    const highRisk = signal.reasons.includes('paid-open') || signal.reasons.includes('submission');
    return (
      <span
        className={`ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold ${highRisk ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}
        title="Possível duplicidade: revise os lançamentos antes de qualquer ação"
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        DUPLICIDADE
      </span>
    );
  };

  return (
    <>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-colors relative">
        {possibleDuplicates && possibleDuplicates.transactionCount > 0 && (
          <div className="px-3 py-2 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="text-xs font-medium">
              {possibleDuplicates.transactionCount} lançamentos em {possibleDuplicates.groupCount} grupo{possibleDuplicates.groupCount === 1 ? '' : 's'} com indício de duplicidade. A comparação considera pagos e pendentes dentro dos demais filtros. Revise antes de baixar ou excluir; nenhuma correção é automática.
            </span>
          </div>
        )}
        
        {/* Emissão e consulta de boletos em Contas a Receber */}
        {isContasAReceber && canExportBoletoCloud && (
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              📋 Contas a Receber
              {boletoEligibleCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded text-[10px] font-bold">
                  {boletoEligibleCount} boleto{boletoEligibleCount > 1 ? 's' : ''} {boletoEligibleCount === 1 ? 'elegível' : 'elegíveis'}
                </span>
              )}
            </span>
            <button
              onClick={() => {
                  setShowBoletoModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Emitir / consultar boletos
            </button>
          </div>
        )}

        <div className="overflow-x-auto min-h-[400px]">
          {/* ... (Tabela Principal Mantida Inalterada) ... */}
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                {isContasAPagar && (
                  <>
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Lanç.</th>
                    <SortableHeader field="dueDate" label="Venc." className="text-left" />
                    <SortableHeader field="receiptDate" label="Pgto." className="text-left" />
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Tipo</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase min-w-[150px]">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 cursor-pointer hover:text-blue-500" onClick={() => handleSort('client')}>
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
                    <SortableHeader field="cpfCnpj" label="CPF/CNPJ" className="text-left" />
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                    <th className="px-2 py-2 text-right font-medium text-amber-600 dark:text-amber-400 uppercase">A Pagar</th>
                    <th className="px-2 py-2 text-right font-medium text-green-600 dark:text-green-400 uppercase">Pago</th>
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Ações</th>
                  </>
                )}

                {isContasAReceber && (
                  <>
                    <SortableHeader field="dueDate" label="Venc." className="text-left" />
                    <SortableHeader field="receiptDate" label="Receb." className="text-left" />
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Atraso</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase min-w-[140px]">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 cursor-pointer hover:text-blue-500" onClick={() => handleSort('client')}>
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
                    <SortableHeader field="clientNumber" label="N.Cliente" className="text-center" />
                    <SortableHeader field="cpfCnpj" label="CPF/CNPJ" className="text-left" />
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Honor.</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Extras</th>
                    <th className="px-2 py-2 text-right font-medium text-blue-600 dark:text-blue-400 uppercase">Total</th>
                    <th className="px-2 py-2 text-right font-medium text-green-600 dark:text-green-400 uppercase">Recebido</th>
                    <th className="px-2 py-2 text-right font-medium text-amber-600 dark:text-amber-400 uppercase">Saldo</th>
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Método</th>
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Ações</th>
                  </>
                )}

                {isMixedMode && (
                  <>
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Data</th>
                    <SortableHeader field="dueDate" label="Venc." className="text-left" />
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Tipo</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase min-w-[150px]">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 cursor-pointer hover:text-blue-500" onClick={() => handleSort('client')}>
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
                    <SortableHeader field="cpfCnpj" label="CPF/CNPJ" className="text-left" />
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Valor</th>
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Ações</th>
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
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={getColSpan()} className="px-6 py-10 text-center text-slate-500">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const isRowSaida = isSaidaTransaction(row);
                  const isPago = isPaidStatus(row.status);
                  const isPending = !isPago;
                  const diasAtraso = calcDiasAtraso(row.dueDate, row.status);
                  const saldoRestante = getOutstandingAmount(row);
                  const isVencido = diasAtraso > 0;

                  return (
                    <tr key={row.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${possibleDuplicates?.byTransactionId.has(row.id) ? 'bg-amber-50/70 dark:bg-amber-900/15 ring-1 ring-inset ring-amber-300/60' : isVencido ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                      
                      {isContasAPagar && (
                        <>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.paymentDate || '')}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300">Saída</span>
                          </td>
                          <td 
                            className="px-2 py-2 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[180px] cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline" 
                            title={row.description || row.client || '-'}
                            onClick={() => onClientClick && onClientClick(row.client)}
                          >
                            {row.description || row.client || '-'}
                            {renderDuplicateBadge(row)}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                            {row.cpfCnpj || '-'}
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
                            {isPending ? formatCurrency(getOriginalAmount(row)) : 'R$ 0,00'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-right text-green-600 dark:text-green-400 font-medium">
                            {isPago ? formatCurrency(getPaidAmount(row)) : 'R$ 0,00'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-center">
                            {row.source === 'native-finance' && <button className="text-blue-600 text-xs underline mr-2" onClick={() => setNativeDetails(row)}>Detalhes</button>}
                            {onPayable && isSaidaTransaction(row) && <button className="px-2 py-1 rounded text-blue-600 border mr-2" onClick={() => onPayable(row.id)}>Gerenciar conta</button>}
                            {renderDeleteButton(row.id)}
                          </td>
                        </>
                      )}

                      {isContasAReceber && (
                        <>
                          <td className={`px-2 py-2 whitespace-nowrap font-medium ${isVencido ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
                            {formatDateFull(row.dueDate)}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                            {isPago ? (
                              <span className="text-green-600 dark:text-green-400">{formatDateFull(row.paymentDate || '')}</span>
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
                          <td 
                            className="px-2 py-2 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[160px] cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline" 
                            title={row.client || '-'}
                            onClick={() => onClientClick && onClientClick(row.client)}
                          >
                            {row.client || '-'}
                            {renderDuplicateBadge(row)}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-center text-xs font-bold text-blue-600 dark:text-blue-400">
                            {getClientNumber(row)}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                            {row.cpfCnpj || '-'}
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
                            {formatCurrency(getOriginalAmount(row))}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-right text-green-600 dark:text-green-400 font-medium">
                            {formatCurrency(getPaidAmount(row))}
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
                              {getPaymentMethod(row) || '-'}
                            </span>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-center">
                            {row.source === 'native-finance' && <button className="text-blue-600 text-xs underline mr-2" onClick={() => setNativeDetails(row)}>Detalhes</button>}
                            {onPayable && isSaidaTransaction(row) && <button className="px-2 py-1 rounded text-blue-600 border mr-2" onClick={() => onPayable(row.id)}>Gerenciar conta</button>}
                            {renderDeleteButton(row.id)}
                          </td>
                        </>
                      )}

                      {isMixedMode && (
                        <>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              isRowSaida ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                            }`}>
                              {isRowSaida ? 'Saída' : 'Entrada'}
                            </span>
                          </td>
                          <td 
                            className="px-2 py-2 text-slate-900 dark:text-slate-100 font-medium truncate max-w-[180px] cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                            onClick={() => onClientClick && onClientClick(row.client)}
                          >
                            {isRowSaida ? (row.description || row.client || '-') : (row.client || '-')}
                            {renderDuplicateBadge(row)}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                            {row.cpfCnpj || '-'}
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
                                {formatCurrency(getOriginalAmount(row))}
                              </span>
                            ) : (
                              <span className="text-green-600 dark:text-green-400 flex items-center justify-end gap-0.5 font-medium">
                                <ArrowUpCircle className="h-3 w-3" />
                                {formatCurrency(getOriginalAmount(row))}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-center">
                            {row.source === 'native-finance' && <button className="text-blue-600 text-xs underline mr-2" onClick={() => setNativeDetails(row)}>Detalhes</button>}
                            {onPayable && isSaidaTransaction(row) && <button className="px-2 py-1 rounded text-blue-600 border mr-2" onClick={() => onPayable(row.id)}>Gerenciar conta</button>}
                            {renderDeleteButton(row.id)}
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

      {nativeDetails && <NativeEntryDetails row={nativeDetails} onClose={() => setNativeDetails(null)} />}
      {/* MODAL DE EXPORTAÇÃO EM 2 ETAPAS */}
      {showBoletoModal && <BoletoIssueModal rows={(allData.length ? allData : data).filter(row => !isSaidaTransaction(row) && normalizeText(getPaymentMethod(row)).includes('boleto'))} duplicates={possibleDuplicates} onClose={() => setShowBoletoModal(false)} />}

    </>
  );
};

export default DataTable;
