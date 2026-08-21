import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BillingForecastRow, User } from '../types';
import { formatDeliveryChannels } from '../utils/billingForecast';
import { formatISODateBR } from '../utils/dateUtils';

const formatMonth = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1));
};

const formatCurrency = (value: number): string => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(value || 0);

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
const activePDFDownloadUrls = new Set<string>();
let pdfDownloadCleanupRegistered = false;
let pdfDownloadServiceRegistration: Promise<ServiceWorkerRegistration | null> | null = null;

const retainPDFDownloadUrl = (url: string) => {
  activePDFDownloadUrls.add(url);
  if (pdfDownloadCleanupRegistered) return;

  window.addEventListener('pagehide', () => {
    activePDFDownloadUrls.forEach(activeUrl => URL.revokeObjectURL(activeUrl));
    activePDFDownloadUrls.clear();
  }, { once: true });
  pdfDownloadCleanupRegistered = true;
};

const waitForServiceWorkerController = async (registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> => {
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;

  return new Promise(resolve => {
    const timeout = window.setTimeout(() => resolve(registration.active), 5000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.clearTimeout(timeout);
      resolve(navigator.serviceWorker.controller || registration.active);
    }, { once: true });
  });
};

const getPDFDownloadServiceWorker = async (): Promise<ServiceWorker | null> => {
  if (!('serviceWorker' in navigator)) return null;

  if (!pdfDownloadServiceRegistration) {
    pdfDownloadServiceRegistration = navigator.serviceWorker
      .register('/pdf-download-sw.js', { scope: '/', updateViaCache: 'none' })
      .then(async registration => {
        await navigator.serviceWorker.ready;
        return registration;
      })
      .catch(() => null);
  }

  const registration = await pdfDownloadServiceRegistration;
  if (!registration) return null;
  return waitForServiceWorkerController(registration);
};

const downloadPDFThroughServiceWorker = async (file: File): Promise<boolean> => {
  const worker = await getPDFDownloadServiceWorker();
  if (!worker || !navigator.serviceWorker.controller) return false;

  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bytes = await file.arrayBuffer();
  const stored = new Promise<boolean>(resolve => {
    const timeout = window.setTimeout(() => resolve(false), 10000);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'PDF_STORED' || event.data?.token !== token) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(true);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
  });

  worker.postMessage({ type: 'STORE_PDF', token, fileName: file.name, bytes }, [bytes]);
  if (!await stored) return false;

  const link = document.createElement('a');
  link.href = `/__pdf_download__/${encodeURIComponent(token)}`;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
};

const isSafariBrowser = (): boolean => /Safari/i.test(navigator.userAgent) && !/(Chrome|CriOS|Edg|OPR)/i.test(navigator.userAgent);

export const buildBillingForecastPDF = (rows: BillingForecastRow[], currentUser: User | null): jsPDF => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.width || 297;
    const targetMonth = rows[0]?.targetMonth || '';
    const referenceMonth = rows[0]?.referenceMonth || '';
    const total = rows.reduce((sum, row) => sum + row.referenceAmount, 0);
    const ready = rows.filter(row => row.missingFields.length === 0).length;

    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, pageWidth, 38, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Base de Faturamento do Próximo Mês', 14, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Competência a faturar: ${formatMonth(targetMonth)} | Base financeira: ${formatMonth(referenceMonth)}`, 14, 24);
    doc.text('Documento preparatório: não emite boleto, fatura nem cobrança automaticamente.', 14, 31);
    doc.setFont('helvetica', 'bold');
    doc.text(`Emitido por: ${(currentUser?.name || 'Usuário do sistema').toUpperCase()}`, pageWidth - 14, 17, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(new Date().toLocaleString('pt-BR'), pageWidth - 14, 25, { align: 'right' });

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`Empresas: ${rows.length}`, 14, 48);
    doc.text(`Cadastros completos: ${ready}`, 65, 48);
    doc.text(`Pendências cadastrais: ${rows.length - ready}`, 130, 48);
    doc.text(`Total de referência: ${formatCurrency(total)}`, pageWidth - 14, 48, { align: 'right' });

    autoTable(doc, {
      startY: 54,
      margin: { left: 8, right: 8 },
      head: [[
        'Grupo', 'Empresa / CNPJ', 'N.Cli.', 'Base financeira', 'Como cobrar',
        'Emitir em', 'Vencimento', 'Meio de envio / destino', 'Orientações', 'Situação',
      ]],
      body: rows.map(row => {
        const destinations = [
          formatDeliveryChannels(row.deliveryChannels),
          row.billingEmail,
          row.whatsapp,
          row.printedDeliveryDetails,
        ].filter(Boolean).join(' | ');
        return [
          row.groupName,
          [row.client, row.cpfCnpj].filter(Boolean).join('\n'),
          row.clientNumber || '-',
          `${formatCurrency(row.referenceAmount)}\n${row.referenceCount ? `${row.referenceCount} cobrança(s)` : 'Sem referência no mês'}`,
          row.billingMethod || 'Não cadastrado',
          formatISODateBR(row.issueDate) || '-',
          formatISODateBR(row.dueDate) || '-',
          destinations || 'Não cadastrado',
          row.billingInstructions || '-',
          row.missingFields.length ? `Pendente: ${row.missingFields.join(', ')}` : 'Pronto',
        ];
      }),
      theme: 'striped',
      styles: { minCellWidth: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 6.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 6.2, textColor: [30, 41, 59], cellPadding: 1.2, valign: 'middle' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 23 },
        1: { cellWidth: 40 },
        2: { cellWidth: 11, halign: 'center' },
        3: { cellWidth: 24, halign: 'right' },
        4: { cellWidth: 24 },
        5: { cellWidth: 17, halign: 'center' },
        6: { cellWidth: 17, halign: 'center' },
        7: { cellWidth: 40 },
        8: { cellWidth: 40 },
        9: { cellWidth: 32 },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 9) {
          const readyCell = String(data.cell.raw) === 'Pronto';
          data.cell.styles.textColor = readyCell ? [5, 150, 105] : [217, 119, 6];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`Página ${page} de ${pages}`, pageWidth - 10, doc.internal.pageSize.height - 6, { align: 'right' });
    }

    return doc;
};

