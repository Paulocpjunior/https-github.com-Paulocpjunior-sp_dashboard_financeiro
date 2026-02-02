import { Transaction, User } from '../types';
import { MOCK_USERS } from '../constants';

const API_URL = 'https://script.google.com/macros/s/AKfycbxGsGt2Rf3FpbEC30hU3ml_b9VuMAOpurfFeghgJJmfsm47XJQseS7gV4L3a1Qe14vHkw/exec';

export const BackendService = {
  
  isProduction: (): boolean => true,

  fetchTransactions: async (): Promise<Transaction[]> => {
    console.log('Conectando ao Google Sheets...');
    
    const response = await fetch(API_URL + '?action=dados&limite=10000');
    const result = await response.json();
    
    console.log('Dados recebidos:', result.total);
    
    if (!result.success) throw new Error('Erro ao carregar');
    
    return result.dados.map((row: any, i: number) => {
      const valorPago = parseFloat(String(row['Valor Pago'] || 0).toString().replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
      const valorRecebido = parseFloat(String(row['Valor Recebido'] || 0).toString().replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
      
      let dateStr = '';
      if (row['Data Lançamento']) {
        try { dateStr = new Date(row['Data Lançamento']).toISOString().split('T')[0]; } catch(e) {}
      }
      
      return {
        id: 'trx-' + (i + 1),
        date: dateStr,
        bankAccount: row['Contas bancárias'] || '',
        type: row['Tipo de Lançamento'] || '',
        status: String(row['Doc.Pago'] || '').toUpperCase() === 'SIM' ? 'Pago' : 'Pendente',
        client: row['Nome Empresa / Credor'] || '',
        paidBy: row['Pago Por'] || '',
        movement: valorPago > 0 ? 'Saída' : 'Entrada',
        valuePaid: valorPago,
        valueReceived: valorRecebido,
      } as Transaction;
    });
  },

  fetchUsers: async (): Promise<User[]> => {
    return MOCK_USERS.map(({ passwordHash, ...u }) => u as User);
  },

  login: async (username: string, passwordHashInput: string): Promise<{ success: boolean; user?: User; message?: string }> => {
    const user = MOCK_USERS.find(u => u.username === username);
    
    if (!user) {
      return { success: false, message: 'Usuário não encontrado.' };
    }
    
    // Verifica o hash recebido contra o hash armazenado no usuário (definido em constants.ts)
    // Por padrão, a senha para todos os MOCK_USERS é "admin"
    if (passwordHashInput === user.passwordHash && user.active) {
      const { passwordHash, ...safeUser } = user;
      return { success: true, user: safeUser as User };
    }
    
    return { success: false, message: 'Senha incorreta.' };
  },

  requestPasswordReset: async (username: string): Promise<{ success: boolean; message: string }> => {
    return { success: true, message: 'Solicitação enviada.' };
  }
};