import { FilterState, Transaction } from '../types';
import { getOriginalAmount, isEntradaTransaction, isPaidStatus, isSaidaTransaction } from './transactionAmounts';

export type TransactionSortField = 'client' | 'clientNumber' | 'dueDate' | 'receiptDate' | 'cpfCnpj' | 'none';
export type TransactionSortDirection = 'asc' | 'desc';
export type PossibleDuplicateReason = 'submission' | 'exact' | 'paid-open';

export interface PossibleDuplicateSignal {
  groupIds: string[];
  reasons: PossibleDuplicateReason[];
}

export interface PossibleDuplicateScan {
  byTransactionId: Map<string, PossibleDuplicateSignal>;
  groupCount: number;
  transactionCount: number;
}

export const buildDuplicateScanFilters = (filters: Partial<FilterState>): Partial<FilterState> => ({
  ...filters,
  // Uma duplicidade pode ter uma linha paga e outra pendente. O status limita
  // apenas a tabela; a comparação preserva direção, período e demais filtros.
  status: '',
});

const normalizeText = (value: unknown): string => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const cleanDigits = (value: unknown): string => String(value ?? '').replace(/\D/g, '');

const compareOptionalText = (left: unknown, right: unknown): number => {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
};

const compareClientNumber = (left: Transaction, right: Transaction): number => {
  const a = String(left.clientNumber ?? '').trim();
  const b = String(right.clientNumber ?? '').trim();
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const numericA = Number(a.replace(/\D/g, ''));
  const numericB = Number(b.replace(/\D/g, ''));
  if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) return numericA - numericB;
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
};

export const sortTransactions = (
  transactions: Transaction[], field: TransactionSortField = 'none', direction: TransactionSortDirection = 'asc',
): Transaction[] => {
  if (field === 'none') return transactions;
  return transactions.map((transaction, index) => ({ transaction, index })).sort((left, right) => {
    if (field === 'dueDate' || field === 'receiptDate') {
      const leftDate = field === 'dueDate' ? left.transaction.dueDate : left.transaction.paymentDate;
      const rightDate = field === 'dueDate' ? right.transaction.dueDate : right.transaction.paymentDate;
      if (!leftDate && !rightDate) return left.index - right.index;
      if (!leftDate) return 1;
      if (!rightDate) return -1;
    }
    let comparison = 0;
    if (field === 'client') comparison = compareOptionalText(left.transaction.client, right.transaction.client);
    if (field === 'clientNumber') comparison = compareClientNumber(left.transaction, right.transaction);
    if (field === 'dueDate') comparison = compareOptionalText(left.transaction.dueDate, right.transaction.dueDate);
    if (field === 'receiptDate') comparison = compareOptionalText(left.transaction.paymentDate, right.transaction.paymentDate);
    if (field === 'cpfCnpj') comparison = compareOptionalText(cleanDigits(left.transaction.cpfCnpj), cleanDigits(right.transaction.cpfCnpj));
    if (comparison === 0) return left.index - right.index;
    return direction === 'asc' ? comparison : -comparison;
  }).map(({ transaction }) => transaction);
};

const transactionDirection = (transaction: Transaction): 'Entrada' | 'Saida' | '' => {
  if (isEntradaTransaction(transaction)) return 'Entrada';
  if (isSaidaTransaction(transaction)) return 'Saida';
  return '';
};

const getIdentityKey = (transaction: Transaction): string => {
  const document = cleanDigits(transaction.cpfCnpj);
  if (document) return `doc:${document}`;
  const name = normalizeText(transaction.client || transaction.description || transaction.observacaoAPagar);
  return name ? `name:${name}` : '';
};

const getBusinessDetail = (transaction: Transaction, direction: 'Entrada' | 'Saida'): string => {
  const candidates = direction === 'Saida'
    ? [transaction.observacaoAPagar, transaction.observacao, transaction.numeroDocumento]
    : [transaction.observacaoReceber, transaction.observacao, transaction.cobrancaExtra, transaction.parcela, transaction.numeroDocumento];
  const client = normalizeText(transaction.client || transaction.description);
  return candidates.map(normalizeText).find((value) => value && value !== client) || '';
};

