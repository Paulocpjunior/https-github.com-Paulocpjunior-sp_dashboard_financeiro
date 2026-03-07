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
  QueryConstraint
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { Transaction, FilterState, KPIData } from '../types';

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
      console.error("Erro no listener de transações:", error);
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
  fetchTransactions: async (): Promise<Transaction[]> => {
    const q = query(collection(db, 'transactions'), orderBy('date', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Transaction[];
  },

  /**
   * Cria uma nova transação.
   */
  createTransaction: async (transaction: Omit<Transaction, 'id'>) => {
    return addDoc(collection(db, 'transactions'), transaction);
  },

  /**
   * Atualiza uma transação existente.
   */
  updateTransaction: async (id: string, updates: Partial<Transaction>) => {
    const transactionRef = doc(db, 'transactions', id);
    return updateDoc(transactionRef, updates);
  }
};
