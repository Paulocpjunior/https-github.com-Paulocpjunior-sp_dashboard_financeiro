import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Transaction, KPIData, User } from '../types';

export const ReportService = {
  
  generatePDF: (
    transactions: Transaction[], 
    kpi: KPIData, 
    filters: { startDate: string; endDate: string; types: string[]; status?: string; bankAccount?: string },
    currentUser: User | null
  ) => {
    try {
      // Inicializa o documento
      const doc: any = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      
      // Cores da Identidade Visual (Royal Blue)
      const primaryColor = [30, 64, 175]; // Royal Blue 800
      const secondaryColor = [71, 85, 105]; // Slate 600
      
      // --- 1. CABEÇALHO (Header) ---
      // Fundo Azul
      doc.setFillColor(...primaryColor);
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      // Título
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('Relatório Financeiro', 14, 18);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('SP Contábil - Gestão de Fluxo de Caixa', 14, 25);

      // --- DADOS DO COLABORADOR E DATA (Solicitado) ---
      const currentDate = new Date().toLocaleDateString('pt-BR');
      const currentTime = new Date().toLocaleTimeString('pt-BR');
      const collaboratorName = currentUser?.name ? currentUser.name.toUpperCase() : 'USUÁRIO DO SISTEMA';

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      
      // Alinhado à direita no cabeçalho azul
      doc.text(`EMITIDO POR: ${collaboratorName}`, pageWidth - 14, 18, { align: 'right' });
      doc.text(`DATA: ${currentDate} às ${currentTime}`, pageWidth - 14, 25, { align: 'right' });

      // --- 2. RESUMO DOS FILTROS ---
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
        doc.text(`• Conta Bancária: ${filters.bankAccount}`, 14, yPos);
        yPos += 5;
      }
      
      if (filters.status) {
        doc.text(`• Status: ${filters.status}`, 14, yPos);
        yPos += 5;
      }

      // --- 3. CARDS DE RESUMO (KPIs) ---
      yPos += 5;
      const cardWidth = (pageWidth - 28 - 10) / 3;
      const cardHeight = 20;

      const drawCard = (x: number, label: string, value: number, color: [number, number, number]) => {
          doc.setDrawColor(200, 200, 200);
          doc.setFillColor(252, 252, 252);
          doc.roundedRect(x, yPos, cardWidth, cardHeight, 2, 2, 'FD');
          
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(label, x + 5, yPos + 7);
          
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...color);
          const valFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
          doc.text(valFormatted, x + 5, yPos + 16);
      };

      drawCard(14, 'Total Entradas', kpi.totalReceived, [22, 163, 74]); // Verde
      drawCard(14 + cardWidth + 5, 'Total Saídas', kpi.totalPaid, [220, 38, 38]); // Vermelho
      drawCard(14 + (cardWidth * 2) + 10, 'Saldo Líquido', kpi.balance, kpi.balance >= 0 ? [37, 99, 235] : [220, 38, 38]); // Azul ou Vermelho

      yPos += cardHeight + 15;

      // --- 4. TABELA DE ITENS LANÇADOS ---
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Detalhamento dos Lançamentos', 14, yPos);
      yPos += 2;

      const tableBody = transactions.map(t => {
        const dateStr = new Date(t.date).toLocaleDateString('pt-BR');
        // Define a descrição (Cliente ou quem pagou)
        const description = t.client || t.paidBy || 'Sem descrição';
        // Formata valor
        const isEntrada = t.movement === 'Entrada';
        const value = isEntrada ? t.valueReceived : t.valuePaid;
        const sign = isEntrada ? '+ ' : '- ';
        const formattedValue = sign + value.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

        return [
          dateStr,
          t.type || '-',
          description,
          t.bankAccount || '-',
          t.status || '-',
          formattedValue
        ];
      });

      doc.autoTable({
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
          0: { cellWidth: 20 }, // Data
          1: { cellWidth: 35 }, // Tipo
          2: { cellWidth: 'auto' }, // Descrição (Expande)
          3: { cellWidth: 25 }, // Conta
          4: { cellWidth: 20 }, // Status
          5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' } // Valor
        },
        didParseCell: (data: any) => {
          // Colorir a coluna de valor
          if (data.section === 'body' && data.column.index === 5) {
            const rawVal = data.cell.raw as string;
            if (rawVal.startsWith('+')) {
              data.cell.styles.textColor = [22, 163, 74]; // Verde
            } else {
              data.cell.styles.textColor = [220, 38, 38]; // Vermelho
            }
          }
        }
      });

      // --- 5. RODAPÉ ---
      const pageCount = doc.internal.pages.length - 1;
      for(let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          
          // Linha divisória
          doc.setDrawColor(220, 220, 220);
          doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
          
          doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
          doc.text(`SP Contábil - Sistema Integrado`, 14, pageHeight - 8);
      }

      // Salvar arquivo
      const fileName = `Relatorio_Financeiro_${new Date().toISOString().slice(0,10)}.pdf`;
      doc.save(fileName);

    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Houve um erro ao gerar o PDF. Verifique os dados e tente novamente.");
    }
  }
};
