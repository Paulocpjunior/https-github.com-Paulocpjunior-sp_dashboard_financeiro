import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
if(!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')&&!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('localhost:'))throw new Error('Teste exige emulador isolado, nunca produção.');
const env=await initializeTestEnvironment({projectId:'demo-financeiro-reviews',firestore:{rules:readFileSync('firestore.rules','utf8')}});
try {
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'users/admin-test'),{active:true,role:'admin'});await setDoc(doc(db,'users/operator-test'),{active:true,role:'operacional'});await setDoc(doc(db,'users/inactive-test'),{active:false,role:'admin'});});
 const admin=env.authenticatedContext('admin-test').firestore();const operator=env.authenticatedContext('operator-test').firestore();const inactive=env.authenticatedContext('inactive-test').firestore();
 const base={schemaVersion:1,month:'2026-10',identity:'number:123',client:'Cliente sintético',decision:'charge',amount:500,dueDate:'2026-10-10',startDate:'2026-10-01',billingDay:10,lastChargeDate:'',evidence:'Contrato sintético',event:'entrada',sourceFingerprint:'a'.repeat(64)};
 async function write(db,uid,id,data,old) {
  const parent=doc(db,'billingMonthlyReviews',id);const audit=doc(collection(parent,'revisions'));
  const record={...data,actorUid:uid,revision:(old?.revision||0)+1,auditId:audit.id,createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()};
  const batch=writeBatch(db);batch.set(parent,record);batch.set(audit,record);return batch.commit();
 }
 const id='2026-10_number:123';await assertSucceeds(write(admin,'admin-test',id,base));
 const saved=(await getDoc(doc(admin,'billingMonthlyReviews',id))).data();
 await assertSucceeds(getDoc(doc(operator,'billingMonthlyReviews',id)));
 await assertFails(getDoc(doc(inactive,'billingMonthlyReviews',id)));
 await assertFails(write(operator,'operator-test','2026-10_number:124',{...base,identity:'number:124'}));
 await assertSucceeds(write(operator,'operator-test','2026-10_number:125',{...base,identity:'number:125',decision:'needs_review',amount:null,dueDate:'',startDate:'',billingDay:0}));
 await assertFails(write(operator,'operator-test',id,{...base,decision:'needs_review'},saved));
 await assertFails(write(admin,'admin-test','2026-10_number:126',{...base,identity:'number:126',event:'saida'}));
 await assertFails(write(admin,'admin-test','wrong-id',{...base,identity:'number:127'}));
 await assertFails(setDoc(doc(admin,'billingMonthlyReviews',id),{...saved,revision:2,updatedAt:serverTimestamp()}));
 await assertFails(deleteDoc(doc(admin,'billingMonthlyReviews',id)));
 await assertFails(setDoc(doc(admin,'billingMonthlyReviews',id,'revisions',saved.auditId),{...saved,evidence:'Alterada'}));
 await assertFails(deleteDoc(doc(admin,'billingMonthlyReviews',id,'revisions',saved.auditId)));
 await assertSucceeds(write(admin,'admin-test',id,{...base,amount:550},saved));
 const link=doc(admin,'billingIdentityLinks','synthetic-link');const linkAudit=doc(collection(link,'revisions'));const linkData={schemaVersion:1,sourceIdentity:'unidentified:synthetic',targetIdentity:'number:123',evidence:'Documento sintético',revision:1,auditId:linkAudit.id,actorUid:'admin-test',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};const batch=writeBatch(admin);batch.set(link,linkData);batch.set(linkAudit,linkData);await assertSucceeds(batch.commit());
 await assertFails(setDoc(doc(operator,'billingIdentityLinks','operator-link'),linkData));
 await assertFails(setDoc(doc(operator,'transactions','synthetic'),{status:'Pendente'}));
 console.log('OK: confirmação só por administrador; rascunho operacional; revisão atomicamente auditada; histórico imutável; dados sintéticos em projeto demo.');
} finally {await env.cleanup();}
