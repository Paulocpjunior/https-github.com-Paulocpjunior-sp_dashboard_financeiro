import {
  collection,
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  orderBy, 
  limit, 
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  getCountFromServer,
  QueryConstraint,
  setDoc
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { BillingProfile, ClientRegistryEntry, Transaction, FilterState, KPIData } from '../types';
import { logger } from '../utils/logger';

const FIRESTORE_LIGHT_FETCH_TIMEOUT_MS = 15000;
const FIRESTORE_FULL_FETCH_TIMEOUT_MS = 60000;
const FIRESTORE_TIMEOUT_MESSAGE = 'O Firebase demorou mais que o esperado para responder. Verifique a conexão e tente novamente.';

export interface TransactionsFingerprint {
  count: number;
  latestUpdatedAt: string;
}

export type TransactionRangeField = 'date' | 'dueDate' | 'paymentDate';

const withTimeout = async <T,>(
  operation: Promise<T>,
  timeoutMs = FIRESTORE_LIGHT_FETCH_TIMEOUT_MS,
  message = FIRESTORE_TIMEOUT_MESSAGE
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([
    operation.finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }),
    timeout,
  ]);
};

const mapTransactionSnapshot = (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): Transaction[] => {
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as Transaction[];
};

const mapClientRegistrySnapshot = (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): ClientRegistryEntry[] => {
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as ClientRegistryEntry[];
};

const mapBillingProfilesSnapshot = (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): BillingProfile[] => {
  return snapshot.docs.map(document => ({
    id: document.id,
    ...document.data(),
    deliveryChannels: Array.isArray(document.data().deliveryChannels) ? document.data().deliveryChannels : [],
  })) as BillingProfile[];
};