const isEmployeeBenefitPayable = (transaction: Transaction): boolean => {
  if (transactionDirection(transaction) !== 'Saida') return false;
  const category = normalizeText(`${transaction.client || ''} ${transaction.description || ''}`);
  const detail = normalizeText(transaction.observacaoAPagar || transaction.observacao || '');
  return category.includes('vale refeicao')
    || category.includes('vale transporte')
    || category.includes('domestica vt')
    || /^(vr|vt)\b/.test(detail);
};

const buildBaseDuplicateKey = (transaction: Transaction): string => {
  if (isEmployeeBenefitPayable(transaction)) return '';
  const direction = transactionDirection(transaction);
  const identity = getIdentityKey(transaction);
  const dueDate = String(transaction.dueDate || '').trim();
  const amount = getOriginalAmount(transaction);
  if (!direction || !identity || !dueDate || !Number.isFinite(amount) || Math.abs(amount) < 0.01) return '';
  return [direction, identity, dueDate, amount.toFixed(2)].join('|');
};

export const findPossibleDuplicateTransactions = (transactions: Transaction[]): PossibleDuplicateScan => {
  const bySubmission = new Map<string, Transaction[]>();
  const byExactKey = new Map<string, Transaction[]>();
  const byBaseKey = new Map<string, Transaction[]>();
  transactions.filter((transaction) => !transaction.isExcluded).forEach((transaction) => {
    const submissionId = String(transaction.submissionId || '').trim();
    if (submissionId) bySubmission.set(submissionId, [...(bySubmission.get(submissionId) || []), transaction]);
    const baseKey = buildBaseDuplicateKey(transaction);
    if (!baseKey) return;
    const direction = transactionDirection(transaction);
    const detail = direction ? getBusinessDetail(transaction, direction) : '';
    const exactKey = `${baseKey}|detail:${detail || 'none'}`;
    byExactKey.set(exactKey, [...(byExactKey.get(exactKey) || []), transaction]);
    byBaseKey.set(baseKey, [...(byBaseKey.get(baseKey) || []), transaction]);
  });

  const groups = new Map<string, { reason: PossibleDuplicateReason; transactions: Transaction[] }>();
  const addGroup = (key: string, reason: PossibleDuplicateReason, group: Transaction[]) => {
    if (group.length > 1 && !groups.has(key)) groups.set(key, { reason, transactions: group });
  };
  bySubmission.forEach((group, key) => addGroup(`submission:${key}`, 'submission', group));
  byExactKey.forEach((group, key) => {
    const hasPaid = group.some((transaction) => isPaidStatus(transaction.status));
    const hasOpen = group.some((transaction) => !isPaidStatus(transaction.status));
    addGroup(`exact:${key}`, hasPaid && hasOpen ? 'paid-open' : 'exact', group);
  });
  byBaseKey.forEach((group, key) => {
    const paid = group.filter((transaction) => isPaidStatus(transaction.status));
    const open = group.filter((transaction) => !isPaidStatus(transaction.status));
    if (!paid.length || !open.length) return;
    const direction = transactionDirection(group[0]);
    if (!direction) return;
    const compatibleOpen = open.filter((openTransaction) => {
      const openDetail = getBusinessDetail(openTransaction, direction);
      return paid.some((paidTransaction) => {
        const paidDetail = getBusinessDetail(paidTransaction, direction);
        return !openDetail || !paidDetail || openDetail === paidDetail;
      });
    });
    addGroup(`paid-open:${key}`, 'paid-open', [...paid, ...compatibleOpen]);
  });

  const byTransactionId = new Map<string, PossibleDuplicateSignal>();
  groups.forEach(({ reason, transactions: group }, groupId) => group.forEach((transaction) => {
    const signal = byTransactionId.get(transaction.id) || { groupIds: [], reasons: [] };
    if (!signal.groupIds.includes(groupId)) signal.groupIds.push(groupId);
    if (!signal.reasons.includes(reason)) signal.reasons.push(reason);
    byTransactionId.set(transaction.id, signal);
  }));
  const uniqueGroups = new Set(Array.from(groups.values()).map(({ transactions: group }) => (
    group.map((transaction) => transaction.id).sort().join('|')
  )));
  return { byTransactionId, groupCount: uniqueGroups.size, transactionCount: byTransactionId.size };
};
