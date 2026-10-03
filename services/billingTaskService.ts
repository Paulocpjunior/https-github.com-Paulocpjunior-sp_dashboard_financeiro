import { collection,doc,getDocsFromServer,query,where,runTransaction,serverTimestamp,orderBy,limit } from 'firebase/firestore';
import { auth,db } from './firebaseConfig';
import { withBillingReadTimeout } from '../utils/billingAsync';
import { billingTaskId,validateBillingTask,type BillingTask,type SavedBillingTask } from '../utils/billingTasks';
function actor(){const user=auth.currentUser;if(!user)throw new Error('Entre novamente.');return user;}
export async function fetchBillingTasks(month:string){
  const user=actor();const snapshot=await withBillingReadTimeout(getDocsFromServer(query(collection(db,'billingFollowUps'),where('month','==',month))));
  if(auth.currentUser!==user)throw new Error('Sessão alterada.');
  return snapshot.docs.map(d=>d.data() as SavedBillingTask);
}
export async function fetchBillingTaskAssignees(){
  const user=actor();const snapshot=await withBillingReadTimeout(getDocsFromServer(query(collection(db,'users'),where('active','==',true))));
  if(auth.currentUser!==user)throw new Error('Sessão alterada.');
  return snapshot.docs.filter(d=>!['deleted','blocked'].includes(d.data().status)).map(d=>({uid:d.id,name:String(d.data().name||d.data().username||d.id)})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
export async function saveBillingTask(value:BillingTask,expectedRevision:number,assertCurrent:()=>void){
  const errors=validateBillingTask(value);if(errors.length)throw new Error(errors.join(' '));
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('Revisão inválida.');
  const user=actor();const parent=doc(db,'billingFollowUps',billingTaskId(value.month,value.identity));const audit=doc(collection(parent,'revisions'));
  await runTransaction(db,async transaction=>{
    assertCurrent();const previous=await transaction.get(parent);const assignee=await transaction.get(doc(db,'users',value.assigneeUid));
    assertCurrent();if(auth.currentUser!==user)throw new Error('Sessão alterada.');
    if(!assignee.exists()||assignee.data().active!==true||['deleted','blocked'].includes(assignee.data().status))throw new Error('Responsável não está ativo. Atualize a lista.');
    const old=previous.data();if((old?.revision||0)!==expectedRevision)throw new Error('Pendência alterada por outro usuário. Recarregue.');
    const record={...value,assigneeName:String(assignee.data().name||assignee.data().username||value.assigneeUid),schemaVersion:1,revision:expectedRevision+1,auditId:audit.id,actorUid:user.uid,createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()};
    transaction.set(parent,record);transaction.set(audit,record);
  });
}
export async function fetchBillingTaskHistory(month:string,identity:string){
  const user=actor();const snapshot=await withBillingReadTimeout(getDocsFromServer(query(collection(db,'billingFollowUps',billingTaskId(month,identity),'revisions'),orderBy('revision','desc'),limit(50))));
  if(auth.currentUser!==user)throw new Error('Sessão alterada.');return snapshot.docs.map(d=>d.data() as SavedBillingTask);
}
