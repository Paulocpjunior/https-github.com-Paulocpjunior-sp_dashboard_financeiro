import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Transaction, KPIData, User } from '../types';

export const ReportService = {
  
  generatePDF: (
    transactions: Transaction[], 
    kpi: any,
    filters: { startDate: string; endDate: string; types: string[]; status?: string; bankAccount?: string; dateContext?: string; movement?: string },
    currentUser: User | null
  ) => {
    try {
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

      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.width || 297;
      const pageHeight = doc.internal.pageSize.height || 210;
      const primaryColor = [30, 64, 175];
      const secondaryColor = [71, 85, 105];
      
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
      doc.text('Transações:', 14, yPos);
      yPos += 5;

      const safeTransactions = Array.isArray(transactions) ? transactions : [];

      // NOVO LAYOUT SIMPLIFICADO
      // Colunas: Data, Venc., Status, Valor Original, Valor Pago, Observação (Cliente)
      const tableBody = safeTransactions.map(t => {
        const dataPagar = formatDate(t.date);
        const dataVencimento = formatDate(t.dueDate);
        const status = safeStr(t.status);
        
        // Observação limpa: Apenas Cliente/Favorecido, removendo tipo repetitivo
        const observacao = safeStr(t.client);
        
        const valRec = safeNum(t.valueReceived);
        const valPaid = safeNum(t.valuePaid);
        const isEntry = t.movement === 'Entrada' || (valRec > 0 && valPaid === 0);
        
        const valorOriginalRaw = isEntry ? valRec : valPaid;
        const valorOriginalFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorOriginalRaw);

        // Valor Pago: Se for pendente, mostra zerado na coluna "Pago" para evidenciar que falta pagar
        let valorPagoRaw = 0;
        if (status.toLowerCase() === 'pago') {
            valorPagoRaw = valorOriginalRaw;
        }
        const valorPagoFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorPagoRaw);

        return [
          dataPagar,        // 0
          dataVencimento,   // 1
          status,           // 2
          valorOriginalFmt, // 3 (Valor Previsto)
          valorPagoFmt,     // 4 (Valor Executado)
          observacao        // 5 (Observação/Cliente)
        ];
      });

      autoTable(doc, {
          startY: yPos,
          head: [['Data', 'Venc.', 'Status', 'Valor Original', 'Valor Pago', 'Observação']],
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
              cellPadding: 3
          },
          alternateRowStyles: { 
              fillColor: [245, 247, 250] 
          },
          columnStyles: {
              0: { cellWidth: 20, halign: 'center' }, // Data
              1: { cellWidth: 20, halign: 'center' }, // Vencimento
              2: { cellWidth: 25, halign: 'center' }, // Status
              3: { cellWidth: 30, halign: 'right' },  // Valor Orig
              4: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },  // Valor Pago
              5: { cellWidth: 'auto' }                // Observação
          },
          didParseCell: (data: any) => {
              // Colorir Status (Index 2)
              if (data.section === 'body' && data.column.index === 2) {
                  const txt = String(data.cell.raw).toLowerCase();
                  if (txt === 'pago') data.cell.styles.textColor = [22, 163, 74];
                  else if (txt === 'pendente' || txt === 'agendado') {
                      data.cell.styles.textColor = [234, 88, 12];
                      data.cell.styles.fontStyle = 'bold';
                  }
              }
              // Colorir Valor Original se Pendente (Index 3)
              if (data.section === 'body' && data.column.index === 3) {
                  const statusRow = data.row.raw[2]; 
                  const statusTxt = String(statusRow).toLowerCase();
                  if (statusTxt === 'pendente' || statusTxt === 'agendado') {
                      data.cell.styles.textColor = [234, 88, 12]; // Orange para destacar o que falta pagar
                      data.cell.styles.fontStyle = 'bold';
                  }
              }
          }
      });

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
      doc.save(fileName);

    } catch (error: any) {
      console.error("Erro ao gerar PDF:", error);
      alert("Erro ao gerar PDF: " + error.message);
    }
  }
};