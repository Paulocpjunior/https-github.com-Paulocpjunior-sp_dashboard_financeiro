import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Transaction, KPIData, User } from '../types';

export const ReportService = {
  
  generatePDF: (
    transactions: Transaction[], 
    kpi: KPIData, 
    filters: { startDate: string; endDate: string; types: string[]; status?: string; bankAccount?: string },
    currentUser: User | null
  ) => {
    try {
      // 1. SAFE DATA PREPARATION
      const safeNum = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const num = parseFloat(String(val).replace(/[^\d.-]/g, ''));
        return isNaN(num) ? 0 : num;
      };

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

      // 2. Initialize Doc
      const doc = new jsPDF({ orientation: 'landscape' });
      
      const pageWidth = doc.internal.pageSize.width || 297;
      const pageHeight = doc.internal.pageSize.height || 210;
      
      const primaryColor = [30, 64, 175]; // Royal Blue
      const secondaryColor = [71, 85, 105]; // Slate
      
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

      // --- FINANCIAL SUMMARY (KPIs) ---
      let yPos = 50;
      doc.setTextColor(50, 50, 50);
      
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(14, 45, pageWidth - 28, 24, 2, 2, 'FD');

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumo Financeiro:', 20, 55);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      
      const kpiXStart = 20;
      const kpiYLine = 62;
      
      // Entradas
      doc.setTextColor(22, 163, 74); // Green
      doc.text(`Entradas: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(kpi.totalReceived))}`, kpiXStart, kpiYLine);
      
      // Saídas
      doc.setTextColor(220, 38, 38); // Red
      doc.text(`Saídas: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(kpi.totalPaid))}`, kpiXStart + 60, kpiYLine);
      
      // Saldo
      if (kpi.balance >= 0) doc.setTextColor(30, 64, 175); // Blue
      else doc.setTextColor(220, 38, 38); // Red
      doc.setFont('helvetica', 'bold');
      doc.text(`Saldo Líquido: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(kpi.balance))}`, kpiXStart + 120, kpiYLine);

      // --- FILTER PARAMETERS CONTEXT ---
      yPos = 76;
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Parâmetros do Relatório:', 14, yPos);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      
      const dateRange = filters.startDate && filters.endDate 
        ? `${formatDate(filters.startDate)} até ${formatDate(filters.endDate)}` 
        : 'Todo o período disponível';
      
      const bankInfo = filters.bankAccount || 'Todas as contas';
      const statusInfo = filters.status || 'Todos os status';
      
      let typesInfo = 'Todos os tipos';
      if (filters.types && filters.types.length > 0) {
          if (filters.types.length > 3) {
              typesInfo = `${filters.types.length} tipos selecionados`;
          } else {
              typesInfo = filters.types.join(', ');
          }
      }

      doc.text(`Período: ${dateRange}`, 14, yPos + 5);
      doc.text(`Conta: ${bankInfo}`, 80, yPos + 5);
      doc.text(`Status: ${statusInfo}`, 130, yPos + 5);
      doc.text(`Tipos: ${typesInfo}`, 180, yPos + 5);

      yPos += 10;

      // --- TABLE ---
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);

      const safeTransactions = Array.isArray(transactions) ? transactions : [];

      const tableBody = safeTransactions.map(t => {
        const dataPagar = formatDate(t.date);
        const dataVencimento = formatDate(t.dueDate);
        const dataBaixa = formatDate(t.paymentDate); // DATA BAIXA / PAGAMENTO (NOVO)
        const conta = safeStr(t.bankAccount);
        const tipo = safeStr(t.type);
        const status = safeStr(t.status);
        // REMOVIDO: const pagoPor = safeStr(t.paidBy || '-'); 
        const favorecido = safeStr(t.client || '-'); 
        
        const valRec = safeNum(t.valueReceived);
        const valPaid = safeNum(t.valuePaid);
        const isEntry = t.movement === 'Entrada' || (valRec > 0 && valPaid === 0);
        
        const valorOriginalRaw = isEntry ? valRec : valPaid;
        const valorOriginalFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorOriginalRaw);

        let valorPagoRaw = 0;
        if (status.toLowerCase() === 'pago') {
            valorPagoRaw = valorOriginalRaw;
        }
        const valorPagoFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorPagoRaw);

        return [
          dataPagar,        // 0
          dataVencimento,   // 1
          dataBaixa,        // 2 (NOVO)
          conta,            // 3
          tipo,             // 4
          status,           // 5 (Era 4)
          valorOriginalFmt, // 6
          valorPagoFmt,     // 7
          favorecido        // 8
        ];
      });

      autoTable(doc, {
          startY: yPos,
          // Atualizado cabeçalho
          head: [['Data', 'Venc.', 'Data Baixa', 'Conta', 'Tipo', 'Status', 'Valor Orig.', 'Valor Pago', 'Favorecido']],
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
              0: { cellWidth: 18, halign: 'center' }, // Data
              1: { cellWidth: 18, halign: 'center' }, // Vencimento
              2: { cellWidth: 18, halign: 'center' }, // Data Baixa (NOVO)
              3: { cellWidth: 25, halign: 'left' },   // Conta
              4: { cellWidth: 35, halign: 'left' },   // Tipo
              5: { cellWidth: 18, halign: 'center' }, // Status (Atualizado index)
              6: { cellWidth: 25, halign: 'right' },  // Valor Orig
              7: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },  // Valor Pago
              8: { cellWidth: 'auto' }                // Favorecido
          },
          didParseCell: (data: any) => {
              // Colorir Status (Agora Index 5)
              if (data.section === 'body' && data.column.index === 5) {
                  const txt = String(data.cell.raw).toLowerCase();
                  if (txt === 'pago') data.cell.styles.textColor = [22, 163, 74];
                  else if (txt === 'pendente') data.cell.styles.textColor = [234, 88, 12];
              }
              // Colorir Valor Pago (Index 7 permanece igual, pois add 1 e removeu 1 antes dele)
              if (data.section === 'body' && data.column.index === 7) {
                  const txt = String(data.cell.raw);
                  if (txt !== '0,00') data.cell.styles.textColor = [30, 64, 175];
                  else data.cell.styles.textColor = [156, 163, 175];
              }
          }
      });

      // --- FOOTER ---
      const pageCount = (doc.internal as any).getNumberOfPages();
      for(let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          doc.setDrawColor(220, 220, 220);
          doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
          doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
          doc.text(`SP Contábil - Relatório de Contas a Pagar/Receber`, 14, pageHeight - 8);
      }

      const fileName = `Relatorio_Financeiro_${new Date().toISOString().slice(0,10)}.pdf`;
      doc.save(fileName);

    } catch (error: any) {
      console.error("Erro CRÍTICO ao gerar PDF:", error);
      alert("Erro ao gerar PDF: " + (error.message || "Verifique o console para detalhes."));
    }
  }
};