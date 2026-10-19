import type { WixSaleRow, WixTreasuryReport } from './wixTreasuryService';

// Parcelas do Wix Pagamentos Brasil, no formato do Relatório de pagamentos do painel
// ("funds-report-all-to-all.csv"). A conta brasileira não é coberta pelas APIs públicas de
// saldo e resgates: o servidor prevê as parcelas a partir das transações (wix-treasury.js),
// e o leitor do CSV fica para conferir essas regras contra o arquivo real nos testes.

export type WixFundsStatus = 'liberado' | 'aguardando' | 'outro';

export interface WixFundsPayable {
  paymentDate: string;
  transactionDate: string;
  type: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  status: WixFundsStatus;
  installment: number | null;
  transactionId: string;
  orderId: string | null;
  method?: string | null;
  estimated?: boolean;
}

export interface WixFundsSummary {
  fileName: string;
  payables: number;
  fileStart: string | null;
  fileEnd: string | null;
  coversPeriod: boolean;
  matchedOrders: number;
  releasedCents: number;
  pendingCents: number;
  feesCents: number;
  releasedInPeriodCents: number;
  pendingAllCents: number;
  pendingAllCount: number;
  nextRelease: { date: string; cents: number } | null;
  noOrderInPeriodCents: number;
  noOrderInPeriodCount: number;
  reversalsInPeriodCents: number;
  reversalsInPeriodCount: number;
}

export class WixFundsFileError extends Error {}

const REQUIRED = ['paymentDate', 'transactionCreationDate', 'payableType', 'amount', 'wixFee', 'netAmount', 'payableStatus', 'transactionId', 'externalOrderId'];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

// "1.666,43" e "-27,24" em centavos.
export function brMoneyToCents(value: string): number {
  const clean = value.trim().replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) throw new WixFundsFileError(`Valor inválido no relatório da Wix: ${value}`);
  return Math.round(Number(clean) * 100);
}

