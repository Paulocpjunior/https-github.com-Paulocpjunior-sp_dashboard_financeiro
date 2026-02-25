

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Transaction, KPIData, User } from '../types';

export const ReportService = {
  
  generatePDF: (
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
    },
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
      doc.text('Transações Detalhadas:', 14, yPos);

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
          'cpfCnpj': 'N.Cliente'
        };
        const sortDirLabel = filters.sortDirection === 'desc' ? 'Decrescente' : 'Crescente';
        infoText += `Ordenado por: ${sortFieldLabels[filters.sortField] || filters.sortField} (${sortDirLabel})`;
      }
      
      if(filters.client) {
          infoText += ` | Filtro: ${filters.client}`;
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(infoText, pageWidth - 14, yPos, { align: 'right' });

      yPos += 5;

      const safeTransactions = Array.isArray(transactions) ? transactions : [];

      // NOVO LAYOUT SOLICITADO
      // Data, Venc., Data Baixa, Movimentação (Coluna F), Status, Valor Orig., Valor Pago, Observação a Pagar (Cliente)
      const tableBody = safeTransactions.map(t => {
        const dataLanc = formatDate(t.date);
        const dataVenc = formatDate(t.dueDate);
        const dataBaixa = formatDate(t.paymentDate);
        const status = safeStr(t.status);
        
        // Movimentação = Exatamente o que está na Coluna F (t.description)
        const movimentacaoDesc = safeStr(t.description);

        // Observação a Pagar = Cliente / Favorecido
        const observacao = safeStr(t.client);
        
        const numeroCliente = safeStr(t.cpfCnpj);
        
        const valRec = safeNum(t.valueReceived);
        const valPaid = safeNum(t.valuePaid);
        const totalCobranca = safeNum(t.totalCobranca);

        const isEntry = t.movement === 'Entrada' || (valRec > 0 && valPaid === 0);
        
        // Valor Original = Valor da conta (previsto)
        let valorOriginalRaw = 0;
        if (isEntry) {
            // Se for entrada e estiver pendente, preferir totalCobranca se disponível
            if ((status.toLowerCase() === 'pendente' || status.toLowerCase() === 'agendado') && totalCobranca > 0) {
                valorOriginalRaw = totalCobranca;
            } else {
                valorOriginalRaw = valRec > 0 ? valRec : totalCobranca;
            }
        } else {
            valorOriginalRaw = valPaid;
        }
        
        const valorOriginalFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorOriginalRaw);

        // Valor Pago = Se Pendente é 0, se Pago é o valor total
        let valorPagoRaw = 0;
        if (status.toLowerCase() === 'pago' || status.toLowerCase() === 'recebido') {
            valorPagoRaw = isEntry ? valRec : valPaid; // Se pago, usa o valor efetivamente pago/recebido
        } else {
            valorPagoRaw = 0; // Se pendente, valor pago é 0
        }
        
        const valorPagoFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valorPagoRaw);

        const observacaoAPagar = safeStr(t.observacaoAPagar);

        const row = [
          dataLanc,          // 0: Data
          dataVenc,          // 1: Vencimento
          dataBaixa,         // 2: Data Baixa
          movimentacaoDesc,  // 3: Movimentação (COLUNA F da Planilha)
          status,            // 4: Status
          valorOriginalFmt,  // 5: Valor Original (Previsto)
          valorPagoFmt,      // 6: Valor Pago (Efetivado)
          observacao,        // 7: Cliente / Favorecido
        ];

        if (filters.movement === 'Entrada') {
          row.push(numeroCliente); // 8: N.Cliente
          row.push(observacaoAPagar); // 9: Observação - A Pagar
        }

        return row;
      });

      autoTable(doc, {
          startY: yPos,
          head: [[
            'Data', 'Venc.', 'Data Baixa', 'Movimentação', 'Status', 'Valor Orig. (Aberto)', 'Valor Pago (Baixado)', 'Cliente / Favorecido',
            ...(filters.movement === 'Entrada' ? ['N.Cliente', 'Observação - A Pagar'] : [])
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
              0: { cellWidth: 16, halign: 'center' }, // Data
              1: { cellWidth: 16, halign: 'center' }, // Venc
              2: { cellWidth: 16, halign: 'center' }, // Baixa
              3: { cellWidth: 35, halign: 'left' },   // Movimentação (Coluna F)
              4: { cellWidth: 18, halign: 'center' }, // Status
              5: { cellWidth: 22, halign: 'right' },  // Valor Orig
              6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }, // Valor Pago
              7: { cellWidth: 'auto' },               // Cliente
              ...(filters.movement === 'Entrada' ? { 8: { cellWidth: 25, halign: 'center' } } : {})
          },
          didParseCell: (data: any) => {
              // Colorir Status (Index 4)
              if (data.section === 'body' && data.column.index === 4) {
                  const txt = String(data.cell.raw).toLowerCase();
                  if (txt === 'pago') data.cell.styles.textColor = [22, 163, 74] as [number, number, number];
                  else if (txt === 'pendente' || txt === 'agendado') {
                      data.cell.styles.textColor = [234, 88, 12] as [number, number, number];
                      data.cell.styles.fontStyle = 'bold';
                  }
              }
              // Colorir Valor Original se Pendente (Index 5)
              if (data.section === 'body' && data.column.index === 5) {
                  const statusRow = data.row.raw[4]; // Coluna Status é indice 4 agora
                  const statusTxt = String(statusRow).toLowerCase();
                  if (statusTxt === 'pendente' || statusTxt === 'agendado') {
                      data.cell.styles.textColor = [234, 88, 12] as [number, number, number]; // Orange
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
