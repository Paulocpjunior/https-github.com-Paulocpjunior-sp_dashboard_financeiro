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
export async function fetchChecklistReview(_signal: AbortSignal): Promise<ChecklistReview> {
  throw new Error('A consulta ao Jotform foi desativada no Financeiro. O histórico salvo foi preservado; esta consulta não libera fechamento mensal.');
}