export const createBillingForecastPDFFile = (rows: BillingForecastRow[], currentUser: User | null): File => {
  const doc = buildBillingForecastPDF(rows, currentUser);
  const pdfArrayBuffer = doc.output('arraybuffer');
  const header = new TextDecoder().decode(new Uint8Array(pdfArrayBuffer).slice(0, 5));
  if (header !== '%PDF-') {
    throw new Error('O conteúdo gerado não é um PDF válido.');
  }

  const targetMonth = rows[0]?.targetMonth || new Date().toISOString().slice(0, 7);
  return new File([pdfArrayBuffer], `base-faturamento-${targetMonth}.pdf`, { type: 'application/pdf' });
};

const downloadPDF = async (file: File) => {
  const saveFilePicker = (window as any).showSaveFilePicker;
  if (typeof saveFilePicker === 'function') {
    const handle = await saveFilePicker({
      suggestedName: file.name,
      types: [{
        description: 'Documento PDF',
        accept: { 'application/pdf': ['.pdf'] },
      }],
    });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return;
  }

  if (await downloadPDFThroughServiceWorker(file)) return;

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.type = 'application/pdf';
  link.rel = 'noopener';
  if (isSafariBrowser()) {
    // Ultimo recurso: abre o PDF nativo em vez de criar outra pasta .pdf.download incompleta.
    link.target = '_blank';
  } else {
    link.download = file.name;
  }
  document.body.appendChild(link);
  // Safari mantem o download em uma pasta .download enquanto ainda consome o Blob.
  // O URL precisa continuar valido ate a pagina ser encerrada para nao interromper PDFs maiores.
  retainPDFDownloadUrl(url);
  link.click();
  link.remove();
};

export const BillingReportService = {
  generatePDF: async (rows: BillingForecastRow[], currentUser: User | null) => {
    const file = createBillingForecastPDFFile(rows, currentUser);
    await downloadPDF(file);
    return file.name;
  },

  exportCSV: (rows: BillingForecastRow[]) => {
    const headers = [
      'Grupo econômico', 'Empresa', 'CPF/CNPJ', 'N.Cliente', 'Competência base', 'Competência a faturar',
      'Honorários base', 'Extras base', 'Total de referência', 'Método de cobrança', 'Data de emissão',
      'Data de vencimento', 'Meios de envio', 'E-mail', 'WhatsApp', 'Entrega física', 'Orientações', 'Pendências',
    ];
    const lines = rows.map(row => [
      row.groupName, row.client, row.cpfCnpj, row.clientNumber, row.referenceMonth, row.targetMonth,
      row.honorarios.toFixed(2).replace('.', ','), row.extras.toFixed(2).replace('.', ','),
      row.referenceAmount.toFixed(2).replace('.', ','), row.billingMethod, row.issueDate, row.dueDate,
      formatDeliveryChannels(row.deliveryChannels), row.billingEmail, row.whatsapp, row.printedDeliveryDetails,
      row.billingInstructions, row.missingFields.join(', '),
    ].map(csvCell).join(';'));
    const csv = `\ufeff${headers.map(csvCell).join(';')}\n${lines.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `base-faturamento-${rows[0]?.targetMonth || new Date().toISOString().slice(0, 7)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
