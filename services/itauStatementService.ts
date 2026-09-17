import { auth } from '../firebase';
export interface StatementRow {
  id: string; fitid: string; date: string; amountCents: number; type: string;
  name: string; memo: string; checknum: string;
}
export interface StatementImport {
  fileHash: string; fileName: string; start: string; end: string;
  ledgerBalance: { date: string; amountCents: number } | null;
  totals: { credits: number; debits: number }; rowCount: number;
  inserted: number; duplicates: number; importedAt: string;
}
export interface StatementPreview {
  accountId: string; start: string; end: string; fileHash: string; fileName: string;
  rows: StatementRow[]; ledgerBalance: StatementImport['ledgerBalance'];
  totals: StatementImport['totals']; newCount: number; duplicateCount: number;
  conflicts: string[]; alreadyImported: boolean;
}
export interface OfxFile { base64: string; fileName: string }
export class StatementRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new StatementRequestError('Entre novamente para acessar o extrato.', 401);
  const response = await fetch(`/api/itau/${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new StatementRequestError('Módulo de extrato indisponível. Tente novamente mais tarde.', 503);
  const payload = await response.json();
  if (!response.ok) throw new StatementRequestError(payload.error || 'Não foi possível consultar o extrato.', response.status);
  return payload;
}
export async function readOfxFile(file: File): Promise<OfxFile> {
  if (!/\.ofx$/i.test(file.name) || file.size === 0 || file.size > 2 * 1024 * 1024) throw new Error('Selecione um arquivo .ofx de até 2 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { base64: btoa(binary), fileName: file.name };
}
export const ItauStatements = {
  list: (start: string, end: string) => request<{ rows: StatementRow[]; imports: StatementImport[] }>(`statements?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  preview: (file: OfxFile) => request<StatementPreview>('preview', file),
  commit: (file: OfxFile, confirmHash: string) => request<{ alreadyImported: boolean; inserted: number; duplicates: number }>('import', { ...file, confirmHash }),
};
