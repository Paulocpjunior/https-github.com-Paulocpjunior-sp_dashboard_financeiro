import { jsPDF } from 'jspdf';

const isSafari = (): boolean => {
  const userAgent = navigator.userAgent;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Android/i.test(userAgent);
};

export const savePDF = (doc: jsPDF, fileName: string): void => {
  if (!isSafari()) {
    doc.save(fileName);
    return;
  }

  // O Safari pode interromper downloads de URLs blob grandes e deixar apenas
  // uma pasta .pdf.download vazia. A data URI contém o próprio PDF e não
  // depende de uma URL temporária que o navegador precise buscar depois.
  const link = document.createElement('a');
  link.href = doc.output('datauristring', { filename: fileName });
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => link.remove(), 1_000);
};
