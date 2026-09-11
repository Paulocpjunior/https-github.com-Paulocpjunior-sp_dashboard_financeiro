import { Transaction } from '../types';

type PaymentMethodTransaction = Pick<Transaction, 'metodoPagamento' | 'paymentMethod' | 'method'>;

const cleanPaymentMethod = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

/**
 * Preserva o valor original do Jotform como fonte principal. Os aliases existem
 * para lançamentos de outras integrações e para registros legados.
 */
export const getPaymentMethod = (transaction: PaymentMethodTransaction): string => {
  return cleanPaymentMethod(transaction.metodoPagamento)
    || cleanPaymentMethod(transaction.paymentMethod)
    || cleanPaymentMethod(transaction.method);
};