// "05/01/27 06:00" em "2027-01-05".
export function brDateToIso(value: string): string {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})/);
  if (!match) throw new WixFundsFileError(`Data inválida no relatório da Wix: ${value}`);
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2]}-${match[1]}`;
}

const statusOf = (value: string): WixFundsStatus => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pago') return 'liberado';
  if (normalized === 'aguardando pagamento') return 'aguardando';
  return 'outro';
};

export function parseWixFundsCsv(text: string): WixFundsPayable[] {
  const [header, ...lines] = parseCsv(text);
  const missing = REQUIRED.filter(column => !(header || []).includes(column));
  if (missing.length) {
    throw new WixFundsFileError('Este arquivo não é o Relatório de pagamentos da Wix. Exporte em Wix Pagamentos > Relatório de pagamentos.');
  }
  const col = Object.fromEntries(header.map((name, index) => [name, index]));
  return lines.map(cells => {
    const get = (name: string) => (cells[col[name]] || '').trim();
    const installment = Number(get('installmentNumber'));
    return {
      paymentDate: brDateToIso(get('paymentDate')),
      transactionDate: brDateToIso(get('transactionCreationDate')),
      type: get('payableType'),
      amountCents: brMoneyToCents(get('amount')),
      feeCents: brMoneyToCents(get('wixFee')),
      netCents: brMoneyToCents(get('netAmount')),
      status: statusOf(get('payableStatus')),
      installment: Number.isInteger(installment) && installment > 0 ? installment : null,
      transactionId: get('transactionId'),
      orderId: get('externalOrderId') || null,
    };
  });
}

const inPeriod = (date: string, period: { start: string; end: string }) => date >= period.start && date <= period.end;
const sum = (items: WixFundsPayable[]) => items.reduce((total, item) => total + item.netCents, 0);
// Data do pedido no horário de Brasília, como no arquivo da Wix.
const brasiliaDay = (iso: string | null) => {
  const ms = Date.parse(iso || '');
  return Number.isNaN(ms) ? null : new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

// Confronta cada pedido do relatório de vendas com as parcelas do arquivo da Wix.
// "Pago" no arquivo é a parcela liberada pela Wix; "Aguardando pagamento" ainda vai ser liberada.
export function applyWixFunds(report: WixTreasuryReport, payables: WixFundsPayable[], fileName: string): { report: WixTreasuryReport; summary: WixFundsSummary } {
  const byOrder = new Map<string, WixFundsPayable[]>();
  for (const payable of payables) {
    if (!payable.orderId) continue;
    byOrder.set(payable.orderId, [...(byOrder.get(payable.orderId) || []), payable]);
  }

  const dates = payables.map(item => item.transactionDate).sort();
  const fileStart = dates[0] || null;
  const fileEnd = dates[dates.length - 1] || null;
  let ordersAfterFile = 0;

  let releasedCents = 0;
  let pendingCents = 0;
  let feesCents = 0;
  let matchedOrders = 0;
  const rows: WixSaleRow[] = (report.rows || []).map(row => {
    const own = byOrder.get(row.id);
    if (row.situation === 'cancelado' || row.situation === 'aguardando_cliente') return row;
    if (!own) {
      // Venda posterior à última parcela do arquivo: o arquivo é que está desatualizado.
      const day = brasiliaDay(row.purchasedDate || row.createdDate);
      const afterFile = Boolean(fileEnd && day && day > fileEnd);
      if (afterFile) ordersAfterFile += 1;
      return { ...row, situation: afterFile ? 'conferir' : 'fora_wix_payments', feeCents: null, netCents: null, availableOn: null, payoutDate: null };
    }
    matchedOrders += 1;
    const released = own.filter(item => item.status === 'liberado');
    const pending = own.filter(item => item.status === 'aguardando').sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
    const fee = own.reduce((total, item) => total + item.feeCents, 0);
    releasedCents += sum(released);
    pendingCents += sum(pending);
    feesCents += fee;
    const lastRelease = released.map(item => item.paymentDate).sort().pop() || null;
    return {
      ...row,
      feeCents: fee,
      netCents: sum(own),
      situation: own.some(item => item.status === 'outro') ? 'conferir' : pending.length ? 'em_liberacao' : 'liberado',
      availableOn: pending[0]?.paymentDate || null,
      payoutDate: pending.length ? null : lastRelease,
      releasedCents: sum(released),
      pendingCents: sum(pending),
      installments: own.length,
    };
  });

  const period = report.period;
  const allPending = payables.filter(item => item.status === 'aguardando').sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
  const nextDate = allPending[0]?.paymentDate;
  const noOrder = payables.filter(item => !item.orderId && item.netCents > 0 && inPeriod(item.transactionDate, period));
  const reversals = payables.filter(item => item.netCents < 0 && inPeriod(item.paymentDate, period));
  const totals = report.totals ? {
    ...report.totals,
    feesCents,
    withdrawnCents: releasedCents,
    pendingReleaseCents: pendingCents,
    availableCents: null,
    outsideWixPaymentsCents: rows.filter(row => row.situation === 'fora_wix_payments').reduce((total, row) => total + (row.paidCents || 0), 0),
  } : report.totals;

  return {
    report: { ...report, rows, totals },
    summary: {
      fileName,
      payables: payables.length,
      fileStart,
      fileEnd,
      coversPeriod: Boolean(fileStart && fileStart <= period.start && ordersAfterFile === 0),
      matchedOrders,
      releasedCents,
      pendingCents,
      feesCents,
      releasedInPeriodCents: sum(payables.filter(item => item.status === 'liberado' && inPeriod(item.paymentDate, period))),
      pendingAllCents: sum(allPending),
      pendingAllCount: allPending.length,
      nextRelease: nextDate ? { date: nextDate, cents: sum(allPending.filter(item => item.paymentDate === nextDate)) } : null,
      noOrderInPeriodCents: sum(noOrder),
      noOrderInPeriodCount: noOrder.length,
      reversalsInPeriodCents: sum(reversals),
      reversalsInPeriodCount: reversals.length,
    },
  };
}
