import assert from 'node:assert/strict';
import { createServer } from 'vite';

// All Firebase imports are replaced before evaluating the service. No real
// credentials, network requests, or Firestore writes participate in this test.
const state = {auth:{currentUser:{uid:'synthetic-admin'}},beforeRead:()=>{},historyRead:async()=>({docs:[]}),previous:undefined,writes:[],transactions:0};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network forbidden in synthetic billing tests'); };
globalThis.__billingLifecycleTest = state;
const server = await createServer({server:{middlewareMode:true},ssr:{noExternal:['firebase']},optimizeDeps:{noDiscovery:true},appType:'custom',logLevel:'error',plugins:[{
  name:'isolated-billing-firebase',enforce:'pre',
  resolveId(source,importer){
    if(source==='firebase/firestore')return '\0billing-firestore';
    if(source==='./firebaseConfig'&&importer?.endsWith('/billingConfirmationService.ts'))return '\0billing-config';
  },
  load(id){
    if(id==='\0billing-config')return 'export const db={}; export const auth=globalThis.__billingLifecycleTest.auth;';
    if(id==='\0billing-firestore')return `
      const state=globalThis.__billingLifecycleTest;
      export const collection=(...args)=>({kind:'collection',args});
      export const doc=(...args)=>({kind:'doc',args,id:'synthetic-audit'});
      export const query=(...args)=>({args});
      export const where=(...args)=>args, orderBy=(...args)=>args, limit=(...args)=>args;
      export const serverTimestamp=()=>({syntheticServerTime:true});
      export async function getDocsFromServer(){return state.historyRead();}
      export async function runTransaction(db,callback){
        state.transactions++;
        const staged=[];
        await callback({get:async()=>{await state.beforeRead();return {data:()=>state.previous};},set:(ref,value)=>staged.push({ref,value})});
        state.writes.push(...staged);
      }
    `;
  },
}]});
try {
  const {saveMonthlyTerms,saveIdentityLink,fetchMonthlyHistory}=await server.ssrLoadModule('/services/billingConfirmationService.ts');
  const {createBillingOperationGate}=await server.ssrLoadModule('/utils/billingAsync.ts');
  const terms={month:'2026-10',identity:'number:123',client:'Synthetic',decision:'charge',amount:500,dueDate:'2026-10-10',startDate:'2026-10-01',billingDay:10,lastChargeDate:'',evidence:'Synthetic evidence',event:'entrada',sourceFingerprint:'a'.repeat(64)};
  const link={sourceIdentity:'unidentified:synthetic',targetIdentity:'number:123',evidence:'Synthetic evidence'};
  for(const save of [guard=>saveMonthlyTerms(terms,true,0,guard),guard=>saveIdentityLink(link,0,guard)]) {
    const gate=createBillingOperationGate();const operation=gate.start();gate.dispose();
    const count=state.transactions;
    await assert.rejects(save(()=>operation.assertCurrent()),/encerrada/);
    assert.equal(state.transactions,count,'no transaction after unmount');
    gate.activate();const active=gate.start();
    state.beforeRead=()=>gate.dispose();
    await assert.rejects(save(()=>active.assertCurrent()),/encerrada/);
    assert.equal(state.writes.length,0,'no write when unmounted during transaction read');
    state.beforeRead=()=>{state.auth.currentUser={uid:'other-synthetic-user'};};
    await assert.rejects(save(()=>{}),/Sessão alterada/);
    assert.equal(state.writes.length,0);
    state.beforeRead=()=>{};
  }
  state.auth.currentUser={uid:'synthetic-admin'};
  state.previous={revision:2};
  await assert.rejects(saveMonthlyTerms(terms,true,0),/Outro colaborador/);
  assert.equal(state.writes.length,0);
  state.previous=undefined;
  await saveMonthlyTerms(terms,true,0);
  assert.equal(state.writes.length,2,'parent and audit written together');
  assert.deepEqual(state.writes[0].value,state.writes[1].value);
  assert.equal(state.writes[0].value.actorUid,'synthetic-admin');
  assert.equal(state.writes[0].value.revision,1);
  state.historyRead=async()=>({docs:[{data:()=>state.writes[1].value}]});
  assert.deepEqual(await fetchMonthlyHistory('2026-10','number:123'),[state.writes[1].value]);
  state.historyRead=async()=>{state.auth.currentUser={uid:'new-reader'};return {docs:[]};};
  await assert.rejects(fetchMonthlyHistory('2026-10','number:123'),/Sessão alterada/);
  console.log('OK: service blocks stale operations, changed sessions and revisions; successful write preserves atomic audit history (synthetic Firebase only).');
} finally { await server.close(); delete globalThis.__billingLifecycleTest; globalThis.fetch=originalFetch; }
