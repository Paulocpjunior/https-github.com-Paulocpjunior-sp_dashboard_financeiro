import { writeBatch, doc, collection } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { BackendService } from '../services/backendService';
import { Transaction } from '../types';

export const MigrationHelper = {
  /**
   * Migra todas as transações da planilha atual para o Firestore.
   * Realiza a escrita em lotes (batches) de 500 registros para otimização.
   */
  migrateTransactions: async (onProgress: (progress: number, message: string) => void) => {
    onProgress(0, 'Iniciando migração de transações...');
    
    try {
      // 1. Busca todos os dados do BackendService atual (Google Sheets)
      const transactions = await BackendService.fetchTransactions();
      onProgress(10, `Encontradas ${transactions.length} transações na planilha.`);
      
      if (transactions.length === 0) {
        onProgress(100, 'Nenhuma transação encontrada para migrar.');
        return;
      }

      const batchSize = 500;
      let processed = 0;
      
      // 2. Itera sobre as transações em pedaços de 500
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = transactions.slice(i, i + batchSize);
        
        chunk.forEach(transaction => {
          // Usamos o ID original da planilha para manter consistência
          // Se não houver ID, o Firestore gera um novo
          const docRef = doc(collection(db, 'transactions'), transaction.id);
          
          // Removemos o campo 'id' do objeto de dados para não duplicar no documento
          const { id, ...data } = transaction;
          
          // Mapeamento de campos adicionais se necessário
          const firestoreData = {
            ...data,
            migratedAt: new Date().toISOString(),
            source: 'google_sheets_migration'
          };
          
          batch.set(docRef, firestoreData);
        });
        
        // 3. Comita o lote para o Firestore
        await batch.commit();
        processed += chunk.length;
        
        const progress = Math.round((processed / transactions.length) * 90) + 10;
        onProgress(progress, `Migrados ${processed} de ${transactions.length} registros...`);
      }
      
      onProgress(100, 'Migração concluída com sucesso!');
    } catch (error: any) {
      console.error('Erro na migração:', error);
      onProgress(0, `ERRO NA MIGRAÇÃO: ${error.message}`);
      throw error;
    }
  }
};
