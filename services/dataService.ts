import { ClientRegistryEntry, FilterState, KPIData, PaginatedResult, Transaction } from '../types';
import { FirebaseService } from './firebaseService';
import type { TransactionRangeField, TransactionsFingerprint } from './firebaseService';
import { AuthService } from './authService';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { logger } from '../utils/logger';
import { toLocalISODate } from '../utils/dateUtils';
import { getOriginalAmount, getPaidAmount, isEntradaTransaction, isPaidStatus, isSaidaTransaction, isWixInvoice, parseMoneyValue } from '../utils/transactionAmounts';

type LoadedRange = {
  field: TransactionRangeField;
  startDate: string;
  endDate: string;
};

// In-memory cache
let CACHED_TRANSACTIONS: Transaction[] = [];
let CACHED_CLIENT_REGISTRY: ClientRegistryEntry[] = [];
let isDataLoaded = false;
let lastUpdatedAt: Date | null = null;
let lastFullRefreshAt = 0;
let lastRemoteFingerprint: TransactionsFingerprint | null = null;
let isClientRegistryAvailable = false;
let lastLoadedRange: LoadedRange | null = null;

// Controle de Concorrência (Evita requisições simultâneas/loops)
let currentLoadPromise: Promise<void> | null = null;

// Timer para Auto-Refresh
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let autoRefreshListeners: Array<() => void> = [];

// Constante de Refresh (2 minutos para evitar excesso de requisições)
const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const AUTO_REFRESH_FULL_RECHECK_MS = 10 * 60 * 1000;

// Unsubscribe do listener Firebase em tempo real
let firebaseUnsubscribe: (() => void) | null = null;

// Normalização de texto auxiliar
const normalizeText = (text: string) => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

