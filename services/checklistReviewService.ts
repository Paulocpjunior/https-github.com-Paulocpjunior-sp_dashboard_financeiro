import { auth } from './firebaseConfig';

export interface ChecklistRecord {
  document?: string; sourceCreatedAt?: string | null;
  submissionId: string; identity: string; client: string | null; clientNumber: string | null;
  amount: number | null; entryDate: string | null; exitDate: string | null; suspensionDate: string | null;
  status: string | null; notes: string | null; issues: string[]; observationsRequireReview: boolean;
  sourceUpdatedAt: string | null; contractValidated: false;
}
export interface ChecklistReview {
  formId: string; title: string; readAt: string; sourceFingerprint: string; complete: true;
  expected: number; received: number; active: number; excluded: number;
  validRecords: number; conflictRecords: number; observationsToReview: number;
  canCloseMonth: false; records: ChecklistRecord[];
}
export async function fetchChecklistReview(signal: AbortSignal): Promise<ChecklistReview> {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente para consultar o checklist.');
  const token = await user.getIdToken();
  const response = await fetch('/api/billing-checklist/review', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }), signal,
  });
  if (auth.currentUser !== user) throw new Error('Sessão alterada durante a consulta.');
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Leitura do checklist indisponível.');
  const counts = ['expected','received','active','excluded','validRecords','conflictRecords','observationsToReview'];
  if (data?.complete !== true || data?.canCloseMonth !== false || data?.formId !== '210135417457653' ||
      !Array.isArray(data?.records) || counts.some(key => !Number.isSafeInteger(data[key]) || data[key] < 0) ||
      data.expected !== data.received || data.active + data.excluded !== data.received ||
      data.validRecords + data.conflictRecords !== data.active || data.records.length !== data.active ||
      typeof data.sourceFingerprint !== 'string' || !Number.isFinite(Date.parse(data.readAt))) {
    throw new Error('A fonte não confirmou uma leitura completa e válida.');
  }
  return data;
}
