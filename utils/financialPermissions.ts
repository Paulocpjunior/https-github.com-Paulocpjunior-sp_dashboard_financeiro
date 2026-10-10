import { FinancialPermission, User } from '../types';

export const FINANCIAL_PERMISSION_OPTIONS: Array<{
  value: FinancialPermission;
  label: string;
  description: string;
}> = [
  {value:'payables.read', label:'Consultar gestão de contas a pagar', description:'Consultar a conta, histórico de baixas e relatório de pagamentos. Sem autorização para alterações.'},
  {value:'payables.settle', label:'Registrar baixa de contas a pagar', description:'Registrar pagamentos integrais ou parciais com auditoria. Não executa transferência bancária.'},
  {value:'payables.reverse', label:'Estornar baixa de contas a pagar', description:'Estornar a última baixa ativa com motivo e auditoria. Não executa devolução bancária.'},
  {value:'payables.recurrence', label:'Gerenciar recorrências a pagar', description:'Configurar recorrências e confirmar provisões mensais.'},
  {value:'payables.invite', label:'Preparar INVITE de contas a pagar', description:'Configurar destinatários e baixar convite ou rascunho. Não envia e-mail automaticamente.'},
  {
    value: 'billing.boleto-cloud.history.read',
    label: 'Consultar histórico Boleto Cloud',
    description: 'Consultar os boletos dos beneficiários, atualizar a situação e baixar PDFs. Não autoriza emitir.',
  },
  {
    value: 'wix.treasury.open',
    label: 'Tesouraria Wix',
    description: 'Legado: usuários ativos já possuem acesso à Tesouraria Wix no Dashboard.',
  },
  {
    value: 'billing.boleto-cloud.issue',
    label: 'Emitir Boleto Cloud',
    description: 'Autorizar emissão após revisão no Sandbox/produção.',
  },
  {
    value: 'itau.openfinance.read',
    label: 'Consultar Itaú',
    description: 'Consultar extrato Itaú da agência 3145 / conta 99791-6.',
  },
  {
    value: 'itau.statement.import',
    label: 'Importar OFX Itaú',
    description: 'Importar extrato da conta 3145 / 99791-6. Exige também Consultar Itaú.',
  },
];

const FINANCIAL_PERMISSIONS = new Set<FinancialPermission>(
  FINANCIAL_PERMISSION_OPTIONS.map(option => option.value),
);

export const isFinancialPermission = (value: unknown): value is FinancialPermission => (
  typeof value === 'string' && FINANCIAL_PERMISSIONS.has(value as FinancialPermission)
);

export const sanitizeFinancialPermissions = (value: unknown): FinancialPermission[] => (
  Array.isArray(value) ? Array.from(new Set(value.filter(isFinancialPermission))) : []
);

export const hasFinancialPermission = (user: User | null, permission: FinancialPermission): boolean => {
  if (!user || user.active === false) return false;
  if ((user.role || '').toLowerCase().trim() === 'admin') return true;
  return user.financialPermissions?.includes(permission) === true;
};

export const canOpenWixTreasury = (user: User | null): boolean => {
  // A conta Wix é compartilhada pela equipe financeira; o Dashboard só abre a
  // página oficial e não executa nenhuma operação financeira.
  return Boolean(user && user.active !== false);
};
