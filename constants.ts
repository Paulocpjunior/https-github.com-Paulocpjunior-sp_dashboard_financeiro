import { Transaction, User } from './types';

// HASHES DE SENHAS CONHECIDAS (SHA-256)
// Senha: "admin"
export const PASS_HASH_ADMIN = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';
// Senha: "mudar123"
export const PASS_HASH_MUDAR123 = '1c2a11307611591c9443597405101a052862a931e5f869152b11568285511b8b';
// Senha: "123456" (Recuperação)
export const PASS_HASH_123456 = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

// Usando 'admin' como senha padrão para facilitar
export const DEFAULT_PASS_HASH = PASS_HASH_ADMIN;

export const MOCK_USERS: User[] = [
  { id: '1', username: 'admin', name: 'Administrador', role: 'admin', active: true, passwordHash: DEFAULT_PASS_HASH, email: 'admin@spcontabil.com.br' },
  { id: '2', username: 'operador1', name: 'Operador 1', role: 'operacional', active: true, passwordHash: DEFAULT_PASS_HASH, email: 'op1@spcontabil.com.br' },
  { id: '3', username: 'operador2', name: 'Operador 2', role: 'operacional', active: true, passwordHash: DEFAULT_PASS_HASH, email: 'op2@spcontabil.com.br' },
];

export const BANK_ACCOUNTS = ['Itau', 'Bradesco', 'Santander', 'Caixa', 'Nubank', 'Inter'];
export const TRANSACTION_TYPES = ['Serviço', 'Produto', 'Consultoria', 'Impostos', 'Aluguel', 'Salários', 'Fornecedores'];
export const STATUSES = ['Pago', 'Pendente', 'Agendado'];
export const CLIENTS = ['TechSolutions Ltda', 'Mercado Silva', 'João Souza', 'Condomínio Solar', 'Padaria Central', 'Posto Shell'];
export const PAYERS = ['Financeiro', 'Diretoria', 'RH', 'Automático'];

// Generate robust mock data
const generateTransactions = (count: number): Transaction[] => {
  const transactions: Transaction[] = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const isEntry = Math.random() > 0.4; // 60% entries, 40% exits
    const date = new Date(now);
    date.setDate(date.getDate() - Math.floor(Math.random() * 90)); // Last 90 days

    // Generate mock due date (same day or future)
    const dueDate = new Date(date);
    dueDate.setDate(date.getDate() + Math.floor(Math.random() * 10));

    const value = Math.floor(Math.random() * 5000) + 100;

    transactions.push({
      id: `trx-${i + 1}`,
      date: date.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      bankAccount: BANK_ACCOUNTS[Math.floor(Math.random() * BANK_ACCOUNTS.length)],
      type: TRANSACTION_TYPES[Math.floor(Math.random() * TRANSACTION_TYPES.length)],
      status: STATUSES[Math.floor(Math.random() * STATUSES.length)] as any,
      client: CLIENTS[Math.floor(Math.random() * CLIENTS.length)],
      paidBy: PAYERS[Math.floor(Math.random() * PAYERS.length)],
      movement: isEntry ? 'Entrada' : 'Saída',
      valuePaid: isEntry ? 0 : value,
      valueReceived: isEntry ? value : 0,
    });
  }
  // Sort by date desc
  return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const MOCK_TRANSACTIONS = generateTransactions(150);