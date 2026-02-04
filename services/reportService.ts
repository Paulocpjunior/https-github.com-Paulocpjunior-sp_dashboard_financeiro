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

      const formatDate = (dateStr: string) => {
         try {
             if (!dateStr || dateStr === '1970-01-01') return '-';
             // Correção de fuso horário simples
             const date = new Date(dateStr);
             // Ajuste para exibir a data correta sem voltar 1 dia devido ao UTC
             const userTimezoneOffset = date.getTimezoneOffset() * 60000;
             const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
             return adjustedDate.toLocaleDateString('pt-BR');
         } catch (e) { return dateStr; }
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

      // --- FILTERS SUMMARY ---
      let yPos = 50;
      doc.setTextColor(50, 50, 50);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumo da Análise:', 14, yPos);
      
      // KPI Summary Inline
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const kpiText = `Entradas: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(kpi.totalReceived))}  |  Saídas: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(kpi.totalPaid))}  |  Saldo: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeNum(kpi.balance))}`;
      
      // Colorir o saldo
      if (kpi.balance >= 0) doc.setTextColor(22, 163, 74);
      else doc.setTextColor(220, 38, 38);
      
      doc.text(kpiText, pageWidth - 14, yPos, { align: 'right' });

      yPos += 10;

      // --- TABLE ---
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);

      // Ensure transactions is an array
      const safeTransactions = Array.isArray(transactions) ? transactions : [];

      // Mapeamento EXATO conforme solicitado
      const tableBody = safeTransactions.map(t => {
        
        // 1. Data a Pagar (Data de Lançamento/Agendamento)
        const dataPagar = formatDate(t.date);
        
        // 2. Data Vencimento
        const dataVencimento = formatDate(t.dueDate);
        
        // 3. Movimentação
        const movimentacao = safeStr(t.movement);
        
        // 4. Status
        const status = safeStr(t.status);
        
        // Determinar Valores
        const valRec = safeNum(t.valueReceived);
        const valPaid = safeNum(t.valuePaid);
        const isEntry = movimentacao.toLowerCase().includes('entrada') || (valRec > 0 && valPaid === 0);
        
        // 5. Valor Original (Valor cheio do título)
        // Se for entrada, usa valor recebido/honorarios. Se for saída, usa valor pago.
        const valorOriginalRaw = isEntry ? valRec : valPaid;
        const valorOriginalFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorOriginalRaw);

        // 6. Valor Pago (Efetivamente liquidado)
        // Se status for 'Pago', assume o valor original. Se não, é 0.
        let valorPagoRaw = 0;
        if (status.toLowerCase() === 'pago') {
            valorPagoRaw = valorOriginalRaw;
        }
        const valorPagoFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorPagoRaw);

        // 7. Observação a Pagar (Cliente / Descrição / Pago Por)
        let observacao = safeStr(t.client);
        if (!observacao) observacao = safeStr(t.paidBy);
        if (!observacao) observacao = safeStr(t.type);

        return [
          dataPagar,        // "Data a Pagar"
          dataVencimento,   // "Data Vencimento"
          movimentacao,     // "Movimentação"
          status,           // "Status"
          valorOriginalFmt, // "Valor Original"
          valorPagoFmt,     // "valor Pago"
          observacao        // "Observação a Pagar"
        ];
      });

      // USO CORRETO DO AUTOTABLE COM IMPORT EXPLÍCITO
      autoTable(doc, {
          startY: yPos,
          // CABEÇALHO EXATO SOLICITADO
          head: [['Data a Pagar', 'Data Venc.', 'Movimentação', 'Status', 'Valor Original', 'Valor Pago', 'Observação a Pagar']],
          body: tableBody,
          theme: 'striped',
          headStyles: { 
              fillColor: secondaryColor, 
              textColor: 255, 
              fontStyle: 'bold',
              fontSize: 9,
              halign: 'center'
          },
          bodyStyles: { 
              fontSize: 8, 
              textColor: 50,
              cellPadding: 3
          },
          alternateRowStyles: { 
              fillColor: [245, 247, 250] 
          },
          columnStyles: {
              0: { cellWidth: 25, halign: 'center' }, // Data a Pagar
              1: { cellWidth: 25, halign: 'center' }, // Data Vencimento
              2: { cellWidth: 25, halign: 'center' }, // Movimentação
              3: { cellWidth: 20, halign: 'center' }, // Status
              4: { cellWidth: 30, halign: 'right' },  // Valor Original
              5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },  // Valor Pago
              6: { cellWidth: 'auto' }                // Observação (ocupa o resto)
          },
          didParseCell: (data: any) => {
              // Colorir coluna "Status"
              if (data.section === 'body' && data.column.index === 3) {
                  const txt = String(data.cell.raw).toLowerCase();
                  if (txt === 'pago') data.cell.styles.textColor = [22, 163, 74]; // Verde
                  else if (txt === 'pendente') data.cell.styles.textColor = [234, 88, 12]; // Laranja
              }
              // Colorir coluna "Valor Pago"
              if (data.section === 'body' && data.column.index === 5) {
                  const txt = String(data.cell.raw);
                  if (txt !== '0,00') data.cell.styles.textColor = [30, 64, 175]; // Azul para pago efetivo
                  else data.cell.styles.textColor = [156, 163, 175]; // Cinza para não pago
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

      const fileName = `Relatorio_Contas_${new Date().toISOString().slice(0,10)}.pdf`;
      doc.save(fileName);

    } catch (error: any) {
      console.error("Erro CRÍTICO ao gerar PDF:", error);
      alert("Erro ao gerar PDF: " + (error.message || "Verifique o console para detalhes."));
    }
  }
};