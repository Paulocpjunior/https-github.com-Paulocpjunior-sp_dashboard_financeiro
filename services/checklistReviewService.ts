import { auth, firebaseConfig } from './firebaseConfig';
import { readFirestoreChecklist } from './firestoreChecklistReader';
import { assertChecklistResponse } from '../utils/checklistResponse';
export interface ChecklistRecord {
  sourceCollection?: 'clientRegistry' | 'billingProfiles';
  document?: string; sourceCreatedAt?: string | null;
  submissionId: string; identity: string; client: string | null; clientNumber: string | null;
  amount: number | null; entryDate: string | null; exitDate: string | null; suspensionDate: string | null;
  status: string | null; notes: string | null; issues: string[]; observationsRequireReview: boolean;
  sourceUpdatedAt: string | null; contractValidated: false;
}
export interface ChecklistReview {
  source?: 'firestore';
  formId: string; title: string; readAt: string; sourceFingerprint: string; complete: true;
  expected: number; received: number; active: number; excluded: number;
  validRecords: number; conflictRecords: number; observationsToReview: number;
  canCloseMonth: false; records: ChecklistRecord[];
}
export async function fetchChecklistReview(signal: AbortSignal): Promise<ChecklistReview> {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente para consultar o cadastro financeiro.');
  const checkSession = () => {
    signal.throwIfAborted();
    if (auth.currentUser !== user) throw new Error('Sessão alterada durante a consulta.');
  };
  checkSession();
  const token = await user.getIdToken();
  checkSession();
  const result = await readFirestoreChecklist({projectId:firebaseConfig.projectId,token,signal,checkSession});
  checkSession();
  assertChecklistResponse(result);
  return result;
}
