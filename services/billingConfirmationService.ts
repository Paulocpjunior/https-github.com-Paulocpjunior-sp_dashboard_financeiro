import { collection, doc, getDocsFromServer, query, where, orderBy, limit, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebaseConfig';
import { validateMonthlyTerms, monthlyTermsId, type MonthlyTerms, type SavedMonthlyTerms } from '../utils/billingConfirmation';
import { withBillingReadTimeout as limited } from '../utils/billingAsync';
export interface IdentityLink { sourceIdentity:string; targetIdentity:string; evidence:string; revision:number }
async function actor() {
  const user=auth.currentUser; if(!user)throw new Error('Entre novamente para registrar a conferência.');
  return user;
}
export async function fetchSavedBillingReview(month:string) {
  const user=await actor();
  const [terms,links]=await Promise.all([limited(getDocsFromServer(query(collection(db,'billingMonthlyReviews'),where('month','==',month)))),limited(getDocsFromServer(collection(db,'billingIdentityLinks')))]);
  if(auth.currentUser!==user)throw new Error('Sessão alterada durante a consulta.');
  return { terms:terms.docs.map(d=>d.data() as SavedMonthlyTerms),links:links.docs.map(d=>d.data() as IdentityLink) };
}
export async function saveMonthlyTerms(value:MonthlyTerms,isAdmin:boolean,expectedRevision:number,assertCurrent?:()=>void) {
  const errors=validateMonthlyTerms(value,isAdmin); if(errors.length)throw new Error(errors.join(' '));
  return saveRevision('billingMonthlyReviews',monthlyTermsId(value.month,value.identity),value,expectedRevision,assertCurrent);
}
export async function saveIdentityLink(value:Omit<IdentityLink,'revision'>,expectedRevision=0,assertCurrent?:()=>void) {
  if(!/^(unidentified|checklist-unidentified):.+$/.test(value.sourceIdentity)||!/^(doc:\d{11}|doc:\d{14}|number:\d+)$/.test(value.targetIdentity)||!value.evidence.trim())throw new Error('Informe identificação estável e evidência do vínculo.');
  return saveRevision('billingIdentityLinks',encodeURIComponent(value.sourceIdentity),value,expectedRevision,assertCurrent);
}
async function saveRevision(name:string,id:string,value:object,expectedRevision:number,assertCurrent:()=>void=()=>{}) {
  assertCurrent();
  const user=await actor();const ref=doc(db,name,id);const audit=doc(collection(ref,'revisions'));
  assertCurrent();
  await runTransaction(db,async transaction=>{
    assertCurrent();
    const previous=await transaction.get(ref);
    assertCurrent();
    if(auth.currentUser!==user)throw new Error('Sessão alterada durante a gravação.');
    const old=previous.data();
    if((old?.revision||0)!==expectedRevision)throw new Error('Outro colaborador alterou a conferência. Recarregue antes de salvar.');
    const record={...value,schemaVersion:1,revision:expectedRevision+1,auditId:audit.id,actorUid:user.uid,
      createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()};
    transaction.set(ref,record);transaction.set(audit,record);
  });
}

export async function fetchMonthlyHistory(month:string,identity:string) {
  const user=await actor();
  const snapshot=await limited(getDocsFromServer(query(collection(db,'billingMonthlyReviews',monthlyTermsId(month,identity),'revisions'),orderBy('revision','desc'),limit(50))));
  if(auth.currentUser!==user)throw new Error('Sessão alterada.');
  return snapshot.docs.map(d=>d.data() as SavedMonthlyTerms);
}
