import type { ChecklistRecord, ChecklistReview } from '../services/checklistReviewService';
export interface RegistryDocument { collection: 'clientRegistry' | 'billingProfiles'; id: string; data: Record<string, unknown> }
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export async function mapFirestoreChecklist(documents: RegistryDocument[], readAt: string): Promise<ChecklistReview> {
  const records: ChecklistRecord[] = documents.map(({collection,id,data:d}): ChecklistRecord => {
    const document = text(d.cpfCnpjDigits || d.cpfCnpj).replace(/\D/g,'');
    const rawNumber = text(d.clientNumber);
    const clientNumber = /^\d+$/.test(rawNumber) ? rawNumber : '';
    const identity = [11,14].includes(document.length) ? `doc:${document}` : /^\d+$/.test(clientNumber) ? `number:${clientNumber.replace(/^0+(?=\d)/,'')}` : '';
    const issues = ['Cadastro operacional não comprova valor, evento ou vigência contratual. Conferência necessária.'];
    if (rawNumber && !clientNumber) issues.push('Número de cliente inválido; associação por esse número bloqueada.');
    if (!identity) issues.push('Identificação estável ausente ou inválida. Não associar por nome.');
    if (!text(d.client)) issues.push('Nome ausente no cadastro.');
    if (collection === 'clientRegistry' && d.status !== 'ready') issues.push('Cadastro marcado para revisão de identificação.');
    if (collection === 'billingProfiles' && d.active !== true) issues.push('Perfil operacional inativo ou sem estado informado; não comprova encerramento do contrato.');
    return { submissionId: `${collection}/${id}`, sourceCollection: collection, identity, document,
      client: text(d.client) || null, clientNumber: clientNumber || null,
      // Never derive contractual events, fees or dates from operational flags,
      // due dates, registry timestamps or free-text instructions.
      amount:null, status:null, entryDate:null, exitDate:null, suspensionDate:null,
      notes:text(d.billingInstructions) || null, sourceCreatedAt:text(d.createdAt) || null,
      sourceUpdatedAt:text(d.updatedAt) || null, issues,
      observationsRequireReview:Boolean(text(d.billingInstructions)), contractValidated:false };
  }).sort((a,b)=>a.submissionId.localeCompare(b.submissionId));
  if (new Set(records.map(r=>r.submissionId)).size !== records.length) throw new Error('Registros repetidos na leitura do Firestore.');
  const counts = new Map<string,number>();
  records.forEach(r=>{if(r.identity)counts.set(r.identity,(counts.get(r.identity)||0)+1);});
  records.forEach(r=>{if((counts.get(r.identity)||0)>1)r.issues.push('Identificação presente em mais de um cadastro. Fontes mantidas separadas para conferência.');});
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(records)));
  return {source:'firestore',formId:'firestore:financial-registry',title:'Cadastros do Firestore — conferência contratual',readAt,
    sourceFingerprint:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''),
    complete:true,expected:records.length,received:records.length,active:records.length,excluded:0,
    validRecords:0,conflictRecords:records.length,observationsToReview:records.filter(r=>r.observationsRequireReview).length,
    canCloseMonth:false,records};
}
