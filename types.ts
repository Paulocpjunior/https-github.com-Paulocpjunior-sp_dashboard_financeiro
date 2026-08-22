
export type UserRole = 'admin' | 'operacional';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  email?: string;
  lastAccess?: string;
  authUid?: string;
  authEmail?: string;
  authProvider?: string;
}

export interface Transaction {
  id: string;
  date: string; // Data de Emissão/Lançamento (YYYY-MM-DD)
  dueDate: string; // Data de Vencimento (YYYY-MM-DD)
  paymentDate?: string; // Data de Baixa/Pagamento/Recebimento efetivo (YYYY-MM-DD)
  bankAccount: string;
  type: string;
  description: string; // Movimentação original
  status: 'Pago' | 'Pendente' | 'Agendado' | 'Paga' | 'Recebido' | 'Vencida';
  client: string; // Name/Creditor
  paidBy: string;
  movement: 'Entrada' | 'Saída'; // Calculado para lógica de sistema
  valuePaid: number;
  valueReceived: number;
  valorOriginal?: number | string;
  // Campos específicos para 'Entrada de Caixa / Contas a Receber'
  honorarios?: number;
  cobrancaExtra?: string;
  valorExtra?: number;
  totalCobranca?: number;
  metodoPagamento?: string; // Campo original gravado pelo Jotform
  paymentMethod?: string;
  method?: string;
  source?: string;
  wixInvoiceNumber?: string;
  wixEntityId?: string;
  cpfCnpj?: string; // Campo vindo do Jotform/Firebase
  clientNumber?: number | string;
  observacaoAPagar?: string; // Observação do contas a pagar
  observacaoReceber?: string;
  observacao?: string;
  numeroDocumento?: string;
  parcela?: string | number;
  submissionId?: string;
  isExcluded?: boolean; // Marcação de exclusão lógica
  exclusionReason?: string;
  excludedAt?: string;
  excludedBy?: string;
  excludedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientRegistryEntry {
  id: string;
  key: string;
  keyType: 'cpf' | 'cnpj' | 'name' | string;
  cpfCnpjDigits?: string;
  client?: string;
  clientNormalized?: string;
  clientNumber?: string;
  clientNumberNormalized?: string;
  status?: 'ready' | 'conflict' | 'missing_client_number' | string;
  confidence?: 'high' | 'medium' | string;
}

export type BillingDeliveryChannel = 'email' | 'whatsapp' | 'printed';

export interface BillingProfile {
  id: string;
  identityKey: string;
  client: string;
  cpfCnpj?: string;
  clientNumber?: string;
  groupName?: string;
  billingMethod?: string;
  issueDay?: number;
  dueDay?: number;
  deliveryChannels: BillingDeliveryChannel[];
  billingEmail?: string;
  whatsapp?: string;
  printedDeliveryDetails?: string;
  billingInstructions?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface BillingForecastRow {
  identityKey: string;
  client: string;
  cpfCnpj: string;
  clientNumber: string;
  groupName: string;
  billingMethod: string;
  issueDate: string;
  dueDate: string;
  deliveryChannels: BillingDeliveryChannel[];
  billingEmail: string;
  whatsapp: string;
  printedDeliveryDetails: string;
  billingInstructions: string;
  honorarios: number;
  extras: number;
  referenceAmount: number;
  referenceCount: number;
  referenceMonth: string;
  targetMonth: string;
  referenceField: 'date' | 'dueDate';
  profile?: BillingProfile;
  hasReference: boolean;
  missingFields: string[];
  conflicts: string[];
  adjustedDates: string[];
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
  allData?: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
