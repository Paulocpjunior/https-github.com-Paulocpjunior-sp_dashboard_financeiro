#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
export const CHILD_COLLECTIONS = {
  billingMonthlyReviews: ['revisions'], billingIdentityLinks: ['revisions'], billingFollowUps: ['revisions'],
  boletoIssues: ['events'], boletoHistorySnapshots: ['chunks'], bankStatements: ['entries', 'imports'],
};
export const DEFAULT_COLLECTIONS = [
  'users', 'loginIndex', 'transactions', 'clientRegistry', 'billingProfiles', 'jotformEvents',
  'billingMonthlyReviews', 'billingIdentityLinks', 'billingFollowUps',
  'boletoIssues', 'boletoIssueLocks', 'boletoHistory', 'boletoHistorySnapshots', 'boletoHistoryUpdates',
  'boletoHistoryAudit', 'boletoReturnJobs', 'boletoSettlementAudit', 'boletoReconciliations',
  'boletoReconciliationPreviews', 'boletoReconciliationAudit', 'boletoReconciliationSettlements',
  'payableRecurrences', 'payableInviteSettings', 'payableOperations', 'payableAudit',
  'nativeEntryRequests', 'nativeEntryLocks', 'nativeEntryAudit', 'bankStatements', 'bankStatementAudit',
];
const REPORT_DIR = 'migration-backups';

const usage = `
Usage:
  node scripts/export-firestore-data.mjs [options]

Options:
  --project <id>        Firebase project id. Default: ${DEFAULT_PROJECT_ID}
  --collection <name>   Collection to export. Repeatable. Default: ${DEFAULT_COLLECTIONS.join(', ')}
  --out <path>          JSON backup path. Default: migration-backups/firestore-data-backup-<timestamp>.json
  --help                Show this help.

This script exports Firestore data to local JSON only. It does not modify Firebase.
Billing review and identity-link collections include their revisions, including histories whose parent document is missing.
`;

const parseArgs = (argv) => {
  const args = {
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    collections: [],
    out: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--collection') args.collections.push(argv[++index]);
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      console.log(usage.trim());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (args.collections.length === 0) args.collections = [...DEFAULT_COLLECTIONS];
  args.collections = [...new Set(args.collections.map((collection) => String(collection || '').trim()).filter(Boolean))];

  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const parseFirestoreValue = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  if (hasOwn(value, 'stringValue')) return value.stringValue;
  if (hasOwn(value, 'booleanValue')) return value.booleanValue;
  if (hasOwn(value, 'integerValue')) return Number(value.integerValue);
  if (hasOwn(value, 'doubleValue')) return Number(value.doubleValue);
  if (hasOwn(value, 'timestampValue')) return value.timestampValue;
  if (hasOwn(value, 'nullValue')) return null;
  if (hasOwn(value, 'arrayValue')) return (value.arrayValue.values || []).map(parseFirestoreValue);
  if (hasOwn(value, 'mapValue')) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nestedValue]) => [key, parseFirestoreValue(nestedValue)]),
    );
  }
  if (hasOwn(value, 'geoPointValue')) return value.geoPointValue;
  if (hasOwn(value, 'referenceValue')) return value.referenceValue;
  if (hasOwn(value, 'bytesValue')) return value.bytesValue;
  return undefined;
};

const parseFirestoreDocument = (document) => ({
  id: decodeURIComponent(document.name.split('/').pop() || ''),
  path: document.name,
  createTime: document.createTime,
  updateTime: document.updateTime,
  ...(!document.createTime && !document.updateTime ? { missing: true } : {}),
  data: Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, parseFirestoreValue(value)]),
  ),
});

const getAccessToken = () => {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN.trim();
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
};

