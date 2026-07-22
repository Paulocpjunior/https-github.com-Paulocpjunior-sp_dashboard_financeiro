import type { Transaction } from '../types';

export const formatExtraChargeDescription = (value: unknown): string => {
  if (typeof value !== 'string') return '';

  return value
    .trim()
    .replace(/\s*(?:\r?\n)+\s*/g, ' / ')
    .replace(/[ \t]+/g, ' ');
};

export const hasExtraCharge = (transaction: Pick<Transaction, 'cobrancaExtra'>): boolean => {
  return formatExtraChargeDescription(transaction.cobrancaExtra).length > 0;
};
