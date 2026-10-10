const test=require('node:test'),assert=require('node:assert/strict');
const {initial,effective,change,handleMaintenance}=require('./maintenance');
test('account codes survive edits; duplicate, stale and protected changes fail',()=>{
 const state=initial(),original=state.items.categories[0];
 const body={group:'categories',revision:0,id:original.id,label:'1 - Outros revisado',active:true,reason:'Revisão de descrição'};
 const {next}=change(state,body);
 assert.equal(next.items.categories[0].id,original.id);assert.equal(state.items.categories[0].label,original.label);
 assert.equal(effective(next).categories[0],body.label);
 for(const invalid of [{...body,label:'2 - Alterado'},{...body,id:'',label:original.label},{...body,revision:2},{...body,group:'banks'},{...body,reason:''}]) assert.throws(()=>change(state,invalid));
 const disabled=change(next,{...body,revision:1,active:false}).next;assert(!effective(disabled).categories.includes(body.label));
});
test('maintenance rechecks role inside transaction and atomically records audit',async()=>{
 const store=new Map(),writes=[];let profile={active:true,role:'admin'};
 const ref=path=>({path,get:async()=>({data:()=>store.get(path)})});
 const db={collection:p=>({doc:id=>ref(p+'/'+id)}),runTransaction:async fn=>{
  const pending=[];const result=await fn({get:async r=>({data:()=>r.path==='users/u'?profile:store.get(r.path)}),set:(r,v)=>pending.push([r.path,v]),create:(r,v)=>pending.push([r.path,v])});
  pending.forEach(([k,v])=>{store.set(k,v);writes.push(k);});return result;
 }};
 const input={group:'categories',revision:0,label:'999 - Nova conta',active:true,reason:'Novo fornecedor cadastrado'};
 const args={request:{method:'POST'},db,userRef:ref('users/u'),uid:'u',allowed:p=>p?.active&&p.role==='admin',readBody:async()=>Buffer.from(JSON.stringify(input)),reply:()=>{}};
 await handleMaintenance(args);assert.equal(store.get('financialSettings/nativeCatalog').revision,1);assert.equal(writes.filter(x=>x.startsWith('financialSettingsAudit/')).length,1);assert(!writes.some(x=>x.startsWith('transactions/')));
 await assert.rejects(()=>handleMaintenance(args),/outro administrador/);assert.equal(writes.length,2);
 profile={active:false,role:'admin'};input.revision=1;
 await assert.rejects(()=>handleMaintenance(args),/revogado/);assert.equal(writes.length,2);
});
test('inactive categories block recurrence even after rename; account identity remains stable',()=>{
 const {assertActiveCategory,sameAccount}=require('./maintenance');const s=initial();s.items.categories[0].active=false;
 assert.throws(()=>assertActiveCategory(s,'1 - Outro nome'),/inativada/);
 assert(sameAccount('01 - Nome anterior','1 - Nome atual'));assert(!sameAccount('2 - Nome','1 - Nome'));
});
