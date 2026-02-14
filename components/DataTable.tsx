
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Search, Loader2, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown, Download, X, CheckSquare, Square, CheckCircle2, Filter, Key } from 'lucide-react';

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
  allData?: Transaction[];
  onDelete?: (id: string) => void;
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
    selectedType = '',
    allData = [],
    onDelete
}) => {
  const [sortField, setSortField] = useState<SortField>('none');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportClients, setSelectedExportClients] = useState<string[]>([]);
  const [exportSearchTerm, setExportSearchTerm] = useState('');
  
  // Novo Estado: Token para Exportação (Persistente)
  const [exportToken, setExportToken] = useState(() => {
      if (typeof window !== 'undefined') {
          return localStorage.getItem('boleto_cloud_token') || '';
      }
      return '';
  });
  
  // Ref para controlar inicialização e evitar loop de re-seleção
  const hasInitializedExport = useRef(false);

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

  const handleTokenChange = (val: string) => {
      setExportToken(val);
      localStorage.setItem('boleto_cloud_token', val);
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

  // --- LÓGICA DE EXPORTAÇÃO COM SELEÇÃO DE CLIENTES ---

  // 1. Identificar todos os dados pendentes disponíveis (não apenas da página atual)
  const pendingReceivablesData = useMemo(() => {
    const source = allData.length > 0 ? allData : data;
    return source.filter(row => 
      (row.status === 'Pendente' || row.status === 'Agendado')
    );
  }, [allData, data]);

  // 2. Extrair clientes únicos dos pendentes
  const availableExportClients = useMemo(() => {
    const clients = new Set(pendingReceivablesData.map(t => t.client).filter(Boolean));
    return Array.from(clients).sort();
  }, [pendingReceivablesData]);

  // 3. Inicializar seleção quando o modal abre ou dados mudam
  useEffect(() => {
    if (showExportModal) {
        // Inicializa apenas uma vez por abertura de modal para evitar sobrescrever a ação do usuário
        if (!hasInitializedExport.current && availableExportClients.length > 0) {
            setSelectedExportClients(availableExportClients); // Selecionar todos por padrão
            hasInitializedExport.current = true;
        }
    } else {
        // Resetar quando fecha
        hasInitializedExport.current = false;
        setSelectedExportClients([]);
        setExportSearchTerm('');
    }
  }, [showExportModal, availableExportClients]);

  const toggleExportClient = (client: string) => {
    setSelectedExportClients(prev => 
      prev.includes(client) ? prev.filter(c => c !== client) : [...prev, client]
    );
  };

  const filteredExportClients = availableExportClients.filter(client => 
    client.toLowerCase().includes(exportSearchTerm.toLowerCase())
  );

  const toggleAllExportClients = () => {
    // Determina qual lista estamos manipulando (Todos ou Filtrados)
    const targetList = exportSearchTerm ? filteredExportClients : availableExportClients;
    
    // Verifica se TODOS da lista alvo estão selecionados
    const areAllTargetSelected = targetList.every(c => selectedExportClients.includes(c));

    if (areAllTargetSelected) {
      if (exportSearchTerm) {
         // Desmarcar apenas os visíveis no filtro
         setSelectedExportClients(prev => prev.filter(c => !targetList.includes(c)));
      } else {
         // Desmarcar todos globalmente
         setSelectedExportClients([]);
      }
    } else {
      if (exportSearchTerm) {
         // Marcar os visíveis (mantendo os que já estavam marcados fora do filtro)
         const newSelection = new Set([...selectedExportClients, ...targetList]);
         setSelectedExportClients(Array.from(newSelection));
      } else {
         // Marcar todos globalmente
         setSelectedExportClients(availableExportClients);
      }
    }
  };

  // 4. Função Final de Exportação
  const handleConfirmExport = () => {
    if (selectedExportClients.length === 0) {
      alert('Selecione pelo menos um cliente para exportar.');
      return;
    }

    if (!exportToken) {
        if (!confirm('O Token da Conta Bancária está vazio. O arquivo pode ser rejeitado. Deseja continuar mesmo assim?')) {
            return;
        }
    }

    // Filtrar dados baseados nos clientes selecionados
    const dataToExport = pendingReceivablesData.filter(row => 
      selectedExportClients.includes(row.client)
    );

    // Formato CSV Específico Solicitado (Layout Boleto)
    const headers = [
      'TOKEN_CONTA_BANCARIA',
      'CPRF_PAGADOR',
      'VALOR',
      'VENCIMENTO',
      'NOSSO_NUMERO',
      'DOCUMENTO',
      'MULTA',
      'JUROS',
      'DIAS_PARA_ENCARGOS',
      'DESCONTO',
      'DIAS_PARA_DESCONTO',
      'TIPO_VALOR_DESCONTO',
      'DESCONTO2',
      'DIAS_PARA_DESCONTO2',
      'TIPO_VALOR_DESCONTO2',
      'DESCONTO3',
      'DIAS_PARA_DESCONTO3',
      'TIPO_VALOR_DESCONTO3',
      'INFORMACAO_PAGADOR'
    ];

    // FIX: Alterado para formato DD/MM/YYYY (Padrão Brasileiro para Boleto)
    const formatDateCSV = (dateStr: string) => {
      if (!dateStr || dateStr === '1970-01-01') return '';
      const [year, month, day] = dateStr.split('-');
      return `${day}/${month}/${year}`;
    };

    const formatValueCSV = (val: number | string | undefined) => {
      const num = Number(val || 0);
      return num.toFixed(2); // Formato: 1234.56
    };

    const getDescricao = (row: Transaction) => {
      if (row.description) return row.description;
      const date = new Date(row.dueDate);
      const mes = date.toLocaleString('pt-BR', { month: 'long' });
      const ano = date.getFullYear();
      return `Honorarios ${mes}/${ano}`;
    };

    // Função auxiliar para tentar extrair CPF/CNPJ do nome do cliente
    const extractCpfCnpj = (text: string) => {
        // Procura por padrões de CPF (XXX.XXX.XXX-XX) ou CNPJ (XX.XXX.XXX/XXXX-XX)
        const match = text.match(/(\d{2,3}\.?\d{3}\.?\d{3}[\/\-]?\d{4}[\-]?\d{2})|(\d{3}\.?\d{3}\.?\d{3}[\-]?\d{2})/);
        return match ? match[0] : '';
    };

    const rows = dataToExport.map(row => {
        const valor = formatValueCSV(row.totalCobranca || row.honorarios);
        const vencimento = formatDateCSV(row.dueDate);
        const documento = `"${(getDescricao(row) || '').replace(/"/g, '""')}"`;
        const infoPagador = `"${(row.client || '').replace(/"/g, '""')}"`;
        const cpfCnpj = extractCpfCnpj(row.client || '');

        // Mapeamento para as 19 colunas esperadas
        return [
            exportToken, // TOKEN_CONTA_BANCARIA (Preenchido pelo usuário no modal)
            cpfCnpj,     // CPRF_PAGADOR (Tentativa de extração ou vazio)
            valor,       // VALOR
            vencimento,  // VENCIMENTO (DD/MM/YYYY)
            '',          // NOSSO_NUMERO
            documento,   // DOCUMENTO (Usando a descrição do serviço)
            '',          // MULTA
            '',          // JUROS
            '',          // DIAS_PARA_ENCARGOS
            '',          // DESCONTO
            '',          // DIAS_PARA_DESCONTO
            '',          // TIPO_VALOR_DESCONTO
            '',          // DESCONTO2
            '',          // DIAS_PARA_DESCONTO2
            '',          // TIPO_VALOR_DESCONTO2
            '',          // DESCONTO3
            '',          // DIAS_PARA_DESCONTO3
            '',          // TIPO_VALOR_DESCONTO3
            infoPagador  // INFORMACAO_PAGADOR (Nome do Cliente para identificação)
        ];
    });

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.join(';'))
    ].join('\n');

    // BOM para UTF-8 no Excel
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const hoje = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `boletos_importacao_${hoje}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setShowExportModal(false);
    alert(`✅ Arquivo gerado com layout corrigido (Data DD/MM/YYYY e Token) para ${selectedExportClients.length} clientes.`);
  };

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
          // Using paymentDate as substitute for receiptDate since it's the effective date
          const recA = new Date(a.paymentDate || '1970-01-01').getTime();
          const recB = new Date(b.paymentDate || '1970-01-01').getTime();
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

  // Cálculo Robusto de Dias em Atraso
  const calcDiasAtraso = (dueDate: string, status: string) => {
    // 1. Normalizar status para ignorar pagos
    const st = (status || '').toLowerCase().trim();
    const isPaid = st === 'pago' || st === 'recebido' || st === 'liquidado';
    if (isPaid) return 0;

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

  const calcSaldoRestante = (total: number, recebido: number) => {
    const saldo = (total || 0) - (recebido || 0);
    return saldo > 0 ? saldo : 0;
  };

  const getColSpan = () => {
    if (isContasAPagar) return 8;
    if (isContasAReceber) return 11;
    return 6;
  };

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

  // Contar pendentes para mostrar no botão
  const pendentesCount = useMemo(() => {
    const dataToCount = allData.length > 0 ? allData : data;
    return dataToCount.filter(row => row.status === 'Pendente' || row.status === 'Agendado').length;
  }, [data, allData]);

  // Derivar estado do botão "Selecionar Todos" com base na busca atual
  const areAllVisibleSelected = filteredExportClients.length > 0 && filteredExportClients.every(c => selectedExportClients.includes(c));
  const isSelectionEmpty = selectedExportClients.length === 0;

  return (
    <>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-colors relative">
        
        {/* Header com botão de exportar - Apenas Contas a Receber */}
        {isContasAReceber && (
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              📋 Contas a Receber
              {pendentesCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded text-[10px] font-bold">
                  {pendentesCount} pendente{pendentesCount > 1 ? 's' : ''}
                </span>
              )}
            </span>
            <button
              onClick={() => {
                  if (pendentesCount === 0) {
                      alert('Nenhum boleto pendente para exportar.');
                      return;
                  }
                  setShowExportModal(true);
                  setExportSearchTerm('');
              }}
              disabled={pendentesCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar .CSV Boletos
            </button>
          </div>
        )}

        <div className="overflow-x-auto min-h-[400px]">
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
                    <th className="px-2 py-2 text-left font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                    <th className="px-2 py-2 text-right font-medium text-amber-600 dark:text-amber-400 uppercase">A Pagar</th>
                    <th className="px-2 py-2 text-right font-medium text-green-600 dark:text-green-400 uppercase">Pago</th>
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
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Status</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Honor.</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500 dark:text-slate-400 uppercase">Extras</th>
                    <th className="px-2 py-2 text-right font-medium text-blue-600 dark:text-blue-400 uppercase">Total</th>
                    <th className="px-2 py-2 text-right font-medium text-green-600 dark:text-green-400 uppercase">Recebido</th>
                    <th className="px-2 py-2 text-right font-medium text-amber-600 dark:text-amber-400 uppercase">Saldo</th>
                    <th className="px-2 py-2 text-center font-medium text-slate-500 dark:text-slate-400 uppercase">Método</th>
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
                  // Fix: Cast 'Recebido' since it's not in the Transaction.status type union but might come from data
                  const isPago = row.status === 'Pago' || (row.status as string) === 'Recebido';

                  return (
                    <tr key={row.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isVencido ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                      
                      {isContasAPagar && (
                        <>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 font-medium">{formatDate(row.dueDate)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(row.paymentDate || '')}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300">Saída</span>
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
                            {isPending ? formatCurrency(row.valuePaid) : 'R$ 0,00'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-right text-green-600 dark:text-green-400 font-medium">
                            {isPago ? formatCurrency(row.valuePaid) : 'R$ 0,00'}
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

      {/* MODAL DE SELEÇÃO DE CLIENTES PARA EXPORTAÇÃO */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 border border-slate-200 dark:border-slate-800">
             
             {/* Header */}
             <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                 <div className="flex items-center gap-3">
                     <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                         <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                     </div>
                     <div>
                         <h2 className="text-lg font-bold text-slate-800 dark:text-white">Exportação de Boletos</h2>
                         <p className="text-xs text-slate-500 dark:text-slate-400">Selecione os clientes para gerar o arquivo CSV</p>
                     </div>
                 </div>
                 <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                     <X className="h-5 w-5" />
                 </button>
             </div>

             {/* Search and Toolbar */}
             <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-4">
                 
                 {/* Input Token da Conta */}
                 <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-100 dark:border-amber-800">
                     <div className="p-1.5 bg-white dark:bg-slate-800 rounded border border-amber-200 dark:border-amber-700 text-amber-600 dark:text-amber-400">
                         <Key className="h-4 w-4" />
                     </div>
                     <div className="flex-1">
                         <label className="block text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">Token da Conta Bancária (Boleto Cloud)</label>
                         <input 
                            type="text" 
                            placeholder="Insira o token de integração da conta..." 
                            value={exportToken}
                            onChange={(e) => handleTokenChange(e.target.value)}
                            className="w-full text-sm bg-transparent border-0 border-b border-amber-300 dark:border-amber-700 focus:ring-0 focus:border-amber-500 px-0 py-1 text-slate-800 dark:text-white placeholder:text-slate-400"
                         />
                     </div>
                 </div>

                 <div className="flex gap-4 items-center flex-wrap">
                     <div className="relative flex-1">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                         <input 
                            type="text" 
                            placeholder="Buscar cliente..." 
                            value={exportSearchTerm}
                            onChange={(e) => setExportSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                         />
                     </div>
                     <div className="flex gap-2">
                         <button 
                            onClick={toggleAllExportClients}
                            className="px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition-colors flex items-center gap-2"
                         >
                             {areAllVisibleSelected ? (
                                 <><CheckSquare className="h-3.5 w-3.5" /> Desmarcar Todos</>
                             ) : (
                                 <><Square className="h-3.5 w-3.5" /> Marcar Todos</>
                             )}
                         </button>
                     </div>
                 </div>
             </div>

             {/* Clients List */}
             <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-900/50 min-h-[300px]">
                 {filteredExportClients.length === 0 ? (
                     <div className="flex flex-col items-center justify-center h-full text-slate-400">
                         <Filter className="h-8 w-8 mb-2 opacity-50" />
                         <p className="text-sm">Nenhum cliente encontrado.</p>
                     </div>
                 ) : (
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                         {filteredExportClients.map(client => {
                             const isSelected = selectedExportClients.includes(client);
                             return (
                                 <div 
                                    key={client} 
                                    onClick={() => toggleExportClient(client)}
                                    className={`
                                        cursor-pointer flex items-center p-3 rounded-lg border transition-all select-none
                                        ${isSelected 
                                            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' 
                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700'}
                                    `}
                                 >
                                     <div className={`
                                        flex items-center justify-center h-5 w-5 rounded border mr-3 shrink-0 transition-colors
                                        ${isSelected 
                                            ? 'bg-emerald-500 border-emerald-500 text-white' 
                                            : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500 text-transparent'}
                                     `}>
                                         <CheckSquare className="h-3.5 w-3.5" />
                                     </div>
                                     <span className={`text-sm truncate ${isSelected ? 'font-medium text-emerald-900 dark:text-emerald-100' : 'text-slate-600 dark:text-slate-300'}`}>
                                         {client}
                                     </span>
                                 </div>
                             );
                         })}
                     </div>
                 )}
             </div>

             {/* Footer */}
             <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-xl flex items-center justify-between">
                 <div className="text-xs text-slate-500 dark:text-slate-400">
                     <span className="font-semibold text-slate-900 dark:text-white">{selectedExportClients.length}</span> cliente(s) selecionado(s)
                 </div>
                 <div className="flex gap-3">
                     <button 
                        onClick={() => setShowExportModal(false)}
                        className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                     >
                         Cancelar
                     </button>
                     <button 
                        onClick={handleConfirmExport}
                        disabled={selectedExportClients.length === 0}
                        className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg shadow-emerald-600/30 text-sm font-medium transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                     >
                         <Download className="h-4 w-4" />
                         Gerar Arquivo
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
