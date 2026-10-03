import assert from 'node:assert/strict';
import { DEFAULT_COLLECTIONS, collectBackupCollections, listCollection } from './export-firestore-data.mjs';

for (const name of ['transactions', 'jotformEvents', 'billingMonthlyReviews', 'billingIdentityLinks']) assert.ok(DEFAULT_COLLECTIONS.includes(name));
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
