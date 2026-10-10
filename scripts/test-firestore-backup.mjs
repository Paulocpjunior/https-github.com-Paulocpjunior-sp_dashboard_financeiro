import assert from 'node:assert/strict';
import { DEFAULT_COLLECTIONS, CHILD_COLLECTIONS, collectBackupCollections, listCollection } from './export-firestore-data.mjs';

for (const name of ['transactions', 'jotformEvents', 'billingMonthlyReviews', 'billingIdentityLinks', 'billingFollowUps']) assert.ok(DEFAULT_COLLECTIONS.includes(name));
const followUps=await collectBackupCollections('test',['billingFollowUps'],'test',async(_project,name)=>name==='billingFollowUps'?[{path:'projects/test/databases/(default)/documents/billingFollowUps/task',id:'task',data:{revision:1}}]:[{id:'audit',data:{revision:1}}]);
assert.ok(followUps.some(c=>c.name==='billingFollowUps/task/revisions'&&c.count===1),'histórico da fila também deve entrar no backup');
const prefix = 'projects/test/databases/(default)/documents/';
const parent = { path: `${prefix}billingMonthlyReviews/2026-10%3Adoc`, id: '2026-10:doc', data: { revision: 2 } };
const orphan = { path: `${prefix}billingMonthlyReviews/orphan`, missing: true };
const calls = [];
const fake = async (_project, name, _token, options) => {
  calls.push({ name, options });
  if (name === 'billingMonthlyReviews') return [parent, orphan];
  if (name.endsWith('/revisions')) return [{ path: `${prefix}${name}/rev1`, data: { revision: 1 } }];
  return [];
};
const result = await collectBackupCollections('test', ['transactions', 'billingMonthlyReviews', 'billingIdentityLinks'], 'test', fake);
assert.equal(result.find(c => c.name === 'billingMonthlyReviews').count, 1);
assert.equal(result.find(c => c.name === 'billingMonthlyReviews/orphan/revisions').count, 1);
assert.equal(result.find(c => c.name === 'billingMonthlyReviews/2026-10%3Adoc/revisions').count, 1);
assert.equal(calls.find(c => c.name === 'billingMonthlyReviews').options.showMissing, true);
assert.equal(calls.find(c => c.name === 'transactions').options.showMissing, false);
assert.equal(result.find(c => c.name === 'billingIdentityLinks').count, 0);
await assert.rejects(collectBackupCollections('test', ['billingIdentityLinks'], 'test', async (_p, name) => {
  if (name === 'billingIdentityLinks') return [{ path: `${prefix}billingIdentityLinks/a` }];
  throw new Error('history denied');
}), /history denied/);

const originalFetch = globalThis.fetch;
const urls = [];
try {
  globalThis.fetch = async (url, options) => {
    urls.push(new URL(url));
    assert.equal(options.method, undefined); // GET only, no source writes.
    return { ok: true, json: async () => urls.length === 1 ? {
      documents: [{ name: `${prefix}billingMonthlyReviews/orphan` }], nextPageToken: 'page two',
    } : { documents: [{ name: `${prefix}billingMonthlyReviews/empty`, createTime: 't1', updateTime: 't2', fields: {} }] } };
  };
  const docs = await listCollection('test', 'billingMonthlyReviews/2026-10%3Adoc/revisions', 'test', { showMissing: true });
  assert.equal(docs.length, 2);
  assert.equal(docs.find(d => d.id === 'orphan').missing, true);
  assert.equal(docs.find(d => d.id === 'empty').missing, undefined);
  assert.ok(urls[0].pathname.includes('2026-10%253Adoc'));
  assert.equal(urls[1].searchParams.get('pageToken'), 'page two');
  assert.ok(urls.every(url => url.searchParams.get('showMissing') === 'true'));
} finally {
  globalThis.fetch = originalFetch;
}
console.log('OK: backup includes billing revisions, orphan histories, pagination and exact encoded paths; failures abort.');

for (const name of ['boletoIssues','boletoIssueLocks','boletoReconciliations','boletoReconciliationAudit','boletoReconciliationSettlements','payableRecurrences','payableAudit','nativeEntryRequests','nativeEntryLocks','nativeEntryAudit','bankStatementAudit']) assert.ok(DEFAULT_COLLECTIONS.includes(name), name);
const at='2026-10-10T12:00:00.000Z';
const expanded = await collectBackupCollections('test', Object.keys(CHILD_COLLECTIONS), 'test', async (_p,name,_t,options) => {
  assert.equal(options.readTime,at);
  if (!name.includes('/')) { assert.equal(options.showMissing,true); return [{path:prefix+name+'/orphan',missing:true}]; }
  return [{path:prefix+name+'/evidence',id:'evidence',data:{preserved:true}}];
}, {readTime:at});
for (const [parent,children] of Object.entries(CHILD_COLLECTIONS)) {
  assert.equal(expanded.find(c=>c.name===parent).count,0);
  for(const child of children) assert.equal(expanded.find(c=>c.name===parent+'/orphan/'+child).count,1);
}
try {
 globalThis.fetch=async url=> { assert.equal(new URL(url).searchParams.get('readTime'),at); return {ok:true,json:async()=>({documents:[]})}; };
 await listCollection('test','boletoIssues','test',{readTime:at});
} finally { globalThis.fetch=originalFetch; }
console.log('OK: financial collections, orphan events/chunks/statements and a shared readTime are preserved.');

const { verifyFinancialBackup } = await import('./verify-financial-backup.mjs');
const fixture={schemaVersion:2,projectId:'test',database:'(default)',readTime:at,scope:{firestore:['boletoIssues']},collections:[{name:'boletoIssues',count:1,documents:[{path:prefix+'boletoIssues/pilot'}]},{name:'boletoIssues/pilot/events',count:1,documents:[{path:prefix+'boletoIssues/pilot/events/created'}]}],counts:{collections:2,totalDocuments:2}};
assert.equal(verifyFinancialBackup(fixture).valid,true);
assert.throws(()=>verifyFinancialBackup({...fixture,collections:fixture.collections.slice(0,1)}),/Subcoleção ausente/);
assert.throws(()=>verifyFinancialBackup({...fixture,counts:{collections:2,totalDocuments:1}}),/Totais/);
assert.throws(()=>verifyFinancialBackup({...fixture,collections:[fixture.collections[0],fixture.collections[0]]}),/Coleção repetida/);
