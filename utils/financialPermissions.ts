import { FinancialPermission, User } from '../types';

export const FINANCIAL_PERMISSION_OPTIONS: Array<{
  value: FinancialPermission;
  label: string;
  description: string;
}> = [
  {
    value: 'wix.treasury.open',
    label: 'Tesouraria Wix',
    description: 'Abrir o fluxo seguro de transferência Wix.',
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
  return hasFinancialPermission(user, 'wix.treasury.open');
};
