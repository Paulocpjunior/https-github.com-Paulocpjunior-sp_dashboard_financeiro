import type { WixFundsSummary } from './wixFundsReport';
import { WIX_SITUATION_LABELS, WixSaleRow, WixTreasuryReport } from './wixTreasuryService';

// Versão para papel (A4 deitado) do relatório de vendas da Tesouraria Wix. Abre em uma janela
// própria porque a janela da Tesouraria fica escondida na impressão do painel.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : brl.format(cents / 100));
const day = (value: string | null | undefined) => {
  const iso = (value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
};
const stamp = (value: string | null | undefined) => {
  const ms = Date.parse(value || '');
  return Number.isNaN(ms) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(ms);
};
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

const card = (label: string, value: string, hint?: string) =>
  `<div class="card"><p class="label">${esc(label)}</p><p class="value">${esc(value)}</p>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}</div>`;

const situationDetail = (row: WixSaleRow) => {
  if (row.situation === 'em_liberacao' && row.availableOn) {
    return row.pendingCents !== undefined ? `${money(row.pendingCents)} a receber · próxima em ${day(row.availableOn)}` : `Libera em ${day(row.availableOn)}`;
  }
  if (row.situation === 'liberado' && row.payoutDate) return `Liberado em ${day(row.payoutDate)}${row.installments && row.installments > 1 ? ` · ${row.installments} parcelas` : ''}`;
  if (row.situation === 'resgatado' && row.payoutDate) return `Resgate em ${day(row.payoutDate)}`;
  return '';
};

const financeLabel = (row: WixSaleRow) => (row.inFinance ? 'Lançado' : row.situation === 'cancelado' || row.situation === 'aguardando_cliente' ? '—' : 'Não lançado');

export function wixReportToPrintHtml(report: WixTreasuryReport, summary: WixFundsSummary | null): string {
  const totals = report.totals;
  const rows = report.rows || [];
  const cards = totals ? [
    card('Vendido', money(totals.soldCents), `${totals.orders} pedido(s)${totals.canceled ? `, ${totals.canceled} cancelado(s) fora da soma` : ''}`),
    ...(summary ? [
      card('Liberado pela Wix', money(summary.releasedCents), 'Líquido das vendas do período já liberado'),
      card('A receber da Wix', money(summary.pendingCents), 'Parcelas das vendas do período em liberação'),
    ] : [
      card('Resgatado', money(totals.withdrawnCents), 'Líquido das vendas do período já transferido'),
      card('A receber da Wix', money(totals.pendingReleaseCents === null || totals.availableCents === null ? null : totals.pendingReleaseCents + totals.availableCents)),
    ]),
    card('A receber de clientes', money(totals.awaitingCustomersCents), 'Pedidos ainda não pagos'),
    card('Pago pelos clientes', money(totals.paidByCustomersCents)),
    card('Taxas Wix Payments', money(totals.feesCents)),
    card('Pago fora do Wix Payments', money(totals.outsideWixPaymentsCents)),
    card('Não lançados no Financeiro', String(totals.notInFinance)),
    ...(summary ? [
      card('Liberado no período', money(summary.releasedInPeriodCents), 'Tudo que a Wix liberou nestas datas'),
      card('A receber da Wix hoje', money(summary.pendingAllCents), summary.nextRelease ? `Próxima ${day(summary.nextRelease.date)}: ${money(summary.nextRelease.cents)}` : 'Nenhuma parcela pendente'),
      card('Recebimentos sem pedido da loja', money(summary.noOrderInPeriodCents), `${summary.noOrderInPeriodCount} parcela(s)`),
      card('Estornos e chargebacks', money(summary.reversalsInPeriodCents), `${summary.reversalsInPeriodCount} no período`),
    ] : []),
  ].join('') : '';

  const body = rows.length ? rows.map(row => {
    const detail = situationDetail(row);
    return `<tr>
<td class="nowrap">${esc(row.number ? `#${row.number}` : '—')}</td>
<td class="nowrap num">${esc(day(row.purchasedDate || row.createdDate))}</td>
<td>${esc(row.buyer)}${row.items.length ? `<span class="sub">${esc(row.items.join(', '))}</span>` : ''}</td>
<td class="nowrap num right">${esc(money(row.totalCents))}</td>
<td class="nowrap num right">${esc(money(row.netCents))}</td>
<td><strong>${esc(WIX_SITUATION_LABELS[row.situation])}</strong>${detail ? `<span class="sub">${esc(detail)}</span>` : ''}</td>
<td class="nowrap">${esc(financeLabel(row))}</td>
</tr>`;
  }).join('\n') : '<tr><td colspan="7" class="empty">Nenhuma venda na loja Wix neste período.</td></tr>';

  const note = summary
    ? 'Liberações calculadas automaticamente a partir das transações do Wix Pagamentos. Taxas e datas futuras são previstas pelas regras da Wix Brasil: cartão 3,7% + R$ 0,30 com parcelas a cada 30 dias, Pix 0,95% no mesmo dia e boleto R$ 2,99 em poucos dias.'
    : 'Mostrando só as vendas: a Wix não devolveu as transações do Wix Pagamentos para calcular liberações.';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Tesouraria Wix ${esc(day(report.period.start))} a ${esc(day(report.period.end))}</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1d1d1f; background: #fff; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid #d2d2d7; padding-bottom: 8px; margin-bottom: 12px; }
h1 { font-size: 18px; margin: 0; }
.muted { color: #626268; margin: 2px 0 0; }
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
.card { border: 1px solid #d2d2d7; border-radius: 10px; padding: 6px 8px; break-inside: avoid; }
.card p { margin: 0; }
.label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: #626268; }
.value { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px !important; }
.hint { font-size: 9px; color: #626268; }
.note { border: 1px solid #d2d2d7; border-radius: 10px; padding: 6px 8px; margin: 0 0 10px; color: #626268; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; color: #626268; background: #f5f5f7; padding: 5px 6px; border-bottom: 1px solid #d2d2d7; }
td { padding: 4px 6px; border-bottom: 1px solid #e8e8ed; vertical-align: top; }
tr { break-inside: avoid; }
.sub { display: block; color: #626268; font-size: 9px; }
.num { font-variant-numeric: tabular-nums; }
.right { text-align: right; }
.nowrap { white-space: nowrap; }
.empty { text-align: center; color: #626268; padding: 16px; }
footer { margin-top: 10px; color: #626268; font-size: 9px; }
</style>
</head>
<body>
<header>
<div><h1>Tesouraria Wix · Relatório de vendas</h1><p class="muted">SP Contábil · Período de ${esc(day(report.period.start))} a ${esc(day(report.period.end))}</p></div>
<p class="muted">Gerado em ${esc(stamp(report.generatedAt))}</p>
</header>
${cards ? `<section class="cards">${cards}</section>` : ''}
<p class="note">${esc(note)}</p>
<table>
<thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th class="right">Vendido</th><th class="right">Líquido Wix</th><th>Situação</th><th>Financeiro</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
${report.truncated ? '<p class="note">O período tem mais registros do que o limite de uma consulta. Reduza o período para ver todos.</p>' : ''}
<footer>Consulta somente leitura à Wix. Nenhum valor ou lançamento é alterado.</footer>
</body>
</html>`;
}
