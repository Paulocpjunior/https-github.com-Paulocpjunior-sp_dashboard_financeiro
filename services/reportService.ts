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

      // 2. Initialize Doc
      const doc = new jsPDF();
      
      const pageWidth = doc.internal.pageSize.width || 210;
      const pageHeight = doc.internal.pageSize.height || 297;
      
      const primaryColor: [number, number, number] = [30, 64, 175]; // Royal Blue
      const secondaryColor: [number, number, number] = [71, 85, 105]; // Slate
      
      // --- HEADER ---
      doc.setFillColor(...primaryColor);
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('Relatório Financeiro', 14, 18);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('SP Contábil - Gestão de Fluxo de Caixa', 14, 25);

      const currentDate = new Date().toLocaleDateString('pt-BR');
      const currentTime = new Date().toLocaleTimeString('pt-BR');
      const collaboratorName = currentUser?.name ? currentUser.name.toUpperCase() : 'USUÁRIO DO SISTEMA';

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`EMITIDO POR: ${safeStr(collaboratorName)}`, pageWidth - 14, 18, { align: 'right' });
      doc.text(`DATA: ${currentDate} às ${currentTime}`, pageWidth - 14, 25, { align: 'right' });

      // --- FILTERS SUMMARY ---
      let yPos = 50;
      doc.setTextColor(50, 50, 50);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Parâmetros da Análise:', 14, yPos);
      
      yPos += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      
      const periodStr = filters.startDate && filters.endDate 
        ? `${new Date(filters.startDate).toLocaleDateString('pt-BR')} até ${new Date(filters.endDate).toLocaleDateString('pt-BR')}`
        : 'Todo o período disponível';
      
      doc.text(`• Período: ${periodStr}`, 14, yPos);
      yPos += 5;

      if (filters.bankAccount) {
        doc.text(`• Conta Bancária: ${safeStr(filters.bankAccount)}`, 14, yPos);
        yPos += 5;
      }
      
      if (filters.status) {
        doc.text(`• Status: ${safeStr(filters.status)}`, 14, yPos);
        yPos += 5;
      }

      if (filters.types && Array.isArray(filters.types) && filters.types.length > 0) {
        const typesStr = filters.types.join(', ');
        const displayType = typesStr.length > 80 ? typesStr.substring(0, 80) + '...' : typesStr;
        doc.text(`• Tipos: ${displayType}`, 14, yPos);
        yPos += 5;
      }

      // --- KPI CARDS ---
      yPos += 5;
      const cardWidth = (pageWidth - 28 - 10) / 3;
      const cardHeight = 20;

      const drawCard = (x: number, label: string, value: number, color: [number, number, number]) => {
          doc.setDrawColor(200, 200, 200);
          doc.setFillColor(252, 252, 252);
          doc.roundedRect(x, yPos, cardWidth, cardHeight, 2, 2, 'FD');
          
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(safeStr(label), x + 5, yPos + 7);
          
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...color);
          const valFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(value));
          doc.text(valFormatted, x + 5, yPos + 16);
      };

      drawCard(14, 'Total Entradas', kpi.totalReceived, [22, 163, 74]); // Verde
      drawCard(14 + cardWidth + 5, 'Total Saídas', kpi.totalPaid, [220, 38, 38]); // Vermelho
      drawCard(14 + (cardWidth * 2) + 10, 'Saldo Líquido', kpi.balance, kpi.balance >= 0 ? [37, 99, 235] : [220, 38, 38]); // Azul

      yPos += cardHeight + 15;

      // --- TABLE ---
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Detalhamento dos Lançamentos', 14, yPos);
      yPos += 2;

      // Ensure transactions is an array
      const safeTransactions = Array.isArray(transactions) ? transactions : [];

      const tableBody = safeTransactions.map(t => {
        let dateStr = '-';
        try {
            if (t.date && t.date !== '1970-01-01') {
                dateStr = new Date(t.date).toLocaleDateString('pt-BR');
            }
        } catch (e) {}

        const description = safeStr(t.client || t.paidBy || 'Sem descrição');
        const movement = safeStr(t.movement);
        const type = safeStr(t.type);
        
        const valRec = safeNum(t.valueReceived);
        const valPaid = safeNum(t.valuePaid);
        
        let value = 0;
        let sign = '';
        
        // Lógica de exibição de valor na tabela do PDF
        if (movement.toLowerCase().includes('entrada') || (valRec > 0 && valPaid === 0)) {
            value = valRec;
            sign = '+ ';
        } else {
            value = valPaid;
            sign = '- ';
        }

        const formattedValue = sign + value.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

        return [
          dateStr,
          type,
          description,
          safeStr(t.bankAccount),
          safeStr(t.status),
          formattedValue
        ];
      });

      // Using the imported autoTable function directly
      autoTable(doc, {
        startY: yPos + 3,
        head: [['Data', 'Tipo', 'Descrição / Cliente', 'Conta', 'Status', 'Valor']],
        body: tableBody,
        theme: 'striped',
        headStyles: { 
          fillColor: secondaryColor, 
          textColor: 255, 
          fontStyle: 'bold',
          fontSize: 8 
        },
        bodyStyles: { 
          fontSize: 8, 
          textColor: 50 
        },
        alternateRowStyles: { 
          fillColor: [245, 247, 250] 
        },
        columnStyles: {
          0: { cellWidth: 20 }, 
          1: { cellWidth: 50 }, 
          2: { cellWidth: 'auto' }, 
          3: { cellWidth: 25 }, 
          4: { cellWidth: 20 }, 
          5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' } 
        },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 5) {
            const rawVal = String(data.cell.raw);
            if (rawVal.includes('+')) {
              data.cell.styles.textColor = [22, 163, 74]; // Green
            } else {
              data.cell.styles.textColor = [220, 38, 38]; // Red
            }
          }
        }
      });

      // --- FOOTER ---
      const pageCount = doc.internal.pages.length - 1;
      for(let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          doc.setDrawColor(220, 220, 220);
          doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
          doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
          doc.text(`SP Contábil - Sistema Integrado`, 14, pageHeight - 8);
      }

      const fileName = `Relatorio_Financeiro_${new Date().toISOString().slice(0,10)}.pdf`;
      doc.save(fileName);

    } catch (error: any) {
      console.error("Erro CRÍTICO ao gerar PDF:", error);
      alert("Erro ao gerar PDF: " + (error.message || "Verifique o console para detalhes."));
    }
  }
};