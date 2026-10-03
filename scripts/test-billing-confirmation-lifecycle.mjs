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
    if(source==='./firebaseConfig'&&(importer?.endsWith('/billingConfirmationService.ts')||importer?.endsWith('/billingTaskService.ts')))return '\0billing-config';
  },
  load(id){
    if(id==='\0billing-config')return 'export const db={}; export const auth=globalThis.__billingLifecycleTest.auth;';
    if(id==='\0billing-firestore')return `
      const state=globalThis.__billingLifecycleTest;
      export const collection=(...args)=>({kind:'collection',args});
      export const doc=(...args)=>({kind:'doc',args,id:'synthetic-audit'});
      export const query=(...args)=>({args});
      export const where=(...args)=>args, orderBy=(...args)=>({orderBy:args}), limit=(...args)=>({limit:args});
      export const startAfter=(snapshot)=>({startAfter:snapshot});
      export const serverTimestamp=()=>({syntheticServerTime:true});
      export async function getDocsFromServer(request){return state.historyRead(request);}
      export async function runTransaction(db,callback){
        state.transactions++;
        const staged=[];
        await callback({get:async(ref)=>{await state.beforeRead();const value=ref.args[1]==='users'?state.assignee:state.previous;return {data:()=>value,exists:()=>value!==undefined};},set:(ref,value)=>staged.push({ref,value})});
        state.writes.push(...staged);
      }
    `;
  },
}]});
try {
  const {saveMonthlyTerms,saveIdentityLink,fetchMonthlyHistory,fetchMonthlyHistoryPage}=await server.ssrLoadModule('/services/billingConfirmationService.ts');
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
  const snapshots=Array.from({length:120},(_,i)=>({id:`audit-${120-i}`,data:()=>({...terms,revision:120-i})}));
  let reads=0;
  state.historyRead=async request=>{
    reads++;
    assert.deepEqual(request.args.find(c=>c.orderBy)?.orderBy,['revision','desc']);
    assert.deepEqual(request.args.find(c=>c.limit)?.limit,[51]);
    const cursor=request.args.find(c=>c.startAfter)?.startAfter;
    const offset=cursor?snapshots.indexOf(cursor)+1:0;
    return {docs:snapshots.slice(offset,offset+51)};
  };
  const firstPage=await fetchMonthlyHistoryPage('2026-10','number:123');
  assert.equal(firstPage.items.length,50);assert.equal(firstPage.nextCursor.snapshot,snapshots[49]);
  const readCount=reads;
  await assert.rejects(fetchMonthlyHistoryPage('2026-11','number:123',firstPage.nextCursor),/outra competência/);
  await assert.rejects(fetchMonthlyHistoryPage('2026-10','number:456',firstPage.nextCursor),/outra competência/);
  assert.equal(reads,readCount,'cursor de outro cliente/mês não consulta a base');
  const pagedReader=state.historyRead;
  state.historyRead=async()=>{throw new Error('Falha de página simulada');};
  await assert.rejects(fetchMonthlyHistoryPage('2026-10','number:123',firstPage.nextCursor),/Falha de página/);
  assert.equal(firstPage.items.length,50,'falha não modifica página anterior');
  state.historyRead=pagedReader;
  // A new latest revision between requests must not duplicate or skip old rows.
  snapshots.unshift({id:'audit-121',data:()=>({...terms,revision:121})});
  const secondPage=await fetchMonthlyHistoryPage('2026-10','number:123',firstPage.nextCursor);
  const lastPage=await fetchMonthlyHistoryPage('2026-10','number:123',secondPage.nextCursor);
  assert.equal(lastPage.nextCursor,null);
  assert.deepEqual([...firstPage.items,...secondPage.items,...lastPage.items].map(r=>r.revision),Array.from({length:120},(_,i)=>120-i));
  state.historyRead=async()=>({docs:snapshots.slice(0,50)});
  assert.equal((await fetchMonthlyHistoryPage('2026-10','number:123')).nextCursor,null,'50 exatos não indicam uma página inexistente');
  state.historyRead=async()=>({docs:[]});
  assert.deepEqual(await fetchMonthlyHistoryPage('2026-10','number:123'),{items:[],nextCursor:null});
  assert.equal(state.writes.length,2,'consultas paginadas não escrevem registros');
  const {saveBillingTask}=await server.ssrLoadModule('/services/billingTaskService.ts');
  const task={month:'2026-10',identity:'unidentified:synthetic',client:'Synthetic',assigneeUid:'operator',assigneeName:'Old name',deadline:'2026-10-05',state:'open',evidence:'Conferir cadastro'};
  state.assignee={active:false,name:'Current name'};
  await assert.rejects(saveBillingTask(task,0,()=>{}),/não está ativo/);
  assert.equal(state.writes.length,2);
  state.assignee={active:true,status:'blocked',name:'Current name'};
  await assert.rejects(saveBillingTask(task,0,()=>{}),/não está ativo/);
  state.assignee={active:true,name:'Current name'};
  await assert.rejects(saveBillingTask(task,0,()=>{throw new Error('Tela encerrada');}),/encerrada/);
  state.previous={revision:1};await assert.rejects(saveBillingTask(task,0,()=>{}),/outro usuário/);
  state.previous=undefined;await saveBillingTask(task,0,()=>{});
  assert.equal(state.writes.length,4);assert.deepEqual(state.writes[2].value,state.writes[3].value);
  assert.equal(state.writes[2].value.assigneeName,'Current name','nome vem do perfil relido');
  console.log('OK: service blocks stale operations, changed sessions and revisions; successful write preserves atomic audit history (synthetic Firebase only).');
} finally { await server.close(); delete globalThis.__billingLifecycleTest; globalThis.fetch=originalFetch; }
