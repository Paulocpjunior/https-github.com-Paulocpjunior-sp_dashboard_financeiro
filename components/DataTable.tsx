
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Transaction } from '../types';
import { ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Search, Loader2, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown, Download, X, CheckSquare, Square, CheckCircle2, Filter, Key, FileText, Save, ArrowRight, ShieldCheck, Ban, Info } from 'lucide-react';
import { logger } from '../utils/logger';
import { toLocalISODate } from '../utils/dateUtils';
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
  allData?: Transaction[];
  canDelete?: boolean;
  canExportBoletoCloud?: boolean;
  onDelete?: (id: string) => void;
  onMarkAsPaid?: (id: string) => void;
  onClientClick?: (clientName: string) => void;
  sortField: TransactionSortField;
  sortDirection: TransactionSortDirection;
  onSortChange: (field: TransactionSortField, direction: TransactionSortDirection) => void;
  possibleDuplicates?: PossibleDuplicateScan;
}

// --- VALIDAÇÕES E MÁSCARAS ---

const cleanDigits = (value: string) => value.replace(/\D/g, '');

const validateCPF = (cpf: string): boolean => {
  const clean = cleanDigits(cpf);
  if (clean.length !== 11) return false;
  // Elimina CPFs com todos os dígitos iguais (ex: 111.111.111-11)
  if (/^(\d)\1+$/.test(clean)) return false; 

  let sum = 0, remainder;
  for (let i = 1; i <= 9; i++) sum = sum + parseInt(clean.substring(i - 1, i)) * (11 - i);
  remainder = (sum * 10) % 11;
  if ((remainder === 10) || (remainder === 11)) remainder = 0;
  if (remainder !== parseInt(clean.substring(9, 10))) return false;
  
  sum = 0;
  for (let i = 1; i <= 10; i++) sum = sum + parseInt(clean.substring(i - 1, i)) * (12 - i);
  remainder = (sum * 10) % 11;
  if ((remainder === 10) || (remainder === 11)) remainder = 0;
  if (remainder !== parseInt(clean.substring(10, 11))) return false;
  
  return true;
};

const validateCNPJ = (cnpj: string): boolean => {
  const clean = cleanDigits(cnpj);
  if (clean.length !== 14) return false;
  if (/^(\d)\1+$/.test(clean)) return false;

  let size = clean.length - 2;
  let numbers = clean.substring(0, size);
  const digits = clean.substring(size);
  let sum = 0;
  let pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
  if (result !== parseInt(digits.charAt(0))) return false;
  
  size = size + 1;
  numbers = clean.substring(0, size);
  sum = 0;
  pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - sum % 11;
  if (result !== parseInt(digits.charAt(1))) return false;
  
  return true;
};

