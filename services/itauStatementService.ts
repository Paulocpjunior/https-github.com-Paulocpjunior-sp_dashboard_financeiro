import { auth } from '../firebase';
export interface StatementRow {
  id: string; fitid: string; date: string; amountCents: number; type: string;
  name: string; memo: string; checknum: string;
}
export interface StatementBalance extends Omit<StatementRow, 'id'> { kind: 'opening' | 'available' }
export interface StatementImport {
  fileHash: string; fileName: string; start: string; end: string;
  balanceRows?: StatementBalance[];
  ledgerBalance: { date: string; amountCents: number } | null;
  totals: { credits: number; debits: number }; rowCount: number;
  inserted: number; duplicates: number; importedAt: string;
}
export interface StatementPreview {
  accountId: string; start: string; end: string; fileHash: string; fileName: string;
  rows: StatementRow[]; balanceRows?: StatementBalance[]; ledgerBalance: StatementImport['ledgerBalance'];
  totals: StatementImport['totals']; newCount: number; duplicateCount: number;
  conflicts: string[]; alreadyImported: boolean;
}
export interface OfxFile { base64: string; fileName: string }
export class StatementRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  await auth.authStateReady();
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
  if (!/\.(ofx|pdf|xls|xlsx)$/i.test(file.name) || file.size === 0 || file.size > 2 * 1024 * 1024) throw new Error('Selecione OFX, PDF, XLS ou XLSX de até 2 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { base64: btoa(binary), fileName: file.name };
}
export interface LegacyLinkPreview {
 fingerprint:string;revision:number;
 statement:{id:string;date:string;amountCents:number;name:string;fitid:string};
 payment:{id:string;paymentRequestId?:string;transactionId:string;date:string;amountCents:number;supplier:string;bankEvidence:'missing'|'same-account'};
}
export interface LegacyLink {
 kind?:'legacy'|'native';paymentRequestId?:string;
 statementId:string;transactionId:string;active:boolean;revision:number;validation:'current'|'changed'|'missing'|'inactive';
 statement:LegacyLinkPreview['statement'];payment:LegacyLinkPreview['payment'];
 history:Array<{members?:GroupMember[];paymentRequestId?:string;kind?:'legacy'|'native'|'native-group';action:'confirm'|'unlink';at:string;actor:{uid:string;name:string};reason:string;reference?:string;transactionId:string}>;
}
export interface GroupMember {transactionId:string;paymentRequestId:string}
export interface GroupPayment extends GroupMember {id:string;date:string;amountCents:number;supplier:string}
export interface GroupPreview {statement:LegacyLinkPreview['statement'];members:GroupMember[];payments:GroupPayment[];totalCents:number;fingerprint:string;revision:number}
export interface GroupLink extends GroupPreview {statementId:string;kind:'native-group';active:boolean;validation:LegacyLink['validation'];history:Array<{action:'confirm'|'unlink';at:string;actor:{uid:string;name:string};reason:string;reference?:string;members?:GroupMember[];transactionId?:string;paymentRequestId?:string}>}
export const ItauStatements = {
 previewGroup:(statementId:string,members:GroupMember[])=>request<GroupPreview>('group-links/preview',{statementId,members}),
 confirmGroup:(body:{statementId:string;members:GroupMember[];requestId:string;revision:number;fingerprint:string;reason:string;reference:string;checkedEvidence:boolean})=>request('group-links/confirm',body),
 unlinkGroup:(body:{statementId:string;requestId:string;revision:number;reason:string})=>request('group-links/unlink',body),
 previewLegacyLink:(statementId:string,transactionId:string,paymentRequestId?:string)=>request<LegacyLinkPreview>(`${paymentRequestId?'native':'legacy'}-links/preview`,{statementId,transactionId,paymentRequestId}),
 confirmLegacyLink:(body:{statementId:string;transactionId:string;paymentRequestId?:string;requestId:string;revision:number;fingerprint:string;reason:string;reference:string;checkedEvidence:boolean})=>request(`${body.paymentRequestId?'native':'legacy'}-links/confirm`,body),
 unlinkLegacyLink:(body:{kind?:'legacy'|'native';statementId:string;requestId:string;revision:number;reason:string})=>request(`${body.kind==='native'?'native':'legacy'}-links/unlink`,body),
  compare: (start:string,end:string,includeLegacy=false) => request<PaymentComparison>(`payment-comparison?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&includeLegacy=${includeLegacy}`),
  list: (start: string, end: string) => request<{ rows: StatementRow[]; imports: StatementImport[] }>(`statements?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  preview: (file: OfxFile) => request<StatementPreview>('preview', file),
  commit: (file: OfxFile, confirmHash: string) => request<{ alreadyImported: boolean; inserted: number; duplicates: number }>('import', { ...file, confirmHash }),
};

export interface LegacyComparison {
 coverage:string; examined:number; paymentCount:number; excluded:Record<string,number>;
 rows:Array<{statement:StatementRow;ambiguous:boolean;candidates:Array<{id:string;paymentRequestId?:string;transactionId:string;date:string;amountCents:number;supplier:string;bankEvidence:'missing'|'same-account'}>}>;
}
export interface PaymentComparison {
 groupPayments?:GroupPayment[];groupLinks?:GroupLink[];
 legacy?:LegacyComparison;
 legacyLinks?:LegacyLink[];
 rows:Array<{statement:StatementRow;reviewHint?:string;status:'suggestion'|'ambiguous'|'no-candidate'|'outside-scope';candidates:Array<{id:string;paymentRequestId?:string;transactionId:string;date:string;amountCents:number;supplier:string}>}>;
 counts:Record<string,number>;coverage:string;criterion:string;paymentCount:number;unmatchedPayments:Array<{id:string;transactionId:string;date:string;amountCents:number;supplier:string}>;
 start:string;end:string;paymentStart:string;paymentEnd:string;generatedAt:string;
}