// FIX: Normalizar datas para formato YYYY-MM-DD (ISO)
const normalizeDate = (dateStr: string | undefined | null): string => {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const clean = dateStr.trim().split(' ')[0];
  if (!clean) return '';
  const isoRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const isoMatch = clean.match(isoRegex);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const ptBrRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;
  const ptMatch = clean.match(ptBrRegex);
  if (ptMatch) {
    let year = ptMatch[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${ptMatch[2].padStart(2, '0')}-${ptMatch[1].padStart(2, '0')}`;
  }
  try {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) { return d.toISOString().slice(0, 10); }
  } catch (_) {}
  return '';
};

const normalizeWixInvoiceTransaction = (transaction: Transaction): void => {
  if (!isWixInvoice(transaction)) return;

  const amount = getOriginalAmount(transaction);
  const typeKey = normalizeText(transaction.type || '');
  const isFaturaWix = Boolean(transaction.wixInvoiceNumber)
    || normalizeText(transaction.id || '').startsWith('wix-inv-')
    || normalizeText(transaction.description || '').includes('fatura wix')
    || normalizeText(transaction.client || '').includes('fatura wix');

  transaction.source = transaction.source || 'wix';
  transaction.movement = 'Entrada';
  if (isFaturaWix || typeKey.includes('saida') || typeKey.includes('pagar') || !transaction.type) {
    transaction.type = 'Entrada de Caixa / Contas a Receber';
  }
  if (!transaction.description && transaction.wixInvoiceNumber) {
    transaction.description = `Fatura Wix #${transaction.wixInvoiceNumber}`;
  }
  if (amount > 0 && parseMoneyValue(transaction.valorOriginal) <= 0) {
    transaction.valorOriginal = amount;
  }
  if (isPaidStatus(transaction.status) && amount > 0 && parseMoneyValue(transaction.valueReceived) <= 0) {
    transaction.valueReceived = amount;
  }
  if (parseMoneyValue(transaction.valuePaid) > 0) {
    transaction.valuePaid = 0;
  }
};

// Mapa de correção de nomes de movimentação/descrição
// Chave: nome errado (como está no Firebase)
// Valor: nome correto (como deve aparecer no sistema)
const DESCRIPTION_NORMALIZATION_MAP: Record<string, string> = {
  // Dare (antiga Desafio) — Google Translate traduz "Dare" → "Desafio"
  'desafio': 'Dare',
  'dare': 'Dare',
  'desafio sp': 'Dare',
  'dare sp': 'Dare',
  'ousar': 'Dare',          // outra tradução de "dare"
  'atrever': 'Dare',        // outra tradução de "dare"

  // Net Eunice — Google Translate traduz "Net" → "Rede"/"Tecelã de rede"/"Tela"
  'tecela de rede eunice': 'Net Eunice',     // "Tecelã" sem acentos = "tecela"
  'tecelã de rede eunice': 'Net Eunice',     // variante acentuada
  'tacela de rede eunice': 'Net Eunice',     // variante com "a"
  'tacelã de rede eunice': 'Net Eunice',     // variante acentuada com "a"
  'tecelan de rede eunice': 'Net Eunice',
  'tacelan de rede eunice': 'Net Eunice',
  'tecela eunice': 'Net Eunice',
  'tecelã eunice': 'Net Eunice',
  'tacelã eunice': 'Net Eunice',
  'tacela eunice': 'Net Eunice',
  'tacelan eunice': 'Net Eunice',
  'tecelan eunice': 'Net Eunice',
  'rede eunice': 'Net Eunice',
  'net eunice': 'Net Eunice',
  'tecelã de rede': 'Net Eunice',
  'tecela de rede': 'Net Eunice',
  'tacelã de rede': 'Net Eunice',
  'tacela de rede': 'Net Eunice',
  'tela eunice': 'Net Eunice',
  'tela de rede eunice': 'Net Eunice',

  // Net Itapeti — Google Translate traduz "Net" → "Líquido"/"Rede"
  'liquido itapeti': 'Net Itapeti',
  'líquido itapeti': 'Net Itapeti',
  'liquida itapeti': 'Net Itapeti',
  'net itapeti liquido': 'Net Itapeti',
  'net itapeti': 'Net Itapeti',
  'itapeti liquido': 'Net Itapeti',
  'itapeti líquido': 'Net Itapeti',
  'net itapeti liq': 'Net Itapeti',
  'itapeti liq': 'Net Itapeti',
  'rede itapeti': 'Net Itapeti',
  'tela itapeti': 'Net Itapeti',

  // Imposto a pagar cliente
  'imposto a pagar cliente': 'Imposto a Pagar Cliente',
  'imposto pagar cliente': 'Imposto a Pagar Cliente',
  'imposto cliente': 'Imposto a Pagar Cliente',
  'imp a pagar cliente': 'Imposto a Pagar Cliente',
  'imposto a pagar': 'Imposto a Pagar Cliente',
  'taxa a pagar cliente': 'Imposto a Pagar Cliente',
};

// Keywords de fallback para quando o match exato/prefix não pega
const KEYWORD_FALLBACK_MAP: [string[], string][] = [
  [['eunice', 'rede'], 'Net Eunice'],     // qualquer combo de "eunice" + "rede" ou "tecelã"
  [['eunice', 'tecela'], 'Net Eunice'],
  [['eunice', 'tacela'], 'Net Eunice'],
  [['eunice', 'tela'], 'Net Eunice'],
  [['itapeti', 'liquido'], 'Net Itapeti'],
  [['itapeti', 'rede'], 'Net Itapeti'],
  [['itapeti', 'tela'], 'Net Itapeti'],
];

const normalizeDescription = (desc: string): string => {
  try {
    if (!desc || typeof desc !== 'string') return desc || '';
    const key = desc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    
    // 1. Exact match or prefix match against the map
    for (const [wrong, correct] of Object.entries(DESCRIPTION_NORMALIZATION_MAP)) {
      const wrongNorm = wrong.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (key === wrongNorm) return correct;
      if (key.startsWith(wrongNorm)) return correct;
    }
    
    // 2. Keyword-based fallback: se o texto contém TODAS as keywords do grupo, normaliza
    for (const [keywords, correct] of KEYWORD_FALLBACK_MAP) {
      if (keywords.every(kw => key.includes(kw))) return correct;
    }
    
    return desc;
  } catch (e) {
    return desc || '';
  }
};

const cleanDigits = (value: string): string => value.replace(/\D/g, '');

const normalizeClientKey = (value: string | undefined): string => {
  return normalizeText(value || '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const getClientNumberValue = (transaction: Transaction): string => {
  const raw = transaction.clientNumber;
  if (raw === null || raw === undefined) return '';
  const value = String(raw).trim();
  return value && value !== '-' ? value : '';
};

const CLIENT_NUMBER_CONFLICT = '__CLIENT_NUMBER_CONFLICT__';

const isUsableRegistryName = (value: string | undefined): boolean => {
  const normalized = normalizeClientKey(value);
  if (!normalized) return false;
  if (normalized.includes('@')) return false;
  return ![
    'cliente nao informado',
    'nao informado',
    'favorecido nao informado',
    'outros',
    '1 outros',
  ].includes(normalized);
};

const getRegistryClientNumberValue = (entry: ClientRegistryEntry): string => {
  const raw = entry.clientNumber;
  if (raw === null || raw === undefined) return '';
  const value = String(raw).trim();
  return value && value !== '-' ? value : '';
};

const fillMissingClientNumbers = (
  transactions: Transaction[],
  registry: ClientRegistryEntry[] = [],
  options: { allowTransactionFallback?: boolean } = {}
): void => {
  const byCpfCnpj = new Map<string, string>();
  const byClient = new Map<string, string>();
  const register = (map: Map<string, string>, key: string, value: string) => {
    if (!key || !value) return;
    const current = map.get(key);
    if (current === CLIENT_NUMBER_CONFLICT) return;
    if (current && current !== value) {
      map.set(key, CLIENT_NUMBER_CONFLICT);
      return;
    }
    if (!current) map.set(key, value);
  };

  registry.forEach((entry) => {
    if (entry.status !== 'ready') return;
    const clientNumber = getRegistryClientNumberValue(entry);
    if (!clientNumber) return;
    register(byCpfCnpj, cleanDigits(String(entry.cpfCnpjDigits || '')), clientNumber);
    if (isUsableRegistryName(entry.clientNormalized || entry.client)) {
      register(byClient, normalizeClientKey(entry.clientNormalized || entry.client), clientNumber);
    }
  });

  if (options.allowTransactionFallback) {
    transactions.forEach((transaction) => {
      const clientNumber = getClientNumberValue(transaction);
      if (!clientNumber) return;
      register(byCpfCnpj, cleanDigits(String(transaction.cpfCnpj || '')), clientNumber);
      register(byClient, normalizeClientKey(transaction.client || transaction.description), clientNumber);
    });
  }

  transactions.forEach((transaction) => {
    if (getClientNumberValue(transaction)) return;
    const byDocument = byCpfCnpj.get(cleanDigits(String(transaction.cpfCnpj || '')));
    const byName = byClient.get(normalizeClientKey(transaction.client || transaction.description));
    const resolved = [byDocument, byName].find((value) => value && value !== CLIENT_NUMBER_CONFLICT) || '';
    if (resolved) transaction.clientNumber = resolved;
  });
};

const buildLocalFingerprint = (transactions: Transaction[]): TransactionsFingerprint => {
  const latestUpdatedAt = transactions.reduce((latest, transaction) => {
    const updatedAt = transaction.updatedAt || '';
    return updatedAt > latest ? updatedAt : latest;
  }, '');

  return {
    count: transactions.length,
    latestUpdatedAt,
  };
};

const fingerprintsMatch = (left: TransactionsFingerprint | null, right: TransactionsFingerprint | null): boolean => {
  return Boolean(left && right && left.count === right.count && left.latestUpdatedAt === right.latestUpdatedAt);
};

const getCurrentMonthRange = (): LoadedRange => {
  const now = new Date();
  return {
    field: 'date',
    startDate: toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: toLocalISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const resolveRangeFromFilters = (filters: Partial<FilterState>): LoadedRange => {
  if (filters.dueDateStart || filters.dueDateEnd) {
    return {
      field: 'dueDate',
      startDate: filters.dueDateStart || '1900-01-01',
      endDate: filters.dueDateEnd || '2100-12-31',
    };
  }

  if (filters.paymentDateStart || filters.paymentDateEnd || filters.receiptDateStart || filters.receiptDateEnd) {
    return {
      field: 'paymentDate',
      startDate: filters.paymentDateStart || filters.receiptDateStart || '1900-01-01',
      endDate: filters.paymentDateEnd || filters.receiptDateEnd || '2100-12-31',
    };
  }

  if (filters.startDate || filters.endDate) {
    return {
      field: 'date',
      startDate: filters.startDate || '1900-01-01',
      endDate: filters.endDate || '2100-12-31',
    };
  }

  return getCurrentMonthRange();
};

const loadedRangesMatch = (left: LoadedRange | null, right: LoadedRange | null): boolean => {
  return Boolean(left && right && left.field === right.field && left.startDate === right.startDate && left.endDate === right.endDate);
};

const filtersFromRange = (range: LoadedRange): Partial<FilterState> => {
  if (range.field === 'dueDate') {
    return { dueDateStart: range.startDate, dueDateEnd: range.endDate };
  }

  if (range.field === 'paymentDate') {
    return { paymentDateStart: range.startDate, paymentDateEnd: range.endDate };
  }

  return { startDate: range.startDate, endDate: range.endDate };
};

const normalizeAndCacheTransactions = (
  data: Transaction[],
  clientRegistryResult: { entries: ClientRegistryEntry[]; available: boolean },
  loadedRange: LoadedRange | null
): void => {
  let excludedIds: string[] = [];
  try { excludedIds = JSON.parse(localStorage.getItem('excluded_transactions') || '[]'); } catch(e) { /* Safari private mode */ }

  data.forEach(t => {
    try {
      if (excludedIds.includes(t.id)) {
        t.isExcluded = true;
      }
      if (t.status != null) {
        const sLower = String(t.status).toLowerCase().trim();
        if (['paga', 'sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(sLower)) {
          t.status = 'Pago';
        } else if (sLower === 'pago') {
          t.status = 'Pago';
        } else if (['pendente', 'nao', 'não', 'n', 'aberto', 'em aberto', ''].includes(sLower)) {
          t.status = 'Pendente';
        } else if (['agendado', 'programado'].includes(sLower)) {
          t.status = 'Agendado';
        }
      } else {
        t.status = 'Pendente';
      }
      if (t.status === 'Pendente' && t.paymentDate) {
        t.paymentDate = '';
      }
      t.date = normalizeDate(t.date) || t.date;
      t.dueDate = normalizeDate(t.dueDate) || t.dueDate;
      if (t.paymentDate) {
        t.paymentDate = normalizeDate(t.paymentDate) || t.paymentDate;
      }

      if (t.movement) {
        const mLower = String(t.movement).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        if (mLower === 'entrada' || mLower === 'receita' || mLower === 'credito') {
          t.movement = 'Entrada';
        } else if (mLower === 'saida' || mLower === 'despesa' || mLower === 'debito') {
          t.movement = 'Saída';
        }
      }
      if (t.description && typeof t.description === 'string') {
        t.description = normalizeDescription(t.description);
      }
      if (t.client && typeof t.client === 'string') {
        const clientNorm = normalizeDescription(t.client);
        if (clientNorm !== t.client) {
          t.client = clientNorm;
        }
      }
      if (t.observacaoAPagar && typeof t.observacaoAPagar === 'string') {
        t.observacaoAPagar = normalizeDescription(t.observacaoAPagar);
      }
      normalizeWixInvoiceTransaction(t);
    } catch (normErr) {
      logger.warn('[DataService] Erro ao normalizar transação:', t.id, normErr);
    }
  });

  CACHED_CLIENT_REGISTRY = clientRegistryResult.entries;
  isClientRegistryAvailable = clientRegistryResult.available;
  fillMissingClientNumbers(data, CACHED_CLIENT_REGISTRY, {
    allowTransactionFallback: !isClientRegistryAvailable,
  });

  CACHED_TRANSACTIONS = data;
  isDataLoaded = true;
  lastUpdatedAt = new Date();
  lastFullRefreshAt = Date.now();
  lastRemoteFingerprint = buildLocalFingerprint(data);
  lastLoadedRange = loadedRange;
};

const fetchClientRegistryResult = async (): Promise<{ entries: ClientRegistryEntry[]; available: boolean }> => {
  return FirebaseService.fetchClientRegistry()
    .then((entries) => ({ entries, available: true }))
    .catch((registryError) => {
      logger.warn('[DataService] Cadastro oficial de N.Cliente indisponivel. Usando fallback local.', registryError);
      return { entries: [] as ClientRegistryEntry[], available: false };
    });
};

export const DataService = {
  
  get isDataLoaded() {
    return isDataLoaded;
  },

  /**
   * Carrega os dados.
   * BLINDADO: Se já estiver carregando, retorna a promessa em andamento.
   * Se já estiver carregado e não for refresh forçado, retorna imediatamente.
   */
  loadData: async (forceRefresh = false): Promise<void> => {
    // 1. Loop Breaker: Se já carregou e não é refresh forçado, retorna.
    if (isDataLoaded && !forceRefresh) {
        return;
    }

    // 2. Concurrency Lock: Se já existe uma requisição em andamento, espera por ela.
    if (currentLoadPromise) {
        logger.info("[DataService] Requisição já em andamento. Aguardando...");
        return currentLoadPromise;
    }

    // 3. Inicia nova requisição e guarda a promessa
    currentLoadPromise = (async () => {
        const wasDataLoaded = isDataLoaded;

        try {
            logger.info("[DataService] Iniciando fetch de transações...");
            const [data, clientRegistryResult] = await Promise.all([
              FirebaseService.fetchTransactions(),
              fetchClientRegistryResult(),
            ]);
            
            if (!data || !Array.isArray(data)) {
                throw new Error("Formato de dados inválido recebido do backend.");
            }

            normalizeAndCacheTransactions(data, clientRegistryResult, null);
            logger.info(`[DataService] Sucesso. ${data.length} registros carregados.`);
        } catch (error) {
            logger.error("[DataService] Erro fatal no carregamento:", error);
            isDataLoaded = wasDataLoaded;
            // Repassa o erro para a UI tratar (ex: mostrar mensagem de erro),
            // mas garante que o estado de "carregando" seja limpo no finally.
            throw error;
        } finally {
            // Libera o lock para permitir novas tentativas futuras (ex: clique no botão "Tentar Novamente")
            currentLoadPromise = null;
        }
    })();

    return currentLoadPromise;
  },

  loadDataForFilters: async (filters: Partial<FilterState>, forceRefresh = false): Promise<void> => {
    const range = resolveRangeFromFilters(filters);

    if (isDataLoaded && loadedRangesMatch(lastLoadedRange, range) && !forceRefresh) {
      return;
    }

    if (currentLoadPromise) {
      logger.info("[DataService] Requisição já em andamento. Aguardando...");
      return currentLoadPromise;
    }

    currentLoadPromise = (async () => {
      const wasDataLoaded = isDataLoaded;

      try {
        logger.info(`[DataService] Iniciando fetch por período: ${range.field} ${range.startDate} até ${range.endDate}`);
        const [data, clientRegistryResult] = await Promise.all([
          FirebaseService.fetchTransactionsByRange(range.field, range.startDate, range.endDate),
          fetchClientRegistryResult(),
        ]);

        if (!data || !Array.isArray(data)) {
          throw new Error("Formato de dados inválido recebido do backend.");
        }

        normalizeAndCacheTransactions(data, clientRegistryResult, range);
        logger.info(`[DataService] Sucesso no período. ${data.length} registros carregados.`);
      } catch (error) {
        logger.error("[DataService] Erro fatal no carregamento por período:", error);
        isDataLoaded = wasDataLoaded;
        throw error;
      } finally {
        currentLoadPromise = null;
      }
    })();

    return currentLoadPromise;
  },

  excludeTransaction: async (id: string, reason = 'Excluído pelo administrador'): Promise<void> => {
    const currentUser = AuthService.getCurrentUser();
    const isAdmin = (currentUser?.role || '').toLowerCase().trim() === 'admin';
    if (!isAdmin) {
      throw new Error('Ação permitida apenas para administradores.');
    }

    const now = new Date().toISOString();
    const updates: Partial<Transaction> = {
      isExcluded: true,
      exclusionReason: reason.trim() || 'Excluído pelo administrador',
      excludedAt: now,
      excludedBy: currentUser?.username || currentUser?.id || '',
      excludedByName: currentUser?.name || currentUser?.username || '',
    };

    await FirebaseService.updateTransaction(id, updates);

    try {
      const excludedIds = JSON.parse(localStorage.getItem('excluded_transactions') || '[]');
      if (!excludedIds.includes(id)) {
        excludedIds.push(id);
        localStorage.setItem('excluded_transactions', JSON.stringify(excludedIds));
      }
    } catch (error) {
      logger.warn('[DataService] Não foi possível atualizar exclusões locais.', error);
    }

    const transaction = CACHED_TRANSACTIONS.find(t => t.id === id);
    if (transaction) {
      Object.assign(transaction, updates);
    }
    
    DataService.notifyListeners();
  },

  /**
   * Marca uma transação como paga (Dar Baixa) — atualiza Firebase e o cache local.
   */
  markAsPaid: async (id: string): Promise<void> => {
    const today = toLocalISODate();
    const updates: Partial<Transaction> = {
      status: 'Pago',
      paymentDate: today,
    };

    // Atualiza no Firebase
    await FirebaseService.updateTransaction(id, updates);

    // Atualiza o cache local imediatamente para refletir na UI
    const transaction = CACHED_TRANSACTIONS.find(t => t.id === id);
    if (transaction) {
      transaction.status = 'Pago';
      transaction.paymentDate = today;
    }

    DataService.notifyListeners();
  },

  /**
   * Força uma atualização dos dados.
   */
  refreshCache: async (): Promise<void> => {
    try {
        if (lastLoadedRange) {
          await DataService.loadDataForFilters(filtersFromRange(lastLoadedRange), true);
        } else {
          await DataService.loadData(true);
        }
        DataService.notifyListeners();
    } catch (e) {
        logger.error("[DataService] Falha ao recarregar cache:", e);
    }
  },

  refreshCacheIfChanged: async (): Promise<void> => {
    try {
        if (!isDataLoaded || !lastRemoteFingerprint) {
          await DataService.refreshCache();
          return;
        }

        if (Date.now() - lastFullRefreshAt >= AUTO_REFRESH_FULL_RECHECK_MS) {
          logger.info('[DataService] Auto-refresh fará reconferência completa programada.');
          await DataService.refreshCache();
          return;
        }

        const remoteFingerprint = await FirebaseService.fetchTransactionsFingerprint();
        if (!fingerprintsMatch(lastRemoteFingerprint, remoteFingerprint)) {
          logger.info('[DataService] Mudança detectada no Firestore. Recarregando cache atual...');
          await DataService.refreshCache();
          return;
        }

        lastUpdatedAt = new Date();
        logger.info('[DataService] Auto-refresh sem mudanças no Firestore. Cache mantido.');
        DataService.notifyListeners();
    } catch (e) {
        logger.warn('[DataService] Fingerprint do Firestore falhou. Mantendo cache atual para evitar recarga completa pesada.', e);
        lastUpdatedAt = new Date();
        DataService.notifyListeners();
    }
  },

  getLastUpdatedAt: (): Date | null => lastUpdatedAt,

  // --- Auto Refresh Logic ---

  startAutoRefresh: (intervalMs = AUTO_REFRESH_INTERVAL_MS): void => {
    DataService.stopAutoRefresh();

    autoRefreshTimer = setInterval(async () => {
        logger.info('[DataService] Auto-refresh executando...');
        try {
            await DataService.refreshCacheIfChanged();
        } catch (e) {
            logger.error('[DataService] Erro silencioso no auto-refresh:', e);
        }
    }, intervalMs);
  },

  stopAutoRefresh: (): void => {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
  },

  /**
   * Inicia listener em tempo real do Firebase (onSnapshot).
   * Qualquer alteração no Firestore atualiza o cache automaticamente e notifica a UI.
   */
  subscribeToFirebaseChanges: (): (() => void) => {
    // Evita múltiplos listeners simultâneos
    if (firebaseUnsubscribe) {
      firebaseUnsubscribe();
      firebaseUnsubscribe = null;
    }

    logger.info('[DataService] Iniciando listener em tempo real do Firebase...');

    const q = query(collection(db, 'transactions'), orderBy('date', 'desc'));

    firebaseUnsubscribe = onSnapshot(q, (snapshot) => {
      if (!isDataLoaded) return; // Aguarda carregamento inicial

      logger.info(`[DataService] Firebase onSnapshot: ${snapshot.size} docs, ${snapshot.docChanges().length} alterações`);

      const data: Transaction[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];

      // Aplica normalizações (mesmo pipeline do loadData)
      let excludedIds: string[] = [];
      try { excludedIds = JSON.parse(localStorage.getItem('excluded_transactions') || '[]'); } catch(e) { /* Safari private mode */ }

      data.forEach(t => {
        try {
          if (excludedIds.includes(t.id)) t.isExcluded = true;
          if (t.status != null) {
            const sLower = String(t.status).toLowerCase().trim();
            if (['paga', 'sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(sLower)) t.status = 'Pago';
            else if (sLower === 'pago') t.status = 'Pago';
            else if (['pendente', 'nao', 'não', 'n', 'aberto', 'em aberto', ''].includes(sLower)) t.status = 'Pendente';
            else if (['agendado', 'programado'].includes(sLower)) t.status = 'Agendado';
          } else { t.status = 'Pendente'; }
          if (t.status === 'Pendente' && t.paymentDate) t.paymentDate = '';
          // FIX: Normalizar datas DD/MM/YYYY -> YYYY-MM-DD (ISO)
          t.date = normalizeDate(t.date) || t.date;
          t.dueDate = normalizeDate(t.dueDate) || t.dueDate;
          if (t.paymentDate) { t.paymentDate = normalizeDate(t.paymentDate) || t.paymentDate; }

          if (t.movement) {
            const mLower = String(t.movement).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            if (['entrada', 'receita', 'credito'].includes(mLower)) t.movement = 'Entrada';
            else if (['saida', 'despesa', 'debito'].includes(mLower)) t.movement = 'Saída';
          }
          if (t.description) t.description = normalizeDescription(t.description);
          if (t.client) { const n = normalizeDescription(t.client); if (n !== t.client) t.client = n; }
          if (t.observacaoAPagar) t.observacaoAPagar = normalizeDescription(t.observacaoAPagar);
          normalizeWixInvoiceTransaction(t);
        } catch (e) { /* ignore */ }
      });

      fillMissingClientNumbers(data, CACHED_CLIENT_REGISTRY, {
        allowTransactionFallback: !isClientRegistryAvailable,
      });
      CACHED_TRANSACTIONS = data;
      lastUpdatedAt = new Date();
      DataService.notifyListeners();
    }, (error) => {
      logger.error('[DataService] Erro no listener Firebase:', error);
    });

    return () => {
      if (firebaseUnsubscribe) {
        firebaseUnsubscribe();
        firebaseUnsubscribe = null;
      }
    };
  },

  stopFirebaseListener: (): void => {
    if (firebaseUnsubscribe) {
      firebaseUnsubscribe();
      firebaseUnsubscribe = null;
    }
  },

  onRefresh: (callback: () => void): (() => void) => {
    autoRefreshListeners.push(callback);
    return () => {
      autoRefreshListeners = autoRefreshListeners.filter(fn => fn !== callback);
    };
  },

  notifyListeners: () => {
      autoRefreshListeners.forEach(fn => fn());
  },

  // --- Data Access & Filtering ---

  getUniqueValues: (field: keyof Transaction): string[] => {
    if (!isDataLoaded) return [];
    const normalizeStatusVal = (s: string): string => {
      const v = s.toLowerCase().trim();
      if (["paga","recebido","quitado","sim","ok","liquidado","pago"].includes(v)) return 'Pago';
      if (v === "agendado") return 'Agendado';
      if (["pendente","nao","não","aberto"].includes(v)) return 'Pendente';
      return s.trim();
    };
    const rawValues = CACHED_TRANSACTIONS.map(t => String(t[field] || '').trim()).filter(Boolean);
    const normalized = field === 'status' ? rawValues.map(normalizeStatusVal) : rawValues;
    const values = new Set(normalized);
    return Array.from(values).sort();
  },

  getGlobalStats: (): KPIData => {
    if (!isDataLoaded) return { totalPaid: 0, totalReceived: 0, balance: 0 };
    
    let pendingReceivables = 0;
    let pendingPayables = 0;
    let actualBalance = 0;

    CACHED_TRANSACTIONS.forEach(t => {
        const isPaid = isPaidStatus(t.status);
        const isPending = !isPaid;

        if (isPaid) {
            // Saldo Realizado = Recebido - Pago
            const entryPaid = isEntradaTransaction(t) ? getPaidAmount(t) : 0;
            const payablePaid = isSaidaTransaction(t) ? getPaidAmount(t) : 0;
            actualBalance += (entryPaid - payablePaid);
        }

        if (isPending) {
            // Entradas Pendentes
            if (isEntradaTransaction(t)) {
                pendingReceivables += getOriginalAmount(t);
            }
            // Saídas Pendentes
            if (isSaidaTransaction(t)) {
                pendingPayables += getOriginalAmount(t);
            }
        }
    });

    return {
        totalReceived: pendingReceivables, // A Receber
        totalPaid: pendingPayables,       // A Pagar
        balance: actualBalance            // Saldo em Caixa
    };
  },

  getTransactions: (
    filters: Partial<FilterState>,
    page: number = 1,
    pageSize: number = 20
  ): { result: PaginatedResult<Transaction>; kpi: KPIData } => {
    
    let filtered = CACHED_TRANSACTIONS;

    // Filter out excluded transactions first
    filtered = filtered.filter(item => !item.isExcluded);

    // Apply Filters only if data exists
    if (filtered.length > 0) {
        filtered = filtered.filter((item) => {
          let matches = true;

          if (filters.id && !item.id.toLowerCase().includes(filters.id.toLowerCase())) matches = false;
          
          // Date Filtering
          if (filters.startDate && item.date < filters.startDate) matches = false;
          if (filters.endDate && item.date > filters.endDate) matches = false;

          // Due Date (Vencimento)
          if (filters.dueDateStart && item.dueDate < filters.dueDateStart) matches = false;
          if (filters.dueDateEnd && item.dueDate > filters.dueDateEnd) matches = false;

          // Payment Date
          if (filters.paymentDateStart && (!item.paymentDate || item.paymentDate < filters.paymentDateStart)) matches = false;
          if (filters.paymentDateEnd && (!item.paymentDate || item.paymentDate > filters.paymentDateEnd)) matches = false;

          // Receipt Date
          if (filters.receiptDateStart && (!item.paymentDate || item.paymentDate < filters.receiptDateStart)) matches = false;
          if (filters.receiptDateEnd && (!item.paymentDate || item.paymentDate > filters.receiptDateEnd)) matches = false;
          
          if (filters.bankAccount && item.bankAccount !== filters.bankAccount) matches = false;
          if (filters.type && item.type !== filters.type) matches = false;
          if (filters.status) {
            // Normaliza aliases: Recebido/Quitado/Sim/OK → Pago
            const normalizeItemStatus = (s: string): string => {
              const v = (s || '').toLowerCase().trim();
              if (v === 'paga' || v === 'recebido' || v === 'quitado' || v === 'sim' || v === 'ok' || v === 'liquidado') return 'Pago';
              if (v === 'pago') return 'Pago';
              if (v === 'agendado') return 'Agendado';
              return 'Pendente';
            };
            if (normalizeItemStatus(item.status) !== filters.status) matches = false;
          }
          if (filters.movement && item.movement !== filters.movement) matches = false;
          if (filters.paidBy && item.paidBy !== filters.paidBy) matches = false;
          
          if (filters.client && !item.client.toLowerCase().includes(filters.client.toLowerCase())) matches = false;

          if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const rowString = Object.values(item).join(' ').toLowerCase();
            if (!rowString.includes(searchLower)) matches = false;
          }

          return matches;
        });
    }

    // Determine Logic Context (Payables vs Receivables vs General)
    const normalizedType = normalizeText(filters.type || '');
    const isContasAPagar = normalizedType.includes('saida') || normalizedType.includes('pagar') || filters.movement === 'Saída';
    const isContasAReceber = normalizedType.includes('entrada') || normalizedType.includes('receber') || filters.movement === 'Entrada';

    let kpi: KPIData;

    if (isContasAPagar) {
      // KPI Contexto Saída: Total Pago vs Total Pendente
      const totalGeral = filtered.reduce((acc, curr) => acc + getOriginalAmount(curr), 0);
      const totalPago = filtered.filter(i => isPaidStatus(i.status)).reduce((acc, curr) => acc + getPaidAmount(curr), 0);
      const totalPendente = totalGeral - totalPago;

      kpi = { totalPaid: totalPago, totalReceived: totalGeral, balance: totalPendente }; 
    } else if (isContasAReceber) {
      // KPI Contexto Entrada: Total Recebido vs Total Pendente
      const totalGeralReceber = filtered.reduce((acc, curr) => acc + getOriginalAmount(curr), 0);
      const totalRecebido = filtered.filter(i => isPaidStatus(i.status)).reduce((acc, curr) => acc + getPaidAmount(curr), 0);
      const saldoReceber = totalGeralReceber - totalRecebido;

      kpi = { totalReceived: totalGeralReceber, totalPaid: totalRecebido, balance: saldoReceber };
    } else {
      // KPI Geral (Entradas vs Saídas)
      kpi = filtered.reduce(
        (acc, curr) => ({
            totalPaid: acc.totalPaid + (isSaidaTransaction(curr) ? getOriginalAmount(curr) : 0),
            totalReceived: acc.totalReceived + (isEntradaTransaction(curr) ? getOriginalAmount(curr) : 0),
            balance: acc.balance + (isEntradaTransaction(curr) ? getOriginalAmount(curr) : 0) - (isSaidaTransaction(curr) ? getOriginalAmount(curr) : 0),
        }),
        { totalPaid: 0, totalReceived: 0, balance: 0 }
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    
    return {
      result: {
        data: filtered.slice(start, end),
        allData: filtered,
        total,
        page,
        pageSize,
        totalPages,
      },
      kpi,
    };
  },

  exportToCSV: (filters: Partial<FilterState>): void => {
    const { result } = DataService.getTransactions(filters);
    const rows = result.allData ?? result.data;
    const headers = [
      'ID', 'Data', 'Vencimento', 'Pagamento', 'Conta', 'Tipo', 'Status', 
      'Cliente', 'CPF / CNPJ', 'Movimento', 'Valor Pago', 'Valor Recebido',
      'Honorários', 'Extras', 'Total Cobrança', 'Observação - A Pagar'
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(';')]
        .concat(rows.map(row => [
              row.id, row.date, row.dueDate, row.paymentDate || '', row.bankAccount, row.type, row.status,
              `"${row.client}"`, `"${row.cpfCnpj || ''}"`, row.movement,
              row.valuePaid.toFixed(2).replace('.', ','),
              row.valueReceived.toFixed(2).replace('.', ','),
              (row.honorarios || 0).toFixed(2).replace('.', ','),
              (row.valorExtra || 0).toFixed(2).replace('.', ','),
              (row.totalCobranca || 0).toFixed(2).replace('.', ','),
              `"${(row.observacaoAPagar || '').replace(/"/g, '""')}"`
            ].join(';')
        )).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `export_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};