const formatDocument = (value: string): string => {
  const clean = cleanDigits(value);
  if (!clean) return value;
  
  if (clean.length <= 11) {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
};

const BOLETO_CLOUD_ACCOUNT_LABEL = 'NOVA CONTA ITAÚ — Banco 341, agência 3145, conta 99791-6';

// -----------------------------

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
    canDelete = false,
    canExportBoletoCloud = false,
    onDelete,
    onClientClick,
    sortField,
    sortDirection,
    onSortChange,
    possibleDuplicates,
}) => {

  // Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStep, setExportStep] = useState<1 | 2>(1); // Passo 1: Seleção, Passo 2: Documentos
  const [selectedExportClients, setSelectedExportClients] = useState<string[]>([]);
  const [exportSearchTerm, setExportSearchTerm] = useState('');
  
  // Token sensível usado apenas na exportação atual. Não persistir no navegador.
  const [exportToken, setExportToken] = useState('');

  // Mapa de Documentos Persistente (Cliente -> CPF/CNPJ)
  const [clientDocs, setClientDocs] = useState<Record<string, string>>(() => {
      try {
          if (typeof window !== 'undefined') {
              const saved = localStorage.getItem('boleto_client_docs');
              return saved ? JSON.parse(saved) : {};
          }
      } catch (e) {
          logger.error('Error accessing localStorage:', e);
      }
      return {};
  });

  // Estado para validação visual detalhada (Cliente -> Status + Mensagem)
  const [validationStatus, setValidationStatus] = useState<Record<string, { status: 'valid' | 'invalid' | 'loading' | 'unchecked', message?: string }>>({});
  
  // Ref para controlar inicialização e evitar loop de re-seleção
  const hasInitializedExport = useRef(false);

  useEffect(() => {
      try {
          localStorage.removeItem('boleto_cloud_token');
      } catch (e) {
          logger.error('Error clearing legacy boleto token:', e);
      }
  }, []);

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

  const handleTokenChange = (val: string) => {
      setExportToken(val);
  };

  const closeExportModal = () => {
      setExportToken('');
      setShowExportModal(false);
  };

  // Atualiza o documento de um cliente específico e salva no localStorage
  const handleClientDocChange = (clientName: string, docValue: string) => {
      const newDocs = { ...clientDocs, [clientName]: docValue };
      setClientDocs(newDocs);
      try {
          localStorage.setItem('boleto_client_docs', JSON.stringify(newDocs));
      } catch (e) {
          logger.error('Error saving to localStorage:', e);
      }
      
      // Resetar status de validação ao editar para forçar nova verificação
      setValidationStatus(prev => ({ 
          ...prev, 
          [clientName]: { status: 'unchecked' } 
      }));
  };

  // Validação Ativa (Matemática + API BrasilAPI para CNPJ)
  const handleValidateDoc = async (clientName: string) => {
      const doc = clientDocs[clientName] || '';
      const clean = cleanDigits(doc);

      // Se estiver vazio
      if (!clean) {
          setValidationStatus(prev => ({ 
              ...prev, 
              [clientName]: { status: 'invalid', message: 'Documento vazio' } 
          }));
          return;
      }

      setValidationStatus(prev => ({ 
          ...prev, 
          [clientName]: { status: 'loading', message: 'Verificando...' } 
      }));

      // 1. Validação Matemática Básica
      let isValidMath = false;
      let isCnpj = false;
      let errorMsg = 'Formato inválido';

      if (clean.length === 11) {
          isValidMath = validateCPF(clean);
          if (!isValidMath) errorMsg = 'CPF inválido (Dígito verificador)';
      } else if (clean.length === 14) {
          isValidMath = validateCNPJ(clean);
          isCnpj = true;
          if (!isValidMath) errorMsg = 'CNPJ inválido (Dígito verificador)';
      } else {
          isValidMath = false;
          errorMsg = 'Deve ter 11 (CPF) ou 14 (CNPJ) números';
      }

      if (!isValidMath) {
          setValidationStatus(prev => ({ 
              ...prev, 
              [clientName]: { status: 'invalid', message: errorMsg } 
          }));
          // Formatar mesmo se inválido para melhor leitura
          handleClientDocChange(clientName, formatDocument(clean));
          return;
      }

      // 2. Se for CNPJ, consultar API Pública (BrasilAPI)
      if (isCnpj) {
          try {
              // Timeout de 3s para não travar a UI
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 3000);

              const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, { 
                  signal: controller.signal 
              });
              clearTimeout(timeoutId);

              if (response.ok) {
                  // CNPJ Existe na Receita
                  setValidationStatus(prev => ({ 
                      ...prev, 
                      [clientName]: { status: 'valid', message: 'CNPJ Ativo na Receita' } 
                  }));
              } else if (response.status === 404) {
                  // CNPJ Inválido ou Inexistente na base pública
                  setValidationStatus(prev => ({ 
                      ...prev, 
                      [clientName]: { status: 'invalid', message: 'CNPJ não encontrado na Receita' } 
                  }));
              } else {
                  // Erro de servidor/rate limit, mas matemático ok
                  setValidationStatus(prev => ({ 
                      ...prev, 
                      [clientName]: { status: 'valid', message: 'Matematicamente Válido (API Indisponível)' } 
                  }));
              }
          } catch (e) {
              // Fallback: se a API falhar (rede/timeout), mas o checksum for válido, aceitamos
              setValidationStatus(prev => ({ 
                  ...prev, 
                  [clientName]: { status: 'valid', message: 'Válido (Sem verificação online)' } 
              }));
          }
      } else {
          // CPF Válido Matematicamente (Não há API pública para verificar nome x CPF)
          setValidationStatus(prev => ({ 
              ...prev, 
              [clientName]: { status: 'valid', message: 'CPF Válido' } 
          }));
      }

      // 3. Aplicar máscara final
      handleClientDocChange(clientName, formatDocument(clean));
  };

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
  
  const isContasAReceber = normalizedType.includes('entrada') || 
                           normalizedType.includes('receber') ||
                           normalizedType.includes('servico') ||
                           normalizedType.includes('consultoria');

  const isMixedMode = !isContasAPagar && !isContasAReceber;

  // --- LÓGICA DE EXPORTAÇÃO COM SELEÇÃO DE CLIENTES ---

  // 1. Identificar todos os dados pendentes disponíveis (não apenas da página atual)
  const pendingReceivablesData = useMemo(() => {
    const source = (allData && allData.length > 0) ? allData : data;
    return source.filter(row => 
      (row.status === 'Pendente' || row.status === 'Agendado') &&
      !isSaidaTransaction(row)
    );
  }, [allData, data]);

  // 2. Extrair clientes únicos dos pendentes
  const availableExportClients = useMemo(() => {
    const clients = new Set(pendingReceivablesData.map(t => t.client).filter(Boolean));
    return Array.from(clients).sort();
  }, [pendingReceivablesData]);

  // Função auxiliar para tentar extrair CPF/CNPJ do nome do cliente
  const extractCpfCnpj = (text: string) => {
    // Procura por padrões de CPF (XXX.XXX.XXX-XX) ou CNPJ (XX.XXX.XXX/XXXX-XX)
    const match = text.match(/(\d{2,3}\.?\d{3}\.?\d{3}[\/\-]?\d{4}[\-]?\d{2})|(\d{3}\.?\d{3}\.?\d{3}[\-]?\d{2})/);
    return match ? match[0] : '';
  };

  // 3. Inicializar seleção quando o modal abre ou dados mudam
  useEffect(() => {
    if (!showExportModal) {
        // Resetar quando fecha, mas apenas se necessário para evitar loops
        if (hasInitializedExport.current || selectedExportClients.length > 0 || exportSearchTerm !== '' || exportStep !== 1 || Object.keys(validationStatus).length > 0) {
            hasInitializedExport.current = false;
            setSelectedExportClients([]);
            setExportSearchTerm('');
            setExportStep(1);
            setValidationStatus({});
        }
        return;
    }

    // Modal está aberto
    if (!hasInitializedExport.current && availableExportClients.length > 0) {
        setSelectedExportClients(availableExportClients); // Selecionar todos por padrão
        hasInitializedExport.current = true;
    }
  }, [showExportModal, availableExportClients]);

  // Ao avançar para o passo 2, pré-preencher documentos
  useEffect(() => {
      if (showExportModal && exportStep === 2) {
          const newDocs = { ...clientDocs };
          let changed = false;
          
          selectedExportClients.forEach(client => {
              const clientTrx = pendingReceivablesData.find(t => t.client === client);
              const sheetDoc = clientTrx?.cpfCnpj;

              if (sheetDoc && cleanDigits(sheetDoc).length >= 11) {
                   if (newDocs[client] !== sheetDoc) {
                       newDocs[client] = sheetDoc;
                       changed = true;
                   }
              } else if (!newDocs[client]) {
                  const extracted = extractCpfCnpj(client);
                  if (extracted) {
                      newDocs[client] = extracted;
                      changed = true;
                  }
              }
          });

          if (changed) {
              setClientDocs(newDocs);
          }
      }
  }, [exportStep, showExportModal, selectedExportClients, pendingReceivablesData]); // clientDocs removido das dependências (já não estava, mas reforçando estabilidade)

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

  // Avançar para o passo 2
  const handleNextStep = () => {
      if (selectedExportClients.length === 0) {
          alert('Selecione pelo menos um cliente para continuar.');
          return;
      }
      setExportStep(2);
  };

    // 4. Função Final de Exportação (Gera CSV)
    const handleGenerateCSV = () => {
      if (!canExportBoletoCloud) {
          alert('Seu usuário não possui permissão para preparar boletos no Boleto Cloud.');
          return;
      }

      // Validação final bloqueante: nenhum boleto pode sair com documento inválido.
      const invalidClients = selectedExportClients.filter(client => {
          const clientTrx = pendingReceivablesData.find(row => row.client === client);
          const doc = cleanDigits(clientDocs[client] || clientTrx?.cpfCnpj || '');
          return !(doc.length === 11 ? validateCPF(doc) : doc.length === 14 ? validateCNPJ(doc) : false);
      });

      if (invalidClients.length > 0) {
          alert(`Geração bloqueada: ${invalidClients.length} cliente(s) estão com CPF/CNPJ inválido ou vazio.\n\n` +
                `Revise: ${invalidClients.slice(0, 3).join(', ')}${invalidClients.length > 3 ? '...' : ''}`);
          return;
      }

      if (!exportToken.trim()) {
          alert('Geração bloqueada: informe o Token da Conta Bancária do Boleto Cloud.');
          return;
      }

      // Exportar apenas contas a receber ainda pendentes/agendadas.
      const dataToExport = pendingReceivablesData.filter(row =>
        selectedExportClients.includes(row.client)
      );

      if (dataToExport.length === 0) {
          alert('Nenhuma cobrança pendente válida foi encontrada para os clientes selecionados.');
          return;
      }

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
      // Manual Boleto Cloud: duas casas decimais. Sem separador de milhar para evitar ambiguidade.
      return new Intl.NumberFormat('pt-BR', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2,
        useGrouping: false,
      }).format(num);
    };

    const getDescricao = (row: Transaction) => {
      if (row.description) {
          return row.description;
      }
      const date = new Date(row.dueDate);
      // Mês abreviado para economizar caracteres (Ex: fev/2026)
      const mes = date.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
      const ano = date.getFullYear();
      return `Hon ${mes}/${ano}`;
    };

    const rows = dataToExport.map(row => {
        const valor = formatValueCSV(getOriginalAmount(row));
        const vencimento = formatDateCSV(row.dueDate);
        
        // Truncar descrição para máximo 20 caracteres (limite do layout Boleto Cloud)
        let rawDoc = getDescricao(row) || '';
        if (rawDoc.length > 20) {
            rawDoc = rawDoc.substring(0, 20);
        }
        const documento = `"${rawDoc.replace(/"/g, '""')}"`;
        
        const infoPagador = `"${(row.client || '').replace(/"/g, '""')}"`;
        
        // USA O DOCUMENTO DEFINIDO NO PASSO 2 (ou extraído/cacheado)
        // Se estiver vazio no input, tenta usar o documento salvo no Firebase
        // O importador CSV exige CPF/CNPJ com máscara, conforme o manual oficial.
        const cpfCnpj = formatDocument(clientDocs[row.client] || row.cpfCnpj || '');

        // Mapeamento para as 19 colunas esperadas
        return [
            exportToken.trim(), // TOKEN_CONTA_BANCARIA (usado apenas no arquivo atual)
            cpfCnpj,     // CPRF_PAGADOR (Específico por cliente)
            valor,       // VALOR
            vencimento,  // VENCIMENTO (DD/MM/YYYY)
            '',          // NOSSO_NUMERO
            documento,   // DOCUMENTO (Truncado para 20 chars)
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
    const hoje = toLocalISODate();
    link.setAttribute('href', url);
    link.setAttribute('download', `boletos_importacao_${hoje}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    closeExportModal();
    alert(`✅ Arquivo preparatório gerado com ${dataToExport.length} boleto(s). Nenhum boleto foi emitido.`);
  };

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

  // Contar pendentes para mostrar no botão
  const pendentesCount = useMemo(() => {
    const dataToCount = (allData && allData.length > 0) ? allData : data;
    return dataToCount.filter(row => row.status === 'Pendente' || row.status === 'Agendado').length;
  }, [data, allData]);

  // Derivar estado do botão "Selecionar Todos" com base na busca atual
  const areAllVisibleSelected = filteredExportClients.length > 0 && filteredExportClients.every(c => selectedExportClients.includes(c));
  const isSelectionEmpty = selectedExportClients.length === 0;

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
        
        {/* Header com botão de exportar - Apenas Contas a Receber */}
        {isContasAReceber && canExportBoletoCloud && (
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
              Preparar CSV Boleto Cloud
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

      {/* MODAL DE EXPORTAÇÃO EM 2 ETAPAS */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 border border-slate-200 dark:border-slate-800">
             
             {/* Header Comum */}
             <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                 <div className="flex items-center gap-3">
                     <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                         <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                     </div>
                     <div>
                         <h2 className="text-lg font-bold text-slate-800 dark:text-white">Preparação Boleto Cloud</h2>
                         <p className="text-xs text-slate-500 dark:text-slate-400">
                             {exportStep === 1 ? 'Etapa 1: Seleção de Clientes' : 'Etapa 2: Dados de Cobrança (CPF/CNPJ)'}
                         </p>
                     </div>
                 </div>
                 <button onClick={closeExportModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                     <X className="h-5 w-5" />
                 </button>
             </div>

             {/* ======================= ETAPA 1: SELEÇÃO ======================= */}
             {exportStep === 1 && (
               <>
                 <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-4">
                     
                     {/* Input Token da Conta (Global) */}
                     <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
                         <strong>Conta de emissão:</strong> {BOLETO_CLOUD_ACCOUNT_LABEL}
                     </div>
                     <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-100 dark:border-amber-800">
                         <div className="p-1.5 bg-white dark:bg-slate-800 rounded border border-amber-200 dark:border-amber-700 text-amber-600 dark:text-amber-400">
                             <Key className="h-4 w-4" />
                         </div>
                         <div className="flex-1">
                             <label className="block text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">Token da Conta Bancária (Boleto Cloud)</label>
                             <input 
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="Insira o token de integração da conta..." 
                                value={exportToken}
                                onChange={(e) => handleTokenChange(e.target.value)}
                                className="w-full text-sm bg-transparent border-0 border-b border-amber-300 dark:border-amber-700 focus:ring-0 focus:border-amber-500 px-0 py-1 text-slate-800 dark:text-white placeholder:text-slate-400"
                             />
                             <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">Usado somente neste arquivo; não é salvo pelo dashboard.</p>
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

                 <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-xl flex items-center justify-between">
                     <div className="text-xs text-slate-500 dark:text-slate-400">
                         <span className="font-semibold text-slate-900 dark:text-white">{selectedExportClients.length}</span> cliente(s) selecionado(s)
                     </div>
                     <div className="flex gap-3">
                         <button 
                            onClick={closeExportModal}
                            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                         >
                             Cancelar
                         </button>
                         <button 
                            onClick={handleNextStep}
                            disabled={selectedExportClients.length === 0}
                            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg shadow-emerald-600/30 text-sm font-medium transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                         >
                             Próximo <ArrowRight className="h-4 w-4" />
                         </button>
                     </div>
                 </div>
               </>
             )}

             {/* ======================= ETAPA 2: DOCUMENTOS ======================= */}
             {exportStep === 2 && (
               <>
                 <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-blue-50 dark:bg-blue-900/10">
                     <div className="flex items-start gap-3">
                         <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                         <div className="text-sm text-blue-800 dark:text-blue-200">
                             <strong>Validação de Documentos:</strong>
                             <ul className="list-disc pl-4 mt-1 text-xs opacity-90 space-y-0.5">
                                <li><strong>Origem:</strong> Jotform/Firebase (Prioritário).</li>
                                <li><strong>CPF:</strong> Validação matemática dos dígitos.</li>
                                <li><strong>CNPJ:</strong> Consulta automática na Receita Federal (BrasilAPI).</li>
                             </ul>
                         </div>
                     </div>
                 </div>

                 <div className="flex-1 overflow-y-auto p-0 bg-white dark:bg-slate-900 min-h-[300px]">
                     <table className="w-full text-left text-sm">
                         <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                             <tr>
                                 <th className="px-6 py-3 font-semibold text-slate-600 dark:text-slate-300">Cliente Selecionado</th>
                                 <th className="px-6 py-3 font-semibold text-slate-600 dark:text-slate-300 w-[240px]">CPF / CNPJ</th>
                             </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                             {selectedExportClients.map(client => {
                                 const currentValue = clientDocs[client] || '';
                                 const validation = validationStatus[client] || { status: 'unchecked' };
                                 const { status, message } = validation;
                                 
                                 // Define cor da borda e ícone baseada no status
                                 let borderColor = 'border-slate-300 dark:border-slate-600';
                                 let ringColor = 'focus:ring-blue-500/20';
                                 
                                 if (status === 'valid') {
                                     borderColor = 'border-emerald-500 dark:border-emerald-500';
                                     ringColor = 'focus:ring-emerald-500/20';
                                 } else if (status === 'invalid') {
                                     borderColor = 'border-red-500 dark:border-red-500';
                                     ringColor = 'focus:ring-red-500/20';
                                 }
                                 
                                 return (
                                     <tr key={client} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                         <td className="px-6 py-3 align-top pt-4">
                                             <span className="font-medium text-slate-800 dark:text-slate-200 block truncate max-w-[280px]" title={client}>{client}</span>
                                         </td>
                                         <td className="px-6 py-3 align-top">
                                             <div className="flex flex-col gap-1">
                                                 <div className="flex gap-2 items-center">
                                                     <div className="relative flex-1">
                                                         <input 
                                                             type="text" 
                                                             value={currentValue}
                                                             onChange={(e) => handleClientDocChange(client, e.target.value)}
                                                             onBlur={() => handleValidateDoc(client)}
                                                             placeholder="00.000.000/0000-00"
                                                             className={`
                                                                 w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 outline-none font-mono transition-colors
                                                                 bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${borderColor} ${ringColor}
                                                             `}
                                                         />
                                                         {status === 'loading' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
                                                         {status === 'valid' && <CheckCircle2 className="h-4 w-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />}
                                                         {status === 'invalid' && <Ban className="h-4 w-4 text-red-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />}
                                                     </div>
                                                     <button 
                                                        onClick={() => handleValidateDoc(client)}
                                                        className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors"
                                                        title="Validar na Receita Federal (CNPJ) ou Checksum (CPF)"
                                                     >
                                                         <Search className="h-4 w-4" />
                                                     </button>
                                                 </div>
                                                 
                                                 {/* MENSAGEM DE ERRO/SUCESSO EXPLÍCITA */}
                                                 {message && (
                                                     <div className={`text-[10px] flex items-center gap-1 font-medium ${
                                                         status === 'invalid' ? 'text-red-600 dark:text-red-400' : 
                                                         status === 'valid' ? 'text-emerald-600 dark:text-emerald-400' : 
                                                         'text-blue-600 dark:text-blue-400'
                                                     }`}>
                                                         {status === 'invalid' && <AlertCircle className="h-3 w-3" />}
                                                         {message}
                                                     </div>
                                                 )}
                                             </div>
                                         </td>
                                     </tr>
                                 );
                             })}
                         </tbody>
                     </table>
                 </div>

                 <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-xl flex items-center justify-between">
                     <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                         <Save className="h-3 w-3" />
                         Dados salvos localmente
                     </div>
                     <div className="flex gap-3">
                         <button 
                            onClick={() => setExportStep(1)}
                            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-2"
                         >
                             <ChevronLeft className="h-4 w-4" /> Voltar
                         </button>
                         <button 
                            onClick={handleGenerateCSV}
                            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg shadow-emerald-600/30 text-sm font-medium transition-all transform active:scale-95 flex items-center gap-2"
                         >
                             <Download className="h-4 w-4" />
                             Gerar Arquivo
                         </button>
                     </div>
                 </div>
               </>
             )}
          </div>
        </div>
      )}
    </>
  );
};

export default DataTable;
