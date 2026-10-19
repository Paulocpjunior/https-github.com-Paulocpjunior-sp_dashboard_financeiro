import { auth } from '../firebase';
import type { WixFundsPayable } from './wixFundsReport';

export type WixSaleSituation =
  | 'resgatado'
  | 'liberado'
  | 'disponivel'
  | 'em_liberacao'
  | 'aguardando_cliente'
  | 'fora_wix_payments'
  | 'cancelado'
  | 'pago'
  | 'conferir';

export interface WixSaleRow {
  id: string;
  number: string | null;
  createdDate: string | null;
  purchasedDate: string | null;
  status: string | null;
  paymentStatus: string | null;
  buyer: string;
  email: string | null;
  items: string[];
  totalCents: number | null;
  paidCents: number | null;
  refundedCents: number | null;
  feeCents: number | null;
  netCents: number | null;
  situation: WixSaleSituation;
  availableOn: string | null;
  payoutId: string | null;
  payoutDate: string | null;
  inFinance: boolean;
  // Preenchidos ao importar o Relatório de pagamentos da Wix (conta Brasil).
  releasedCents?: number;
  pendingCents?: number;
  installments?: number;
}

export interface WixPayoutRow {
  id: string | null;
  createdDate: string | null;
  status: string;
  amountCents: number | null;
  arrival: string | null;
  reference: string | null;
  failure: string | null;
}

export interface WixOtherRecord {
  id: string | null;
  type: string;
  status: string;
  amountCents: number | null;
  feeCents: number | null;
  netCents: number | null;
  displayOrderId: string | null;
  customer: string | null;
  transactionCreated: string | null;
}

export interface WixTreasuryTotals {
  orders: number;
  canceled: number;
  soldCents: number;
  paidByCustomersCents: number;
  awaitingCustomersCents: number;
  feesCents: number | null;
  withdrawnCents: number | null;
  pendingReleaseCents: number | null;
  availableCents: number | null;
  outsideWixPaymentsCents: number | null;
  otherRecordsNetCents: number | null;
  payoutsSentCents: number | null;
  payoutsFailed: number;
  notInFinance: number;
}

export interface WixTreasuryReport {
  configured: boolean;
  missing?: string[];
  paymentsEnabled?: boolean;
  paymentsMissing?: string[];
  period: { start: string; end: string };
  generatedAt?: string;
  truncated?: boolean;
  balance?: { pendingCents: number | null; availableCents: number | null } | null;
  rows?: WixSaleRow[];
  otherRecords?: WixOtherRecord[];
  payouts?: WixPayoutRow[];
  totals?: WixTreasuryTotals;
  // Parcelas previstas do Wix Pagamentos Brasil, calculadas pelo servidor.
  payables?: WixFundsPayable[];
  paymentsError?: string;
}

export class WixTreasuryRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function fetchWixTreasuryReport(start: string, end: string): Promise<WixTreasuryReport> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new WixTreasuryRequestError('Entre novamente para consultar a Tesouraria Wix.', 401);
  const params = new URLSearchParams({ start, end });
  const response = await fetch(`/api/wix-treasury/report?${params}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new WixTreasuryRequestError('Relatório Wix indisponível. Tente novamente mais tarde.', 503);
  }
  const payload = await response.json();
  if (!response.ok) throw new WixTreasuryRequestError(payload.error || 'Não foi possível gerar o relatório Wix.', response.status);
  return payload;
}

export const WIX_SITUATION_LABELS: Record<WixSaleSituation, string> = {
  resgatado: 'Resgatado',
  liberado: 'Liberado pela Wix',
  disponivel: 'Disponível para resgate',
  em_liberacao: 'Em liberação na Wix',
  aguardando_cliente: 'Aguardando pagamento do cliente',
  fora_wix_payments: 'Pago fora do Wix Payments',
  cancelado: 'Cancelado',
  pago: 'Pago',
  conferir: 'Conferir na Wix',
};

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvMoney = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','));

// CSV separado por ponto e vírgula para abrir direto no Excel em português.
export function wixReportToCsv(report: WixTreasuryReport): string {
  const header = ['Pedido', 'Data', 'Cliente', 'E-mail', 'Itens', 'Vendido', 'Pago pelo cliente', 'Taxa Wix', 'Líquido Wix', 'Já liberado', 'A liberar', 'Situação', 'Próxima liberação', 'Liberado ou resgatado em', 'Lançado no Financeiro'];
  const lines = (report.rows || []).map(row => [
    row.number ? `#${row.number}` : row.id,
    (row.purchasedDate || row.createdDate || '').slice(0, 10),
    row.buyer,
    row.email,
    row.items.join(' | '),
    csvMoney(row.totalCents),
    csvMoney(row.paidCents),
    csvMoney(row.feeCents),
    csvMoney(row.netCents),
    csvMoney(row.releasedCents ?? null),
    csvMoney(row.pendingCents ?? null),
    WIX_SITUATION_LABELS[row.situation],
    (row.availableOn || '').slice(0, 10),
    (row.payoutDate || '').slice(0, 10),
    row.inFinance ? 'Sim' : 'Não',
  ]);
  return '﻿' + [header, ...lines].map(cols => cols.map(csvCell).join(';')).join('\r\n');
}
