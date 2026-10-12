const test=require('node:test'),assert=require('node:assert/strict');
const {compile,lookup,importCatalog}=require('./communication-catalog');
const input=rows=>({format:'boleto-payers-v1',sourceName:'synthetic.xls',sourceSha256:'a'.repeat(64),rows});
test('catalog keeps every normalized email and blocks ambiguous or incomplete identities',()=>{
 const c=compile(input([{document:'529.982.247-25',name:'A',emails:['a@example.com','A@example.com','b@example.com']},{document:'11111111111',name:'B',emails:[]},{document:'22222222222',name:'C',emails:['x@example.com']},{document:'22222222222',name:'D',emails:['y@example.com']}]));
 assert.deepEqual(c.records['52998224725'].emails,['a@example.com','b@example.com']);assert.equal(c.blocked,2);assert.deepEqual(c.records['22222222222'].emails,[]);
 assert.throws(()=>compile(input([{document:'123',emails:['a@example.com']}])));
});
test('import is audited, revision protected and cannot send or change ledger',async()=>{
 const store=new Map(),ref=path=>({path,get:async()=>({data:()=>store.get(path)})});store.set('users/admin',{active:true});
 const db={collection:n=>({doc:id=>ref(n+'/'+id)}),runTransaction:async f=>f({get:r=>r.get(),set:(r,v)=>store.set(r.path,v),create:(r,v)=>store.set(r.path,v)})};
 const data=input([{document:'52998224725',name:'A',emails:['a@example.com']}]),args={db,input:data,uid:'admin',userRef:ref('users/admin'),allowed:p=>p?.active,reason:'Fonte conferida',expectedRevision:null,reviewToken:compile(data).revision,now:()=>new Date('2026-10-12T15:00:00Z')};
 await importCatalog(args);assert.deepEqual((await lookup(db,'52998224725')).emails,['a@example.com']);assert.equal(store.size,3);
 await assert.rejects(importCatalog(args),/alterado/);store.set('users/admin',{active:false});await assert.rejects(importCatalog({...args,expectedRevision:compile(data).revision}),/revogado/);
 assert(![...store.keys()].some(k=>k.startsWith('transactions')||k.startsWith('financialCommunications/')));
});
