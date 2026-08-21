import { jsPDF } from 'jspdf';

const PDF_CACHE = 'sp-pdf-downloads-v1';

const isSafari = (): boolean => {
  const userAgent = navigator.userAgent;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Android/i.test(userAgent);
};

const waitForServiceWorkerControl = async (): Promise<void> => {
  await navigator.serviceWorker.register('/pdf-download-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  if (navigator.serviceWorker.controller) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('O Safari não ativou o download de PDF. Recarregue a página e tente novamente.')), 8_000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
};

export const savePDF = async (doc: jsPDF, fileName: string): Promise<void> => {
  if (!isSafari() || !('serviceWorker' in navigator) || !('caches' in window)) {
    doc.save(fileName);
    return;
  }

  await waitForServiceWorkerControl();

  const pdfBytes = doc.output('arraybuffer');
  const downloadId = `${Date.now()}-${crypto.randomUUID()}`;
  const downloadUrl = new URL(`/__pdf-download__/${downloadId}/${encodeURIComponent(fileName)}`, window.location.origin);
  const cache = await caches.open(PDF_CACHE);
  await cache.put(downloadUrl.toString(), new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(pdfBytes.byteLength),
      'Cache-Control': 'no-store',
    },
  }));

  const link = document.createElement('a');
  link.href = downloadUrl.toString();
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    void caches.open(PDF_CACHE).then(pdfCache => pdfCache.delete(downloadUrl.toString()));
  }, 60_000);
};
