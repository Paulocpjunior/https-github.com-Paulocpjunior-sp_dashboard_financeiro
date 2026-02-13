
export type UserRole = 'admin' | 'operacional';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  email?: string;
  lastAccess?: string;
  passwordHash?: string; // Armazena o hash SHA-256 da senha, nunca o texto plano
}

export interface Transaction {
  id: string;
  date: string; // Data de Emissão/Lançamento (YYYY-MM-DD)
  dueDate: string; // Data de Vencimento (YYYY-MM-DD)
  paymentDate?: string; // Data de Baixa/Pagamento/Recebimento efetivo (YYYY-MM-DD)
  bankAccount: string;
  type: string;
  description: string; // Coluna F da Planilha (Movimentação Original)
  status: 'Pago' | 'Pendente' | 'Agendado';
  client: string; // Name/Creditor
  paidBy: string;
  movement: 'Entrada' | 'Saída'; // Calculado para lógica de sistema
  valuePaid: number;
  valueReceived: number;
  // Campos específicos para 'Entrada de Caixa / Contas a Receber'
  honorarios?: number;
  valorExtra?: number;
  totalCobranca?: number;
  paymentMethod?: string;
}

export interface FilterState {
  id: string;
  startDate: string;
  endDate: string;
  dueDateStart?: string; // Filtro Data Vencimento Início
  dueDateEnd?: string;   // Filtro Data Vencimento Fim
  paymentDateStart?: string; // Filtro Data Pagamento Início
  paymentDateEnd?: string;   // Filtro Data Pagamento Fim
  receiptDateStart?: string; // Filtro Data Recebimento Início
  receiptDateEnd?: string;   // Filtro Data Recebimento Fim
  bankAccount: string;
  type: string;
  status: string;
  client: string;
  paidBy: string;
  movement: string;
  search: string;
}

export interface KPIData {
  totalPaid: number;
  totalReceived: number;
  balance: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Google Apps Script Types
declare global {
  interface Window {
    google?: {
      script: {
        run: {
          withSuccessHandler: (callback: (data: any) => void) => {
            withFailureHandler: (callback: (error: Error) => void) => any;
          };
          [key: string]: any;
        };
      };
    };
  }
}
