import { jsPDF } from 'jspdf';

const isSafari = (): boolean => {
  const userAgent = navigator.userAgent;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Android/i.test(userAgent);
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
};

export const savePDF = async (doc: jsPDF, fileName: string): Promise<void> => {
  if (!isSafari()) {
    doc.save(fileName);
    return;
  }

  const pdfBytes = doc.output('arraybuffer');
  const response = await fetch('/api/pdf-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ fileName, pdfBase64: arrayBufferToBase64(pdfBytes) }),
  });
  if (!response.ok) throw new Error(`Não foi possível preparar o PDF para download (${response.status}).`);
  const { downloadUrl } = await response.json();
  if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('/api/pdf-download/')) {
    throw new Error('O endereço de download do PDF é inválido.');
  }

  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
};
