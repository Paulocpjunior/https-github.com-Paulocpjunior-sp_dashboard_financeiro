const test=require('node:test'),assert=require('node:assert/strict');
const {initial,change,handle}=require('./communication-settings');
const body=()=>({revision:0,offsets:[0,-3],payableRecipients:['TESTE@example.com'],enabled:false,reason:'Configuração fictícia'});
test('settings require explicit days, recipient validation and never enable sending',()=>{
 assert.deepEqual(initial().offsets,[]);assert.deepEqual(change(initial(),{...body(),offsets:[]}).offsets,[]);const next=change(initial(),body());assert.equal(next.enabled,false);assert.deepEqual(next.offsets,[-3,0]);assert.deepEqual(next.payableRecipients,['teste@example.com']);
 for(const patch of [{enabled:true},{offsets:[1]},{offsets:[-31]},{offsets:[0,0]},{offsets:['0']},{revision:1},{reason:'x'},{payableRecipients:['a@b.com','A@b.com']},{payableRecipients:['a@b.com\r\nBcc: c@d.com']}])assert.throws(()=>change(initial(),{...body(),...patch}));
});
test('settings persist atomically with audit and recheck admin; stale writes and invalid method fail',async()=>{
 const data=new Map();let active=true;
 const ref=path=>({path,get:async()=>({data:()=>path==='users/u'?{active}:data.get(path)})});
 const db={collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:async fn=>{let writes=false;const pending=[];const result=await fn({get:async r=>{assert(!writes);return r.get();},set:(r,v)=>{writes=true;pending.push([r.path,v]);},create:(r,v)=>{writes=true;pending.push([r.path,v]);}});pending.forEach(([k,v])=>data.set(k,v));return result;}};
 let output;const args={request:{method:'POST'},db,userRef:ref('users/u'),uid:'u',allowed:p=>p?.active===true,readBody:async()=>Buffer.from(JSON.stringify(body())),reply:r=>output=r,env:{}};
 await handle(args);assert.equal(output.revision,1);assert.equal(output.channel.configured,false);assert.equal(data.size,2);assert([...data.keys()].every(k=>k.startsWith('financialSettings')));
 await assert.rejects(()=>handle(args),/Recarregue/);assert.equal(data.size,2);
 active=false;await assert.rejects(()=>handle(args),/revogado/);await assert.rejects(()=>handle({...args,request:{method:'GET'}}),/revogado/);
 active=true;await handle({...args,request:{method:'GET'}});assert.equal(output.revision,1);await assert.rejects(()=>handle({...args,request:{method:'DELETE'}}),/Método/);
});
