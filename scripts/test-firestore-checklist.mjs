import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true},appType:'custom',logLevel:'error'});
try {
 const {readFirestoreChecklist:read}=await server.ssrLoadModule('/services/firestoreChecklistReader.ts');
 const {assertChecklistResponse:validate}=await server.ssrLoadModule('/utils/checklistResponse.ts');
 const time='2026-10-13T12:00:00Z';let calls=[];let session=true;
 const doc=(collection,id,fields={})=>({name:`projects/demo/databases/(default)/documents/${collection}/${id}`,fields:{client:{stringValue:'Fictício'},clientNumber:{stringValue:'00042'},...fields}});
 const fetcher=async(url,options)=>{assert.ok(url.startsWith('https://firestore.googleapis.com/'));const body=JSON.parse(options.body);calls.push(body);const c=body.structuredQuery.from[0].collectionId;return {ok:true,json:async()=>[{readTime:time,document:doc(c,'same',{active:{booleanValue:false},createdAt:{timestampValue:time},dueDay:{integerValue:'10'}})}]};};
 const opts={projectId:'demo',token:'synthetic',fetcher,checkSession(){assert.ok(session,'session changed');}};
 const result=await read(opts);validate(result);assert.equal(result.source,'firestore');assert.equal(result.records.length,2);assert.equal(calls[1].readTime,time);
 for(const r of result.records){assert.equal(r.amount,null);assert.equal(r.entryDate,null);assert.equal(r.status,null);assert.equal(r.contractValidated,false);assert.equal(r.identity,'number:42');assert.ok(r.issues.length);}
 assert.equal(result.canCloseMonth,false);assert.equal(result.conflictRecords,2);
 const again=await read(opts);assert.equal(again.sourceFingerprint,result.sourceFingerprint);
 await assert.rejects(read({...opts,fetcher:async()=>({ok:false,status:403})}),/permissão/);
 await assert.rejects(read({...opts,fetcher:async()=>({ok:true,json:async()=>[]})}),/incompleta/);
 await assert.rejects(read({...opts,fetcher:async()=>({ok:true,json:async()=>[{readTime:time,document:doc('transactions','wrong')}]})}),/Paginação/);
 let n=0;await assert.rejects(read({...opts,fetcher:async()=>({ok:true,json:async()=>[{readTime:++n===1?time:'2026-10-13T12:00:01Z'}]})}),/versão/);
 const empty=await read({...opts,fetcher:async()=>({ok:true,json:async()=>[{readTime:time}]})});validate(empty);assert.equal(empty.received,0);assert.equal(empty.canCloseMonth,false);
 const abort=new AbortController();abort.abort();await assert.rejects(read({...opts,signal:abort.signal}));
 await assert.rejects(read({...opts,fetcher:async(...args)=>{const value=await fetcher(...args);session=false;return value;}}),/session changed/);session=true;
 let pages=0;const paged=await read({...opts,fetcher:async(url,options)=>{const b=JSON.parse(options.body),c=b.structuredQuery.from[0].collectionId;pages++;const docs=c==='clientRegistry'&&!b.structuredQuery.startAt?Array.from({length:1000},(_,i)=>({readTime:time,document:doc(c,String(i).padStart(4,'0'))})):[{readTime:time}];return {ok:true,json:async()=>docs};}});assert.equal(paged.received,1000);assert.equal(pages,3);
 const {mapFirestoreChecklist:map}=await server.ssrLoadModule('/utils/firestoreChecklist.ts');
 const bad=await map([{collection:'clientRegistry',id:'invalid',data:{clientNumber:'ABC'}}],time);validate(bad);assert.equal(bad.records[0].identity,'');assert.equal(bad.records[0].clientNumber,null);
 let failures=0;await assert.rejects(read({...opts,fetcher:async(...args)=>++failures===1?fetcher(...args):({ok:false,status:500})}),/HTTP 500/);
 const duplicated=Array.from({length:2},()=>({readTime:time,document:doc('clientRegistry','repeat')}));await assert.rejects(read({...opts,fetcher:async()=>({ok:true,json:async()=>duplicated})}),/Paginação/);
 const changed=await map([{collection:'clientRegistry',id:'invalid',data:{clientNumber:'ABC',billingInstructions:'Alterada'}}],time);assert.notEqual(changed.sourceFingerprint,bad.sourceFingerprint);
 console.log('PASS: Firestore only, same readTime, pagination, session/cancellation, permissions, empty source and missing contracts fail closed.');
}finally{await server.close();}
