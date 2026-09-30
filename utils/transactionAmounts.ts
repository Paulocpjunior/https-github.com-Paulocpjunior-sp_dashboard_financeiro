import { Transaction } from '../types';
import * as amounts from '../shared/transactionAmounts.mjs';

// Mesmas regras no navegador e servidor; preserva a API tipada existente.
export const parseMoneyValue = (value: unknown): number => amounts.parseMoneyValue(value);
export const isPaidStatus = (status: unknown): boolean => amounts.isPaidStatus(status);
export const isWixInvoice = (transaction: Transaction): boolean => amounts.isWixInvoice(transaction);
export const isEntradaTransaction = (transaction: Transaction): boolean => amounts.isEntradaTransaction(transaction);
export const isSaidaTransaction = (transaction: Transaction): boolean => amounts.isSaidaTransaction(transaction);
export const getOriginalAmount = (transaction: Transaction): number => amounts.getOriginalAmount(transaction);
export const getPaidAmount = (transaction: Transaction): number => amounts.getPaidAmount(transaction);
export const getOutstandingAmount = (transaction: Transaction): number => amounts.getOutstandingAmount(transaction);
