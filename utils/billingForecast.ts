import { BillingDeliveryChannel, BillingForecastRow, BillingProfile, Transaction } from '../types';
import { getPaymentMethod } from './paymentMethod';
import { getOriginalAmount, isEntradaTransaction, isWixInvoice, parseMoneyValue } from './transactionAmounts';

export type BillingSortField = 'groupName' | 'client' | 'clientNumber' | 'referenceAmount' | 'issueDate' | 'dueDate' | 'billingMethod' | 'status';
export type BillingSortDirection = 'asc' | 'desc';

const normalizeText = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const cleanDigits = (value: unknown): string => String(value || '').replace(/\D/g, '');

export const getBillingIdentityKey = (source: Pick<Transaction, 'cpfCnpj' | 'clientNumber' | 'client'> | Pick<BillingProfile, 'cpfCnpj' | 'clientNumber' | 'client'>): string => {
  const document = cleanDigits(source.cpfCnpj);
  if (document) return `doc-${document}`;

  const clientNumber = cleanDigits(source.clientNumber);
  if (clientNumber) return `client-${clientNumber}`;

  return `name-${normalizeText(source.client) || 'sem-identificacao'}`;
};

export const getMonthRange = (month: string): { startDate: string; endDate: string } => {
  const [year, monthNumber] = month.split('-').map(Number);
  const endDay = new Date(year, monthNumber, 0).getDate();
  return {
    startDate: `${year}-${String(monthNumber).padStart(2, '0')}-01`,
    endDate: `${year}-${String(monthNumber).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
};

export const addMonths = (month: string, count: number): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + count, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const dateForMonthDay = (month: string, day: number | undefined): string => {
  if (!day || day < 1) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const safeDay = Math.min(Math.max(Math.trunc(day), 1), lastDay);
  return `${month}-${String(safeDay).padStart(2, '0')}`;
};

export const formatDeliveryChannels = (channels: BillingDeliveryChannel[]): string => {
  const labels: Record<BillingDeliveryChannel, string> = {
    email: 'E-mail',
    whatsapp: 'WhatsApp',
    printed: 'Físico impresso',
  };
  return channels.map(channel => labels[channel]).join(' + ');
};

const getDay = (date: string | undefined): number | undefined => {
  const day = Number(String(date || '').split('-')[2]);
  return Number.isFinite(day) && day > 0 ? day : undefined;
};

const preferredText = (...values: unknown[]): string => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
};

const uniqueTexts = (values: unknown[]): string[] => Array.from(new Set(
  values.map(value => String(value || '').trim()).filter(Boolean),
));

const canonicalBillingMethod = (value: unknown): string => {
  const original = String(value || '').trim();
  const normalized = normalizeText(original);
  if (!normalized) return '';
  if (normalized.includes('wix') || normalized.includes('fatura-online')) return 'Fatura Wix';
  if (normalized.includes('boleto')) return 'Boleto Itaú';
  return original;
};

const isConfirmedBillingMethod = (value: string): boolean => [
  'Boleto Itaú',
  'Fatura Wix',
  'Boleto Itaú + Fatura Wix',
  'Outro',
].includes(value);

export const buildBillingForecastRows = (
  transactions: Transaction[],
  profiles: BillingProfile[],
  referenceMonth: string,
  targetMonth: string,
  referenceField: 'date' | 'dueDate' = 'date',
): BillingForecastRow[] => {
  const activeTransactions = transactions.filter(transaction => !transaction.isExcluded && isEntradaTransaction(transaction));
  const activeProfiles = profiles.filter(profile => profile.active !== false);
  const transactionsByKey = new Map<string, Transaction[]>();
  const profilesByKey = new Map<string, BillingProfile>();

  for (const transaction of activeTransactions) {
    const key = getBillingIdentityKey(transaction);
    const rows = transactionsByKey.get(key) || [];
    rows.push(transaction);
    transactionsByKey.set(key, rows);
  }

  for (const profile of activeProfiles) {
    const key = profile.identityKey || getBillingIdentityKey(profile);
    profilesByKey.set(key, profile);
  }

  const keys = new Set([...transactionsByKey.keys(), ...profilesByKey.keys()]);

  return Array.from(keys).map(identityKey => {
    const matchingTransactions = (transactionsByKey.get(identityKey) || [])
      .sort((left, right) => String(right[referenceField] || '').localeCompare(String(left[referenceField] || ''))
        || (right.dueDate || right.date || '').localeCompare(left.dueDate || left.date || ''));
    const profile = profilesByKey.get(identityKey);
    const latest = matchingTransactions[0];
    const deliveryChannels = profile?.deliveryChannels || [];
    const client = preferredText(profile?.client, latest?.client);
    const issueDay = profile?.issueDay || getDay(latest?.date);
    const dueDay = profile?.dueDay || getDay(latest?.dueDate);
    const inferredMethods = uniqueTexts(matchingTransactions.map(transaction => canonicalBillingMethod(
      getPaymentMethod(transaction) || (isWixInvoice(transaction) ? 'Fatura Wix' : ''),
    )));
    const issueDays = uniqueTexts(matchingTransactions.map(transaction => getDay(transaction.date)));
    const dueDays = uniqueTexts(matchingTransactions.map(transaction => getDay(transaction.dueDate)));
    const billingMethod = canonicalBillingMethod(preferredText(
      profile?.billingMethod,
      inferredMethods[0],
      latest && isWixInvoice(latest) ? 'Fatura Wix' : '',
    ));
    const billingEmail = preferredText(profile?.billingEmail);
    const whatsapp = preferredText(profile?.whatsapp);
    const printedDeliveryDetails = preferredText(profile?.printedDeliveryDetails);
    const missingFields: string[] = [];
    const conflicts: string[] = [];

    if (!profile?.billingMethod && inferredMethods.length > 1) conflicts.push('métodos de cobrança divergentes');
    if (!profile?.issueDay && issueDays.length > 1) conflicts.push('dias de emissão divergentes');
    if (!profile?.dueDay && dueDays.length > 1) conflicts.push('dias de vencimento divergentes');

    if (!billingMethod) missingFields.push('método de cobrança');
    else if (!isConfirmedBillingMethod(billingMethod)) missingFields.push('confirmar método de cobrança');
    if (!issueDay) missingFields.push('data de emissão');
    if (!dueDay) missingFields.push('data de vencimento');
    if (deliveryChannels.length === 0) missingFields.push('meio de envio');
    if (deliveryChannels.includes('email') && !billingEmail) missingFields.push('e-mail');
    if (deliveryChannels.includes('whatsapp') && !whatsapp) missingFields.push('WhatsApp');
    if (deliveryChannels.includes('printed') && !printedDeliveryDetails) missingFields.push('entrega física');
    missingFields.push(...conflicts);

    const issueDate = dateForMonthDay(targetMonth, issueDay);
    const dueDate = dateForMonthDay(targetMonth, dueDay);
    const adjustedDates: string[] = [];
    if (issueDay && Number(issueDate.slice(-2)) !== issueDay) adjustedDates.push(`emissão ajustada do dia ${issueDay} para ${Number(issueDate.slice(-2))}`);
    if (dueDay && Number(dueDate.slice(-2)) !== dueDay) adjustedDates.push(`vencimento ajustado do dia ${dueDay} para ${Number(dueDate.slice(-2))}`);

    return {
      identityKey,
      client,
      cpfCnpj: preferredText(profile?.cpfCnpj, latest?.cpfCnpj),
      clientNumber: preferredText(profile?.clientNumber, latest?.clientNumber),
      groupName: preferredText(profile?.groupName, 'Sem grupo'),
      billingMethod,
      issueDate,
      dueDate,
      deliveryChannels,
      billingEmail,
      whatsapp,
      printedDeliveryDetails,
      billingInstructions: preferredText(profile?.billingInstructions),
      honorarios: matchingTransactions.reduce((sum, transaction) => sum + parseMoneyValue(transaction.honorarios), 0),
      extras: matchingTransactions.reduce((sum, transaction) => sum + parseMoneyValue(transaction.valorExtra), 0),
      referenceAmount: matchingTransactions.reduce((sum, transaction) => sum + getOriginalAmount(transaction), 0),
      referenceCount: matchingTransactions.length,
      referenceMonth,
      targetMonth,
      referenceField,
      profile,
      hasReference: matchingTransactions.length > 0,
      missingFields,
      conflicts,
      adjustedDates,
    };
  }).sort((left, right) => {
    const groupComparison = left.groupName.localeCompare(right.groupName, 'pt-BR');
    return groupComparison || left.client.localeCompare(right.client, 'pt-BR');
  });
};

export const makeBillingProfileId = (identityKey: string): string => identityKey
  .replace(/[^a-zA-Z0-9_-]/g, '-')
  .slice(0, 140);

export const sortBillingForecastRows = (
  rows: BillingForecastRow[],
  field: BillingSortField,
  direction: BillingSortDirection,
): BillingForecastRow[] => [...rows].sort((left, right) => {
  let comparison = 0;
  if (field === 'referenceAmount') {
    comparison = left.referenceAmount - right.referenceAmount;
  } else if (field === 'status') {
    comparison = left.missingFields.length - right.missingFields.length;
  } else if (field === 'clientNumber') {
    comparison = String(left.clientNumber || '').localeCompare(String(right.clientNumber || ''), 'pt-BR', { numeric: true });
  } else {
    comparison = String(left[field] || '').localeCompare(String(right[field] || ''), 'pt-BR', { numeric: true });
  }

  if (comparison === 0) {
    comparison = left.client.localeCompare(right.client, 'pt-BR', { numeric: true });
  }
  return direction === 'asc' ? comparison : -comparison;
});