const requestJson = async (url, token) => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore export failed (${response.status}) for ${url}: ${body.slice(0, 500)}`);
  }

  return response.json();
};

export const listCollection = async (projectId, collection, token, { showMissing = false, readTime } = {}) => {
  const docs = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: '300' });
    if (showMissing) params.set('showMissing', 'true');
    if (readTime) params.set('readTime', readTime);
    if (pageToken) params.set('pageToken', pageToken);
    const collectionPath = collection.split('/').map(encodeURIComponent).join('/');
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(DEFAULT_DATABASE)}/documents/${collectionPath}?${params.toString()}`;
    const payload = await requestJson(url, token);
    docs.push(...(payload.documents || []).map(parseFirestoreDocument));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  docs.sort((left, right) => left.id.localeCompare(right.id, 'pt-BR'));
  return docs;
};

export async function collectBackupCollections(projectId, names, token, list = listCollection, { readTime } = {}) {
  const collections = new Map();
  for (const name of names) {
    const children = CHILD_COLLECTIONS[name] || [];
    const revisioned = children.length > 0;
    const parents = await list(projectId, name, token, { showMissing: revisioned, readTime });
    const documents = parents.filter(document => !document.missing);
    collections.set(name, { name, count: documents.length, documents });
    if (revisioned) {
      for (const parent of parents) {
        // Use the original document path, not the display id (which is decoded).
        const prefix = `projects/${projectId}/databases/${DEFAULT_DATABASE}/documents/`;
        if (!parent.path.startsWith(`${prefix}${name}/`)) throw new Error('Unexpected backup parent path');
        for (const child of children) {
          const childPath = `${parent.path.slice(prefix.length)}/${child}`;
          const records = await list(projectId, childPath, token, { readTime });
          collections.set(childPath, { name: childPath, count: records.length, documents: records });
        }
      }
    }
  }
  return [...collections.values()];
}

const buildMarkdown = (backup) => {
  const lines = [
    '# Firestore Data Backup',
    '',
    `Generated at: ${backup.generatedAt}`,
    `Project: ${backup.projectId}`,
    `Database: ${backup.database}`,
    `Consistent read time: ${backup.readTime}`,
    'Scope: Firestore only. Storage objects and Firebase Auth accounts are NOT included.',
    `Total documents: ${backup.counts.totalDocuments}`,
    '',
    '## Collections',
    '',
  ];

  for (const collection of backup.collections) {
    lines.push(`- ${collection.name}: ${collection.count} documents`);
  }

  lines.push('', '## Restore Note', '', 'This file is a local JSON backup for review/manual recovery. It is not committed to Git.');
  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const stamp = timestampForFile();
  const outPath = resolve(args.out || `${REPORT_DIR}/firestore-data-backup-${stamp}.json`);
  const markdownPath = outPath.replace(/\.json$/i, '.md');

  mkdirSync(dirname(outPath), { recursive: true });

  const token = getAccessToken();
  const readTime = new Date().toISOString();
  const collections = await collectBackupCollections(args.projectId, args.collections, token, listCollection, { readTime });

  const backup = {
    schemaVersion: 2,
    readTime,
    scope: { firestore: args.collections, storageObjectsIncluded: false, authAccountsIncluded: false },
    generatedAt: new Date().toISOString(),
    projectId: args.projectId,
    database: DEFAULT_DATABASE,
    collections,
    counts: {
      collections: collections.length,
      totalDocuments: collections.reduce((sum, collection) => sum + collection.count, 0),
    },
  };

  const { verifyFinancialBackup } = await import('./verify-financial-backup.mjs');
  verifyFinancialBackup(backup);
  const bytes = `${JSON.stringify(backup, null, 2)}\n`;
  writeFileSync(outPath, bytes, { mode: 0o600 });
  writeFileSync(`${outPath}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${outPath.split('/').pop()}\n`, { mode: 0o600 });
  writeFileSync(markdownPath, buildMarkdown(backup), { mode: 0o600 });

  console.log(`Firestore data backup complete for ${args.projectId}`);
  console.log(`JSON backup: ${outPath}`);
  console.log(`Markdown summary: ${markdownPath}`);
  for (const collection of collections) {
    console.log(`${collection.name}: ${collection.count} documents`);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
