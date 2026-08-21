import { jsPDF } from 'jspdf';

const PDF_DOWNLOAD_SERVICE_URL = 'https://sp-pdf-download-291088837584.us-central1.run.app';

const isSafari = (): boolean => {
  const userAgent = navigator.userAgent;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Android/i.test(userAgent);
};

export const warmPDFDownloadService = (): void => {
  if (!isSafari()) return;
  void fetch(`${PDF_DOWNLOAD_SERVICE_URL}/api/pdf-download/health`, { cache: 'no-store' }).catch(() => undefined);
};

export const savePDF = async (doc: jsPDF, fileName: string): Promise<void> => {
  if (!isSafari()) {
    doc.save(fileName);
    return;
  }

  const pdfBytes = doc.output('arraybuffer');
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

  const link = document.createElement('a');
  link.href = `${PDF_DOWNLOAD_SERVICE_URL}${downloadUrl}`;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
};