export const FirebaseService = {
  /**
   * Assina atualizações em tempo real para transações com filtros e paginação.
   */
  subscribeToTransactions: (
    filters: Partial<FilterState>,
    page: number,
    pageSize: number,
    callback: (data: { transactions: Transaction[], total: number }) => void
  ) => {
    const constraints: QueryConstraint[] = [];

    if (filters.type) constraints.push(where('type', '==', filters.type));
    if (filters.status) constraints.push(where('status', '==', filters.status));
    if (filters.client) constraints.push(where('client', '==', filters.client));
    
    // Filtros de data (assumindo formato YYYY-MM-DD)
    if (filters.startDate) constraints.push(where('date', '>=', filters.startDate));
    if (filters.endDate) constraints.push(where('date', '<=', filters.endDate));

    // Nota: Firestore requer índices compostos para múltiplos filtros com orderBy.
    // Para simplificar a implementação inicial, usamos um limite baseado na página.
    const q = query(
      collection(db, 'transactions'),
      ...constraints,
      orderBy('date', 'desc'),
      limit(pageSize * page)
    );

    return onSnapshot(q, (snapshot) => {
      const allDocs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      
      // Paginação manual no cliente para o snapshot atual
      const startIdx = (page - 1) * pageSize;
      const paginatedTransactions = allDocs.slice(startIdx, startIdx + pageSize);
      
      callback({
        transactions: paginatedTransactions,
        total: snapshot.size // Aproximação do total filtrado
      });
    }, (error) => {
      logger.error("Erro no listener de transações:", error);
    });
  },

  /**
   * Assina atualizações em tempo real para os KPIs globais.
   */
  subscribeToKPIs: (callback: (kpi: KPIData) => void) => {
    return onSnapshot(collection(db, 'transactions'), (snapshot) => {
      let totalPaid = 0;
      let totalReceived = 0;
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as Transaction;
        // Lógica de KPI simplificada baseada no status e movimento
        if (data.status === 'Pago') {
          totalPaid += data.valuePaid || 0;
          totalReceived += data.valueReceived || 0;
        }
      });

      callback({
        totalPaid,
        totalReceived,
        balance: totalReceived - totalPaid
      });
    });
  },

  /**
   * Obtém a lista única de empresas/clientes.
   */
  getCompanies: async (): Promise<string[]> => {
    const snapshot = await getDocs(collection(db, 'transactions'));
    const companies = new Set<string>();
    snapshot.docs.forEach(doc => {
      const data = doc.data() as Transaction;
      if (data.client) companies.add(data.client);
    });
    return Array.from(companies).sort();
  },

  /**
   * Obtém todas as transações (usado para compatibilidade com o DataService atual)
   */
  fetchTransactions: async (timeoutMs = FIRESTORE_FULL_FETCH_TIMEOUT_MS): Promise<Transaction[]> => {
    const q = query(collection(db, 'transactions'), orderBy('date', 'desc'));

    try {
      const snapshot = await withTimeout(getDocsFromServer(q), timeoutMs);
      return mapTransactionSnapshot(snapshot);
    } catch (serverError) {
      logger.warn('[FirebaseService] Busca no servidor falhou. Tentando cache local do Firestore...', serverError);

      try {
        const cachedSnapshot = await getDocsFromCache(q);
        if (!cachedSnapshot.empty) {
          logger.warn(`[FirebaseService] Usando ${cachedSnapshot.size} transações do cache local.`);
          return mapTransactionSnapshot(cachedSnapshot);
        }
      } catch (cacheError) {
        logger.warn('[FirebaseService] Cache local indisponível para transações.', cacheError);
      }

      throw serverError;
    }
  },

  fetchTransactionsByRange: async (
    field: TransactionRangeField,
    startDate: string,
    endDate: string,
    timeoutMs = FIRESTORE_FULL_FETCH_TIMEOUT_MS
  ): Promise<Transaction[]> => {
    const constraints: QueryConstraint[] = [];
    if (startDate) constraints.push(where(field, '>=', startDate));
    if (endDate) constraints.push(where(field, '<=', endDate));

    const q = query(
      collection(db, 'transactions'),
      ...constraints,
      orderBy(field, 'desc')
    );

    try {
      const snapshot = await withTimeout(getDocsFromServer(q), timeoutMs);
      return mapTransactionSnapshot(snapshot);
    } catch (serverError) {
      logger.warn(`[FirebaseService] Busca por periodo (${field}) falhou. Tentando cache local...`, serverError);

      try {
        const cachedSnapshot = await getDocsFromCache(q);
        if (!cachedSnapshot.empty) {
          logger.warn(`[FirebaseService] Usando ${cachedSnapshot.size} transações do cache local por periodo.`);
          return mapTransactionSnapshot(cachedSnapshot);
        }
      } catch (cacheError) {
        logger.warn('[FirebaseService] Cache local indisponível para transações por periodo.', cacheError);
      }

      throw serverError;
    }
  },

  /**
   * Consulta leve para detectar se a coleção mudou antes de baixar todos os documentos.
   */
  fetchTransactionsFingerprint: async (timeoutMs = FIRESTORE_LIGHT_FETCH_TIMEOUT_MS): Promise<TransactionsFingerprint> => {
    const transactionsRef = collection(db, 'transactions');
    const latestUpdateQuery = query(transactionsRef, orderBy('updatedAt', 'desc'), limit(1));

    const [countSnapshot, latestUpdateSnapshot] = await Promise.all([
      withTimeout(getCountFromServer(transactionsRef), timeoutMs),
      withTimeout(getDocsFromServer(latestUpdateQuery), timeoutMs),
    ]);

    const latestUpdatedAt = latestUpdateSnapshot.docs[0]?.data().updatedAt;

    return {
      count: countSnapshot.data().count,
      latestUpdatedAt: typeof latestUpdatedAt === 'string' ? latestUpdatedAt : '',
    };
  },

  /**
   * Obtém o cadastro oficial de N.Cliente gerado pela manutenção.
   */
  fetchClientRegistry: async (timeoutMs = FIRESTORE_LIGHT_FETCH_TIMEOUT_MS): Promise<ClientRegistryEntry[]> => {
    const q = query(
      collection(db, 'clientRegistry'),
      where('status', '==', 'ready')
    );

    const snapshot = await withTimeout(getDocsFromServer(q), timeoutMs);
    return mapClientRegistrySnapshot(snapshot);
  },

  /**
   * Cadastro operacional usado exclusivamente como base do faturamento.
   * Valores financeiros continuam vindo das transações do mês de referência.
   */
  fetchBillingProfiles: async (timeoutMs = FIRESTORE_LIGHT_FETCH_TIMEOUT_MS): Promise<BillingProfile[]> => {
    const snapshot = await withTimeout(
      getDocsFromServer(collection(db, 'billingProfiles')),
      timeoutMs,
    );
    return mapBillingProfilesSnapshot(snapshot);
  },

  upsertBillingProfile: async (profile: BillingProfile) => {
    const now = new Date().toISOString();
    const profileRef = doc(db, 'billingProfiles', profile.id);
    return setDoc(profileRef, {
      ...profile,
      createdAt: profile.createdAt || now,
      updatedAt: now,
    }, { merge: true });
  },

  /**
   * Cria uma nova transação.
   */
  createTransaction: async (transaction: Omit<Transaction, 'id'>) => {
    const now = new Date().toISOString();
    return addDoc(collection(db, 'transactions'), {
      ...transaction,
      createdAt: transaction.createdAt || now,
      updatedAt: transaction.updatedAt || now,
    });
  },

  /**
   * Atualiza uma transação existente.
   */
  updateTransaction: async (id: string, updates: Partial<Transaction>) => {
    const transactionRef = doc(db, 'transactions', id);
    return updateDoc(transactionRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }
};
