import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Transaction, KPIData, User } from '../types';

export const ReportService = {
  
  generatePDF: (
    transactions: Transaction[], 
    kpi: KPIData, 
    filters: { startDate: string; endDate: string; types: string[] },
    currentUser: User | null
  ) => {
    // Cast to any to resolve issues with plugins and internal API types
    const doc: any = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    
    // --- Header ---
    doc.setFillColor(37, 99, 235); // Blue 600
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('Relatório Financeiro', 14, 20);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, 14, 28);
    doc.text(`Solicitado por: ${currentUser?.name || 'Usuário'}`, 14, 34);

    // --- Filter Summary ---
    let yPos = 50;
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Parâmetros do Relatório:', 14, yPos);
    
    yPos += 7;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const dateRange = filters.startDate && filters.endDate 
      ? `${new Date(filters.startDate).toLocaleDateString('pt-BR')} até ${new Date(filters.endDate).toLocaleDateString('pt-BR')}`
      : 'Todo o período';
    
    doc.text(`Período: ${dateRange}`, 14, yPos);
    
    yPos += 5;
    const typeText = filters.types.length > 0 ? filters.types.join(', ') : 'Todos os tipos';
    // Handle long text wrapping for types
    const splitTypes = doc.splitTextToSize(`Tipos: ${typeText}`, pageWidth - 28);
    doc.text(splitTypes, 14, yPos);
    yPos += (splitTypes.length * 5) + 5;

    // --- Financial Summary Cards (Draw manually) ---
    const cardWidth = (pageWidth - 28 - 10) / 3; // 3 cards with gap
    const cardHeight = 25;
    const cardY = yPos;

    // Helper to draw mini summary card
    const drawCard = (x: number, title: string, value: number, color: [number, number, number]) => {
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(x, cardY, cardWidth, cardHeight, 3, 3, 'FD');
      
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(title, x + 5, cardY + 8);
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...color);
      const valStr = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
      doc.text(valStr, x + 5, cardY + 18);
    };

    drawCard(14, 'Total Entradas', kpi.totalReceived, [22, 163, 74]); // Green
    drawCard(14 + cardWidth + 5, 'Total Saídas', kpi.totalPaid, [220, 38, 38]); // Red
    drawCard(14 + (cardWidth * 2) + 10, 'Saldo Líquido', kpi.balance, kpi.balance >= 0 ? [37, 99, 235] : [220, 38, 38]); // Blue or Red

    yPos = cardY + cardHeight + 15;

    // --- Transactions Table ---
    const tableData = transactions.map(t => [
      new Date(t.date).toLocaleDateString('pt-BR'),
      t.type,
      t.client,
      t.status,
      t.movement === 'Entrada' 
        ? `+ ${t.valueReceived.toFixed(2).replace('.', ',')}` 
        : `- ${t.valuePaid.toFixed(2).replace('.', ',')}`
    ]);

    doc.autoTable({
      startY: yPos,
      head: [['Data', 'Tipo', 'Cliente/Descrição', 'Status', 'Valor']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [71, 85, 105] }, // Slate 600
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 35 },
        4: { halign: 'right', fontStyle: 'bold' }
      },
      didParseCell: (data: any) => {
        // Colorize Value column based on content
        if (data.section === 'body' && data.column.index === 4) {
          const text = data.cell.raw as string;
          if (text.includes('+')) {
            data.cell.styles.textColor = [22, 163, 74];
          } else {
            data.cell.styles.textColor = [220, 38, 38];
          }
        }
      }
    });

    // --- Footer ---
    const pageCount = doc.internal.pages.length - 1;
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - 20, doc.internal.pageSize.height - 10);
        doc.text('CashFlow Pro System', 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`relatorio_financeiro_${new Date().toISOString().split('T')[0]}.pdf`);
  }
};