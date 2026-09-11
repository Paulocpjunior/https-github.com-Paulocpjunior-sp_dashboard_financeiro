import { jsPDF } from 'jspdf';

const PDF_DOWNLOAD_SERVICE_URL = 'https://sp-pdf-download-291088837584.us-central1.run.app';
const SAFARI_NATIVE_DOWNLOAD_LIMIT = 500 * 1024;

export interface PreparedPDFDownload {
  download: () => void;
  expiresAt: number;
  dispose?: () => void;
}

const isSafari = (): boolean => {
  const userAgent = navigator.userAgent;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Android/i.test(userAgent);
};

export const warmPDFDownloadService = (): void => {
  if (!isSafari()) return;
  void fetch(`${PDF_DOWNLOAD_SERVICE_URL}/api/pdf-download/health`, { cache: 'no-store' }).catch(() => undefined);
};

export const preparePDFDownload = async (doc: jsPDF, fileName: string): Promise<PreparedPDFDownload> => {
  if (!isSafari()) {
    return { download: () => doc.save(fileName), expiresAt: Number.POSITIVE_INFINITY };
  }

  const pdfBytes = doc.output('arraybuffer');
  if (pdfBytes.byteLength <= SAFARI_NATIVE_DOWNLOAD_LIMIT) {
    const pdfUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    return {
      expiresAt: Number.POSITIVE_INFINITY,
      dispose: () => URL.revokeObjectURL(pdfUrl),
      download: () => {
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
    };
  }

  const response = await fetch(`${PDF_DOWNLOAD_SERVICE_URL}/api/pdf-download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-PDF-Filename': fileName,
    },
    body: pdfBytes,
  });
  if (!response.ok) throw new Error(`Não foi possível preparar o PDF para download (${response.status}).`);
  const { downloadUrl } = await response.json();
  if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('/api/pdf-download/')) {
    throw new Error('O endereço de download do PDF é inválido.');
  }

  return {
    expiresAt: Date.now() + 4 * 60 * 1000,
    download: () => {
      const link = document.createElement('a');
      // O envio vai direto ao serviço por desempenho, mas o download permanece no
      // domínio já autorizado do sistema para não exibir um novo aviso no Safari.
      link.href = downloadUrl;
      link.download = fileName;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
  };
};

export const savePDF = async (doc: jsPDF, fileName: string): Promise<void> => {
  const prepared = await preparePDFDownload(doc, fileName);
  prepared.download();
};
