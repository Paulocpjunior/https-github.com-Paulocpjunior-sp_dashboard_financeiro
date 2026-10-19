import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { User } from '../types';
import { savePDF } from '../utils/pdfDownload';
import type { WixFundsSummary } from './wixFundsReport';
import { WIX_SITUATION_LABELS, WixSaleRow, WixSaleSituation, WixTreasuryReport } from './wixTreasuryService';

// PDF do relatório de vendas da Tesouraria Wix no mesmo layout dos relatórios do Financeiro
// (reportService.ts): faixa azul com emissor e data, quadro de resumo, tabela listrada e rodapé paginado.

type RGB = [number, number, number];
const PRIMARY: RGB = [30, 64, 175];
const SECONDARY: RGB = [71, 85, 105];
const GREEN: RGB = [22, 163, 74];
const ORANGE: RGB = [234, 88, 12];
const RED: RGB = [220, 38, 38];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '-' : brl.format(cents / 100));
const day = (value: string | null | undefined) => {
  const iso = (value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '-';
};

const SITUATION_COLORS: Partial<Record<WixSaleSituation, RGB>> = {
  resgatado: GREEN, liberado: GREEN, pago: GREEN, disponivel: PRIMARY,
  em_liberacao: ORANGE, aguardando_cliente: ORANGE, conferir: RED,
};

const situationDetail = (row: WixSaleRow) => {
  if (row.situation === 'em_liberacao' && row.availableOn) return `Próxima em ${day(row.availableOn)}`;
  if (row.situation === 'liberado' && row.payoutDate) return `Liberado em ${day(row.payoutDate)}${row.installments && row.installments > 1 ? ` (${row.installments} parcelas)` : ''}`;
  if (row.situation === 'resgatado' && row.payoutDate) return `Resgate em ${day(row.payoutDate)}`;
  return '';
};

const financeLabel = (row: WixSaleRow) => (row.inFinance ? 'Lançado' : row.situation === 'cancelado' || row.situation === 'aguardando_cliente' ? '-' : 'Não lançado');

export const wixReportPdfFileName = (report: WixTreasuryReport) => `Relatorio_Vendas_Wix_${report.period.start}_a_${report.period.end}.pdf`;

export function buildWixReportPDF(report: WixTreasuryReport, summary: WixFundsSummary | null, currentUser: User | null, now = new Date()): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.width || 297;
  const pageHeight = doc.internal.pageSize.height || 210;
  const totals = report.totals;
  const rows = report.rows || [];

  // --- HEADER ---
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Relatório de Vendas Wix', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('SP Contábil - Tesouraria Wix: vendas da loja, liberações e valores a receber', 14, 25);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`PERÍODO: ${day(report.period.start)} a ${day(report.period.end)}`, 14, 34);
  doc.setFontSize(9);
  doc.text(`EMITIDO POR: ${(currentUser?.name || 'Usuário do sistema').toUpperCase()}`, pageWidth - 14, 18, { align: 'right' });
  doc.text(`DATA: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR')}`, pageWidth - 14, 25, { align: 'right' });

  // --- RESUMO FINANCEIRO ---
  doc.setTextColor(50, 50, 50);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 45, pageWidth - 28, 34, 2, 2, 'FD');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Resumo Financeiro:', 20, 53);

  const x = [20, 105, 190];
  const y = 60;
  const column = (col: number, color: RGB, title: string, lines: string[]) => {
    doc.setFontSize(9);
    doc.setTextColor(...color);
    doc.setFont('helvetica', 'bold');
    doc.text(title, x[col], y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    lines.forEach((line, index) => doc.text(line, x[col], y + 5 + index * 4));
  };

  if (totals) {
    column(0, PRIMARY, `VENDIDO: ${money(totals.soldCents)}`, [
      `- Pedidos: ${totals.orders}${totals.canceled ? ` (${totals.canceled} cancelado(s) fora da soma)` : ''}`,
      `- Pago pelos clientes: ${money(totals.paidByCustomersCents)}`,
      `- A receber de clientes: ${money(totals.awaitingCustomersCents)}`,
    ]);
    if (summary) {
      column(1, GREEN, `LIBERADO PELA WIX: ${money(summary.releasedCents)}`, [
        `- Liberado no período (todas as vendas): ${money(summary.releasedInPeriodCents)}`,
        `- Taxas Wix Payments: ${money(totals.feesCents)}`,
        `- Pago fora do Wix Payments: ${money(totals.outsideWixPaymentsCents)}`,
      ]);
      column(2, ORANGE, `A RECEBER DA WIX: ${money(summary.pendingCents)}`, [
        `- A receber hoje (todas as vendas): ${money(summary.pendingAllCents)}`,
        `- Próxima liberação: ${summary.nextRelease ? `${day(summary.nextRelease.date)}, ${money(summary.nextRelease.cents)}` : 'nenhuma'}`,
        `- Sem pedido da loja: ${money(summary.noOrderInPeriodCents)} | Estornos: ${money(summary.reversalsInPeriodCents)}`,
      ]);
    } else {
      column(1, GREEN, `RESGATADO: ${money(totals.withdrawnCents)}`, [
        `- Taxas Wix Payments: ${money(totals.feesCents)}`,
        `- Pago fora do Wix Payments: ${money(totals.outsideWixPaymentsCents)}`,
        ...(report.paymentsEnabled ? [`- Resgates enviados: ${money(totals.payoutsSentCents)} (${(report.payouts || []).filter(payout => payout.status === 'SENT').length})${totals.payoutsFailed ? `, ${totals.payoutsFailed} com falha` : ''}`] : []),
      ]);
      column(2, ORANGE, `A RECEBER DA WIX: ${money(totals.pendingReleaseCents === null || totals.availableCents === null ? null : totals.pendingReleaseCents + totals.availableCents)}`,
        report.paymentsEnabled ? [
          `- Saldo em liberação hoje: ${money(report.balance?.pendingCents)}`,
          `- Disponível para resgate hoje: ${money(report.balance?.availableCents)}`,
        ] : []);
    }
  }

  // --- AVISO ---
  const note = summary
    ? 'Liberações calculadas automaticamente a partir das transações do Wix Pagamentos. Taxas e datas futuras são previstas pelas regras da Wix Brasil: cartão 3,7% + R$ 0,30 com parcelas a cada 30 dias, Pix 0,95% no mesmo dia e boleto R$ 2,99 em poucos dias.'
    : report.paymentsEnabled
      ? 'Situações, saldo e resgates consultados diretamente no Wix Payments.'
      : `Mostrando só as vendas: a Wix não devolveu as transações do Wix Pagamentos para calcular o que já foi liberado e o que falta receber.${report.paymentsError ? ` ${report.paymentsError}` : ''}`;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);
  const noteLines = doc.splitTextToSize(note, pageWidth - 28);
  doc.text(noteLines, 14, 85);
  let yPos = 85 + noteLines.length * 3.5 + 4;

  // --- TABELA ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PRIMARY);
  doc.text(`Pedidos da Loja Wix (${rows.length})`, 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Não lançados no Financeiro: ${totals?.notInFinance ?? 0}`, pageWidth - 14, yPos, { align: 'right' });

  autoTable(doc, {
    startY: yPos + 3,
    head: [['Pedido', 'Data', 'Cliente / Itens', 'Vendido', 'Taxa Wix', 'Líquido Wix', 'Já liberado', 'A liberar', 'Situação', 'Financeiro']],
    body: rows.length ? rows.map(row => [
      row.number ? `#${row.number}` : '-',
      day(row.purchasedDate || row.createdDate),
      [row.buyer, row.items.join(', ')].filter(Boolean).join('\n'),
      money(row.totalCents),
      money(row.feeCents),
      money(row.netCents),
      money(row.releasedCents ?? null),
      money(row.pendingCents ?? null),
      [WIX_SITUATION_LABELS[row.situation], situationDetail(row)].filter(Boolean).join('\n'),
      financeLabel(row),
    ]) : [[{ content: 'Nenhuma venda na loja Wix neste período.', colSpan: 10, styles: { halign: 'center' } }]],
    theme: 'striped',
    margin: { left: 14, right: 14, bottom: 16 },
    rowPageBreak: 'avoid',
    headStyles: { fillColor: SECONDARY, textColor: 255, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
    bodyStyles: { fontSize: 7, textColor: 50, cellPadding: 1.6, valign: 'middle' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center' },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 22, halign: 'right' },
      8: { cellWidth: 38 },
      9: { cellWidth: 20, halign: 'center' },
    },
    didParseCell: (data: any) => {
      if (data.section !== 'body' || !rows.length) return;
      const row = rows[data.row.index];
      if (!row) return;
      if (data.column.index === 6 && row.releasedCents) {
        data.cell.styles.textColor = GREEN;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.column.index === 7 && row.pendingCents) {
        data.cell.styles.textColor = ORANGE;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.column.index === 8 && SITUATION_COLORS[row.situation]) {
        data.cell.styles.textColor = SITUATION_COLORS[row.situation];
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.column.index === 9 && financeLabel(row) === 'Não lançado') {
        data.cell.styles.textColor = ORANGE;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // --- OBSERVAÇÕES FINAIS ---
  const extras: string[] = [];
  const others = report.otherRecords || [];
  if (others.length && totals) {
    extras.push(`Também entraram no saldo Wix Payments ${others.length} movimento(s) sem pedido da loja neste período (faturas Wix, estornos ou ajustes), somando ${money(totals.otherRecordsNetCents)} líquidos.`);
  }
  if (report.truncated) extras.push('O período tem mais registros do que o limite de uma consulta. Reduza o período para ver todos.');
  extras.push('Consulta somente leitura à Wix. Nenhum valor ou lançamento é alterado.');
  yPos = ((doc as any).lastAutoTable?.finalY || yPos) + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  for (const text of extras) {
    const lines = doc.splitTextToSize(text, pageWidth - 28);
    if (yPos + lines.length * 4 > pageHeight - 16) {
      doc.addPage();
      yPos = 18;
    }
    doc.text(lines, 14, yPos);
    yPos += lines.length * 4 + 1;
  }

  // --- RODAPÉ ---
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setDrawColor(200, 200, 200);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
    doc.text('SP Contábil - Relatório de Vendas Wix', 14, pageHeight - 8);
  }

  return doc;
}

export const WixReportPdfService = {
  generatePDF: async (report: WixTreasuryReport, summary: WixFundsSummary | null, currentUser: User | null) => {
    await savePDF(buildWixReportPDF(report, summary, currentUser), wixReportPdfFileName(report));
  },
};
