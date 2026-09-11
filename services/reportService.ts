

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Transaction, User } from '../types';
import { logger } from '../utils/logger';
import { getOriginalAmount, getPaidAmount, getOutstandingAmount, isPaidStatus, isWixInvoice, parseMoneyValue } from '../utils/transactionAmounts';
import { formatExtraChargeDescription } from '../utils/extraCharges';
import { getPaymentMethod } from '../utils/paymentMethod';
import { savePDF } from '../utils/pdfDownload';

export const ReportService = {
  
  generatePDF: async (
    transactions: Transaction[], 
    kpi: any,
    filters: { 
        startDate: string; 
        endDate: string; 
        types: string[]; 
        status?: string; 
        bankAccount?: string; 
        dateContext?: string; 
        movement?: string; 
        sortField?: string; 
        sortDirection?: string;
        client?: string; // Novo Campo: Cliente
        extraChargesOnly?: boolean;
        wixInvoicesOnly?: boolean;
    },
    currentUser: User | null
  ) => {
    try {
      const safeNum = (val: any) => parseMoneyValue(val);

      const safeStr = (val: any) => val ? String(val) : '';

      const formatDate = (dateStr: string | undefined) => {
         try {
             if (!dateStr || dateStr === '1970-01-01') return '-';
             const date = new Date(dateStr);
             const userTimezoneOffset = date.getTimezoneOffset() * 60000;
             const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
             return adjustedDate.toLocaleDateString('pt-BR');
         } catch (e) { return dateStr || '-'; }
      };

      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.width || 297;
      const pageHeight = doc.internal.pageSize.height || 210;
      const primaryColor: [number, number, number] = [30, 64, 175];
      const secondaryColor: [number, number, number] = [71, 85, 105];
      
      // --- HEADER ---
      doc.setFillColor(...primaryColor);
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('Relatório Financeiro Detalhado', 14, 18);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('SP Contábil - Controle de Contas e Movimentações', 14, 25);

      const currentDate = new Date().toLocaleDateString('pt-BR');
      const currentTime = new Date().toLocaleTimeString('pt-BR');
      const collaboratorName = currentUser?.name ? currentUser.name.toUpperCase() : 'USUÁRIO DO SISTEMA';

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`EMITIDO POR: ${safeStr(collaboratorName)}`, pageWidth - 14, 18, { align: 'right' });
      doc.text(`DATA: ${currentDate} às ${currentTime}`, pageWidth - 14, 25, { align: 'right' });

      // --- CONTEXTO DO RELATÓRIO (CLIENTE) ---
      // Se houver filtro de cliente, mostramos em destaque no header azul
      if (filters.client) {
          doc.setFontSize(11);
          doc.setTextColor(255, 255, 0); // Amarelo para destaque
          doc.text(`CLIENTE / FAVORECIDO: ${filters.client.toUpperCase()}`, 14, 34);
      }

      // --- FINANCIAL SUMMARY ---
      let yPos = 50;
      doc.setTextColor(50, 50, 50);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(14, 45, pageWidth - 28, 28, 2, 2, 'FD');

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumo Financeiro:', 20, 55);
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      
      const kpiXStart = 20;
      const kpiYLine = 62;
      const colGap = 85;

      const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(v));
      const fmtNumber = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNum(v));
      
      // 1. Entradas
      doc.setTextColor(22, 163, 74);
      doc.setFont('helvetica', 'bold');
      doc.text(`ENTRADAS PREVISTAS: ${fmt(kpi.totalReceived)}`, kpiXStart, kpiYLine);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`- Já Recebido: ${fmt(kpi.settledReceivables)}`, kpiXStart, kpiYLine + 5);
      doc.text(`- Pendente: ${fmt(kpi.pendingReceivables)}`, kpiXStart, kpiYLine + 9);
      
      // 2. Saídas
      doc.setFontSize(9);
      doc.setTextColor(220, 38, 38);
      doc.setFont('helvetica', 'bold');
      doc.text(`SAÍDAS PREVISTAS: ${fmt(kpi.totalPaid)}`, kpiXStart + colGap, kpiYLine);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`- Já Pago: ${fmt(kpi.settledPayables)}`, kpiXStart + colGap, kpiYLine + 5);
      doc.setTextColor(234, 88, 12);
      doc.setFont('helvetica', 'bold');
      doc.text(`- A PAGAR (PENDENTE): ${fmt(kpi.pendingPayables)}`, kpiXStart + colGap, kpiYLine + 9);
      
      // 3. Saldo
      doc.setFontSize(12);
      if (kpi.balance >= 0) doc.setTextColor(30, 64, 175);
      else doc.setTextColor(220, 38, 38);
      doc.setFont('helvetica', 'bold');
      doc.text(`Saldo Previsto: ${fmt(kpi.balance)}`, kpiXStart + (colGap * 2), kpiYLine + 5);

      yPos = 80;
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const isEntradaHeader = filters.movement === 'Entrada' || (filters.types && filters.types.includes('Entrada de Caixa / Contas a Receber'));
      const isSaidaHeader = filters.movement === 'Saída' || (filters.types && filters.types.includes('Saída de Caixa / Contas a Pagar'));
      const showExtraChargeDescription = isEntradaHeader && Boolean(filters.extraChargesOnly);
      const safeTransactions = Array.isArray(transactions) ? transactions : [];
      const shouldSeparateWix = !isSaidaHeader;
      const wixTransactions = shouldSeparateWix ? safeTransactions.filter(isWixInvoice) : [];
      const detailTransactions = shouldSeparateWix ? safeTransactions.filter(t => !isWixInvoice(t)) : safeTransactions;
      const compactTableHeadFontSize = 6.6;
      const compactTableBodyFontSize = 6.3;
      const compactTableCellPadding = 0.75;

      // Sort info label
      let infoText = "";
      if (filters.sortField) {
        const sortFieldLabels: Record<string, string> = {
          'date': 'Data de Lançamento',
          'dueDate': 'Data de Vencimento',
          'paymentDate': 'Data de Pagamento/Baixa',
          'valorOriginal': 'Valor Original',
          'valorPago': 'Valor Pago',
          'status': 'Status',
          'client': 'Cliente / Observação',
          'clientNumber': 'N.Cliente'
        };
        const sortDirLabel = filters.sortDirection === 'desc' ? 'Decrescente' : 'Crescente';
        infoText += `Ordenado por: ${sortFieldLabels[filters.sortField] || filters.sortField} (${sortDirLabel})`;
      }
      
      if(filters.client) {
          infoText += ` | Filtro: ${filters.client}`;
      }
      if (filters.wixInvoicesOnly) {
          infoText += `${infoText ? ' | ' : ''}Filtro: somente Faturas Wix`;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const calcDelay = (transaction: Transaction) => {
        if (isPaidStatus(transaction.status)) return '-';
        if (!transaction.dueDate || transaction.dueDate === '1970-01-01') return '-';
        const [year, month, day] = transaction.dueDate.split('-').map(Number);
        if (!year || !month || !day) return '-';
        const due = new Date(year, month - 1, day);
        due.setHours(0, 0, 0, 0);
        if (due.getTime() >= today.getTime()) return '-';
        return `${Math.ceil((today.getTime() - due.getTime()) / 86400000)}d`;
      };

      const compactBody = (rows: Transaction[]) => rows.map(t => [
        showExtraChargeDescription ? formatExtraChargeDescription(t.cobrancaExtra) : formatDate(t.date),
        formatDate(t.dueDate),
        formatDate(t.paymentDate),
        calcDelay(t),
        safeStr(t.client),
        safeStr(t.clientNumber),
        safeStr(t.cpfCnpj),
        safeStr(t.status),
        fmtNumber(safeNum(t.honorarios)),
        fmtNumber(safeNum(t.valorExtra)),
        fmtNumber(getOriginalAmount(t)),
        fmtNumber(getPaidAmount(t)),
        fmtNumber(getOutstandingAmount(t)),
        getPaymentMethod(t) || '-',
      ]);

      const renderCompactReceivablesTable = (title: string, rows: Transaction[], startY: number, highlightedTitle = false) => {
        let titleY = startY;
        if (titleY > pageHeight - 28) {
          doc.addPage();
          titleY = 18;
        }

        if (highlightedTitle) {
          doc.setFillColor(254, 240, 138);
          doc.rect(14, titleY - 3.6, 34, 5.2, 'F');
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(30, 64, 175);
        doc.text(title, 14, titleY);

        autoTable(doc, {
          startY: titleY + 3,
          head: [[
            showExtraChargeDescription ? 'Cobrança Extra' : 'Lanç.', 'Venc.', 'Receb.', 'Atraso', 'Cliente', 'N.Cli.', 'CPF/CNPJ', 'Status',
            'Honor.', 'Extras', 'Total', 'Recebido', 'Saldo', 'Modo de cobrança'
          ]],
          body: compactBody(rows),
          theme: 'striped',
          margin: { left: 14, right: 14 },
          headStyles: {
            fillColor: secondaryColor,
            textColor: highlightedTitle ? [254, 240, 138] : 255,
            fontStyle: 'bold',
            fontSize: compactTableHeadFontSize,
            halign: 'center',
            cellPadding: compactTableCellPadding
          },
          bodyStyles: {
            fontSize: compactTableBodyFontSize,
            textColor: 50,
            cellPadding: compactTableCellPadding,
            lineWidth: 0
          },
          alternateRowStyles: {
            fillColor: [245, 247, 250]
          },
          columnStyles: {
            0: { cellWidth: showExtraChargeDescription ? 24 : 14, halign: showExtraChargeDescription ? 'left' : 'center' },
            1: { cellWidth: 14, halign: 'center' },
            2: { cellWidth: 14, halign: 'center' },
            3: { cellWidth: 10, halign: 'center' },
            4: { cellWidth: 'auto' },
            5: { cellWidth: 12, halign: 'center' },
            6: { cellWidth: 22, halign: 'center' },
            7: { cellWidth: 16, halign: 'center' },
            8: { cellWidth: 15, halign: 'right' },
            9: { cellWidth: 15, halign: 'right' },
            10: { cellWidth: 16, halign: 'right' },
            11: { cellWidth: 17, halign: 'right' },
            12: { cellWidth: 16, halign: 'right' },
            13: { cellWidth: 28, halign: 'left' },
          },
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 3) {
              const txt = String(data.cell.raw).toLowerCase();
              if (txt.endsWith('d')) {
                data.cell.styles.textColor = [220, 38, 38] as [number, number, number];
                data.cell.styles.fontStyle = 'bold';
              }
            }

            if (data.section === 'body' && data.column.index === 7) {
              const txt = String(data.cell.raw).toLowerCase();
              if (isPaidStatus(txt)) data.cell.styles.textColor = [22, 163, 74] as [number, number, number];
              else {
                data.cell.styles.textColor = [234, 88, 12] as [number, number, number];
                data.cell.styles.fontStyle = 'bold';
              }
            }

            if (data.section === 'body' && data.column.index === 10) {
              data.cell.styles.textColor = [37, 99, 235] as [number, number, number];
              data.cell.styles.fontStyle = 'bold';
            }

            if (data.section === 'body' && data.column.index === 11) {
              data.cell.styles.textColor = [22, 163, 74] as [number, number, number];
              data.cell.styles.fontStyle = 'bold';
            }

            if (data.section === 'body' && data.column.index === 12) {
              data.cell.styles.textColor = [234, 88, 12] as [number, number, number];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        });
      };

      if (isEntradaHeader) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(infoText, pageWidth - 14, yPos, { align: 'right' });

        if (!filters.wixInvoicesOnly) {
          renderCompactReceivablesTable(`Contas a Receber (${detailTransactions.length})`, detailTransactions, yPos, false);
        }

        if (wixTransactions.length > 0) {
          const wixStartY = filters.wixInvoicesOnly ? yPos : ((doc as any).lastAutoTable?.finalY || yPos) + 8;
          renderCompactReceivablesTable(`Faturas Wix (${wixTransactions.length})`, wixTransactions, wixStartY, true);
        }
      } else {
        const sectionTitle = isSaidaHeader
          ? `Contas a Pagar (${detailTransactions.length})`
          : 'Transações Detalhadas:';
        doc.text(sectionTitle, 14, yPos);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(infoText, pageWidth - 14, yPos, { align: 'right' });

        yPos += 5;

        const tableBody = detailTransactions.map(t => {
          const dataLanc = formatDate(t.date);
          const dataVenc = formatDate(t.dueDate);
          const dataBaixa = formatDate(t.paymentDate);
          const status = safeStr(t.status);
          const movimentacaoDesc = safeStr(t.description);
          const observacao = safeStr(t.client);
          const valorOriginalFmt = fmtNumber(getOriginalAmount(t));
          const valorPagoFmt = fmtNumber(getPaidAmount(t));
          const observacaoAPagar = safeStr(t.observacaoAPagar);

          const row = [
            dataLanc,
            dataVenc,
            dataBaixa,
            movimentacaoDesc,
            status,
            valorOriginalFmt,
            valorPagoFmt,
            observacao,
          ];

          if (isSaidaHeader) {
            row.push(observacaoAPagar);
          }

          return row;
        });

        autoTable(doc, {
          startY: yPos,
          head: [[
            'Data', 'Venc.', 'Data Baixa', 'Movimentação', 'Status', 'Valor Orig. (Aberto)', 'Valor Pago (Baixado)', 'Cliente / Favorecido',
            ...(isSaidaHeader ? ['Observação - A Pagar'] : [])
          ]],
          body: tableBody,
          theme: 'striped',
          headStyles: {
            fillColor: secondaryColor,
            textColor: 255,
            fontStyle: 'bold',
            fontSize: 8,
            halign: 'center'
          },
          bodyStyles: {
            fontSize: 7,
            textColor: 50,
            cellPadding: 2
          },
          alternateRowStyles: {
            fillColor: [245, 247, 250]
          },
          columnStyles: {
            0: { cellWidth: 16, halign: 'center' },
            1: { cellWidth: 16, halign: 'center' },
            2: { cellWidth: 16, halign: 'center' },
            3: { cellWidth: 35, halign: 'left' },
            4: { cellWidth: 18, halign: 'center' },
            5: { cellWidth: 22, halign: 'right' },
            6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
            7: { cellWidth: 'auto' },
          },
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 4) {
              const txt = String(data.cell.raw).toLowerCase();
              if (isPaidStatus(txt)) data.cell.styles.textColor = [22, 163, 74] as [number, number, number];
              else if (txt === 'pendente' || txt === 'agendado' || txt === 'vencida') {
                data.cell.styles.textColor = [234, 88, 12] as [number, number, number];
                data.cell.styles.fontStyle = 'bold';
              }
            }

            if (data.section === 'body' && data.column.index === 5) {
              const statusRow = data.row.raw[4];
              const statusTxt = String(statusRow).toLowerCase();
              if (statusTxt === 'pendente' || statusTxt === 'agendado' || statusTxt === 'vencida') {
                data.cell.styles.textColor = [234, 88, 12] as [number, number, number];
                data.cell.styles.fontStyle = 'bold';
              }
            }
          }
        });

        if (wixTransactions.length > 0) {
          const wixStartY = ((doc as any).lastAutoTable?.finalY || yPos) + 8;
          renderCompactReceivablesTable(`Faturas Wix (${wixTransactions.length})`, wixTransactions, wixStartY, true);
        }
      }

      const pageCount = (doc.internal as any).getNumberOfPages();
      for(let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
          doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
          doc.text(`SP Contábil - Relatório de Contas a Pagar/Receber`, 14, pageHeight - 8);
      }

      const fileName = `Relatorio_Financeiro_${new Date().toISOString().slice(0,10)}.pdf`;
      await savePDF(doc, fileName);

    } catch (error: any) {
      logger.error("Erro ao gerar PDF:", error);
      alert("Erro ao gerar PDF: " + error.message);
    }
  }
};
