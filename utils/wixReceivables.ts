import { Transaction } from '../types';
import { getOriginalAmount, getOutstandingAmount, getPaidAmount, isWixEcommerceOrder, isWixFatura } from './transactionAmounts';

// '' = relatório completo; 'group' = só o Grupo WIX; demais = uma parte do grupo.
export type WixFilter = '' | 'group' | 'invoices' | 'ecommerce';

export const WIX_FILTER_LABELS: Record<Exclude<WixFilter, ''>, string> = {
  group: 'Somente Grupo WIX (E-commerce + Faturas Wix)',
  invoices: 'Somente Faturas Wix',
  ecommerce: 'Somente E-commerce Wix',
};

export const isWixGroupTransaction = (transaction: Transaction): boolean =>
  isWixFatura(transaction) || isWixEcommerceOrder(transaction);

// Pedidos da loja já nascem pagos e com tipo próprio, então não passam pelos
// filtros de tipo/status do Contas a Receber; entram no relatório pelo Grupo WIX.
export const applyWixFilter = (receivables: Transaction[], ecommerceOrders: Transaction[], filter: WixFilter): Transaction[] => {
  const seen = new Set<string>();
  const unique = (rows: Transaction[]) => rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const orders = ecommerceOrders.filter(isWixEcommerceOrder);
  if (filter === 'invoices') return unique(receivables.filter(isWixFatura));
  if (filter === 'ecommerce') return unique(orders);
  if (filter === 'group') return unique([...receivables.filter(isWixFatura), ...orders]);
  return unique([...receivables, ...orders]);
};

export interface WixGroupPart {
  count: number;
  total: number;
  received: number;
  open: number;
}

const summarize = (rows: Transaction[]): WixGroupPart => rows.reduce((part, row) => ({
  count: part.count + 1,
  total: part.total + getOriginalAmount(row),
  received: part.received + getPaidAmount(row),
  open: part.open + getOutstandingAmount(row),
}), { count: 0, total: 0, received: 0, open: 0 });

export const summarizeWixGroup = (rows: Transaction[]) => {
  const invoices = summarize(rows.filter(isWixFatura));
  const ecommerce = summarize(rows.filter(isWixEcommerceOrder));
  return {
    invoices,
    ecommerce,
    total: {
      count: invoices.count + ecommerce.count,
      total: invoices.total + ecommerce.total,
      received: invoices.received + ecommerce.received,
      open: invoices.open + ecommerce.open,
    },
  };
};
