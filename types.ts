export type UserRole = 'admin' | 'operacional';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  lastAccess?: string;
  passwordHash?: string; // Armazena o hash SHA-256 da senha, nunca o texto plano
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  bankAccount: string;
  type: string;
  status: 'Pago' | 'Pendente' | 'Agendado';
  client: string; // Name/Creditor
  paidBy: string;
  movement: 'Entrada' | 'Saída';
  valuePaid: number;
  valueReceived: number;
  // Campos específicos para 'Entrada de Caixa / Contas a Receber'
  honorarios?: number;
  valorExtra?: number;
  totalCobranca?: number;
}

export interface FilterState {
  id: string;
  startDate: string;
  endDate: string;
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