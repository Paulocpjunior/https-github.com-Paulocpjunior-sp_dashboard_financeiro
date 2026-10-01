import { KPIData, Transaction } from '../types';
import { getOutstandingAmount, getPaidAmount, isEntradaTransaction, isPaidStatus, isSaidaTransaction } from './transactionAmounts';

export const accumulateBalances = (totals: KPIData, transaction: Transaction): KPIData => {
  if (transaction.isExcluded) return totals;
  const entry = isEntradaTransaction(transaction);
  const exit = isSaidaTransaction(transaction);
  const pending = isPaidStatus(transaction.status) ? 0 : Math.round(getOutstandingAmount(transaction) * 100);
  const paid = Math.round(getPaidAmount(transaction) * 100);
  // Acumulador em centavos, independente do mês da consulta da tabela.
  totals.totalReceived += entry ? pending : 0;
  totals.totalPaid += exit ? pending : 0;
  totals.balance += (entry ? paid : 0) - (exit ? paid : 0);
  return totals;
};

export const balancesInReais = (cents: KPIData): KPIData => ({
  totalReceived: cents.totalReceived / 100,
  totalPaid: cents.totalPaid / 100,
  balance: cents.balance / 100,
});
