import { Transaction } from '../types';
import { addMonths } from './billingForecast';
import { getOriginalAmount, isEntradaTransaction } from './transactionAmounts';

export type BillingPeriodField = 'date' | 'dueDate';
export interface BillingCompletenessRow {
  identity: string;
  client: string;
  previousAmount: number;
  currentAmount: number;
  previousIds: string[];
  currentIds: string[];
  issues: string[];
}

const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
const identityOf = (transaction: Transaction) => {
  const document = digits(transaction.cpfCnpj);
  if (document.length === 11 || document.length === 14) return `doc:${document}`;
  const number = String(transaction.clientNumber || '').trim();
  return number ? `number:${number}` : '';
};
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Conferência de lançamentos. Não infere emissão, encerramento contratual ou dispensa. */
export const buildBillingCompleteness = (
  transactions: Transaction[], targetMonth: string, field: BillingPeriodField,
) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) throw new Error('Mês de conferência inválido.');
  const previousMonth = addMonths(targetMonth, -1);
  const receivables = transactions.filter(item => !item.isExcluded && isEntradaTransaction(item));
  // Um número vinculado a dois documentos nunca pode juntar clientes automaticamente.
  const documentsByNumber = new Map<string, Set<string>>();
  for (const item of receivables) {
    const number = String(item.clientNumber || '').trim();
    const identity = identityOf(item);
    if (number && identity.startsWith('doc:')) {
      const documents = documentsByNumber.get(number) || new Set<string>();
      documents.add(identity);
      documentsByNumber.set(number, documents);
    }
  }
  const rows = new Map<string, BillingCompletenessRow>();
  const sourceIssues: string[] = [];
  for (const item of receivables) {
    const id = item.firestoreId || item.id;
    const date = item[field];
    if (!validDate(date)) {
      sourceIssues.push(`${item.client || 'Cliente sem nome'} (${id}): ${field === 'date' ? 'lançamento' : 'vencimento'} ausente ou inválido.`);
      continue;
    }
    const month = date.slice(0, 7);
    if (month !== previousMonth && month !== targetMonth) continue;
    let identity = identityOf(item);
    const number = String(item.clientNumber || '').trim();
    const linked = documentsByNumber.get(number);
    if (identity.startsWith('number:') && linked?.size === 1) identity = [...linked][0];
    const unidentified = !identity;
    if (unidentified) identity = `unidentified:${id}`;
    const row = rows.get(identity) || {
      identity, client: item.client || 'Cliente sem nome', previousAmount: 0, currentAmount: 0,
      previousIds: [], currentIds: [], issues: [],
    };
    if (unidentified) row.issues.push('Identificação insuficiente: informar CPF/CNPJ ou número do cliente.');
    if (linked && linked.size > 1) row.issues.push('Número do cliente associado a documentos diferentes: revisar identificação.');
    const amount = getOriginalAmount(item);
    if (!Number.isFinite(amount) || amount <= 0) row.issues.push(`Valor da cobrança ausente ou inválido (${id}).`);
    const cents = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    if (month === previousMonth) {
      row.previousAmount += cents;
      row.previousIds.push(id);
    } else {
      row.currentAmount += cents;
      row.currentIds.push(id);
    }
    rows.set(identity, row);
  }
  const result = [...rows.values()].map(row => {
    if (row.previousIds.length && !row.currentIds.length) row.issues.push('Sem lançamento no mês atual: cobrar ou comprovar a dispensa contratual.');
    if (row.previousIds.length && row.currentIds.length && row.previousAmount !== row.currentAmount) row.issues.push('Valor diferente do mês anterior: confrontar contrato, reajuste e cobranças extras.');
    if (row.previousIds.length > 1 || row.currentIds.length > 1) row.issues.push('Múltiplos lançamentos: revisar parcelas, extras e possível duplicidade entre fontes.');
    return { ...row, previousAmount: row.previousAmount / 100, currentAmount: row.currentAmount / 100, issues: [...new Set(row.issues)] };
  }).sort((a, b) => b.issues.length - a.issues.length || a.client.localeCompare(b.client, 'pt-BR'));
  const expected = result.filter(row => row.previousIds.length > 0);
  const missing = expected.filter(row => row.currentIds.length === 0);
  return {
    previousMonth, targetMonth, field, rows: result, sourceIssues,
    previousClients: expected.length, missingClients: missing.length,
    presentClients: expected.length - missing.length,
    newClients: result.filter(row => !row.previousIds.length && row.currentIds.length).length,
    missingReferenceAmount: missing.reduce((total, row) => total + Math.round(row.previousAmount * 100), 0) / 100,
    postingCoverage: expected.length ? (expected.length - missing.length) / expected.length : null,
    // Sem checklist lido e comprovantes do emissor, cobertura de lançamentos não libera o mês.
    checklistCoverage: null, issuanceCoverage: null, canCloseMonth: false,
  };
};
