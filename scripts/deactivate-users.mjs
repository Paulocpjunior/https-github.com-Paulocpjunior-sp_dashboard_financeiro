#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const REPORT_DIR = 'migration-backups';

const usage = `
Usage:
  node scripts/deactivate-users.mjs --username <name> [options]

Options:
  --username <name>   Username to deactivate. Repeatable.
  --reason <text>     Reason stored in the profile. Default: user_no_longer_part_of_team
  --project <id>      Firebase project id. Default: ${DEFAULT_PROJECT_ID}
  --out <path>        JSON report path. Default: migration-backups/user-deactivation-<timestamp>.json
  --apply             Apply changes. Without this flag the script only validates and reports.
  --help              Show this help.

This script does not delete users. In apply mode it marks Firestore users inactive
and disables the matching Firebase Auth accounts.
`;

const parseArgs = (argv) => {
  const args = {
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    usernames: [],
    reason: 'user_no_longer_part_of_team',
    out: '',
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--username') args.usernames.push(argv[++index]);
    else if (arg === '--reason') args.reason = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage.trim());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  args.usernames = [...new Set(args.usernames.map(normalizeUsername).filter(Boolean))];
  if (args.usernames.length === 0) throw new Error('At least one --username is required.');
  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const clean = (value) => String(value || '').trim();
const normalizeUsername = (value) => clean(value).toLowerCase().replace(/\s/g, '');
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
  return undefined;
};

const parseFirestoreDocument = (document) => ({
  id: decodeURIComponent(document.name.split('/').pop() || ''),
  path: document.name,
  createTime: document.createTime,
  updateTime: document.updateTime,
  data: Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, parseFirestoreValue(value)]),
  ),
});

const firestoreValue = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, firestoreValue(nestedValue)])),
      },
    };
  }
  return { stringValue: String(value) };
};

const getAccessToken = () => {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN.trim();
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
};

const requestJson = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) for ${url}: ${body.slice(0, 500)}`);
  }

  if (response.status === 204) return {};
  return response.json();
};

const firestoreCollectionUrl = (projectId, collection) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(DEFAULT_DATABASE)}/documents/${collection}`;

const firestoreDocumentUrl = (projectId, documentPath) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(DEFAULT_DATABASE)}/documents/${documentPath}`;

const listCollection = async (projectId, collection, token) => {
  const docs = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: '300' });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await requestJson(`${firestoreCollectionUrl(projectId, collection)}?${params.toString()}`, token);
    docs.push(...(payload.documents || []).map(parseFirestoreDocument));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  return docs;
};

const patchDocumentFields = async (projectId, documentPath, token, fields) => {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) params.append('updateMask.fieldPaths', fieldPath);

  return requestJson(`${firestoreDocumentUrl(projectId, documentPath)}?${params.toString()}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)])),
    }),
  });
};

const updateAuthDisabled = async (projectId, token, uid, disabled) =>
  requestJson(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, token, {
    method: 'POST',
    headers: {
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify({
      localId: uid,
      disableUser: disabled,
    }),
  });

const buildMarkdown = (report) => {
  const lines = [
    '# User Deactivation',
    '',
    `Generated at: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `Mode: ${report.mode}`,
    `Reason: ${report.reason}`,
    '',
    '## Counts',
    '',
    `- Requested: ${report.counts.requested}`,
    `- Planned: ${report.counts.planned}`,
    `- Applied: ${report.counts.applied}`,
    `- Errors: ${report.counts.errors}`,
    '',
    '## Changes',
    '',
  ];

  for (const change of report.changes) {
    lines.push(`- ${change.username}: active ${change.oldActive} -> false, status ${JSON.stringify(change.oldStatus)} -> "blocked", auth disabled: ${Boolean(change.authUid)}`);
  }

  if (report.errors.length > 0) {
    lines.push('', '## Errors', '');
    for (const error of report.errors) lines.push(`- ${error.username || 'unknown'}: ${error.message}`);
  }

  lines.push(
    '',
    '## Safety',
    '',
    report.mode === 'dry-run'
      ? 'Dry-run only. No Firebase documents or Auth accounts were changed.'
      : 'Apply mode was used. Users were not deleted; profiles and backup data remain available.',
  );

  return `${lines.join('\n')}\n`;
};

const writeJson = (path, payload) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const stamp = timestampForFile();
  const outPath = resolve(args.out || `${REPORT_DIR}/user-deactivation-${stamp}.json`);
  const backupPath = resolve(REPORT_DIR, `user-deactivation-backup-${stamp}.json`);
  const token = getAccessToken();
  const [userDocs, loginIndexDocs] = await Promise.all([
    listCollection(args.projectId, 'users', token),
    listCollection(args.projectId, 'loginIndex', token),
  ]);

  const usersByUsername = new Map(userDocs.map((doc) => [normalizeUsername(doc.data.username || doc.id), doc]));
  const loginIndexByUsername = new Map(loginIndexDocs.map((doc) => [normalizeUsername(doc.id), doc]));
  const changes = [];
  const errors = [];

  for (const username of args.usernames) {
    const userDoc = usersByUsername.get(username);
    if (!userDoc) {
      errors.push({ username, message: 'User not found.' });
      continue;
    }

    changes.push({
      username,
      userId: userDoc.id,
      authUid: clean(userDoc.data.authUid),
      authEmail: clean(userDoc.data.authEmail || userDoc.data.email),
      oldActive: userDoc.data.active === true,
      oldStatus: userDoc.data.status || '',
      firestoreUserPath: `users/${userDoc.id}`,
      loginIndexPath: loginIndexByUsername.has(username) ? `loginIndex/${username}` : '',
      userSnapshot: userDoc,
      loginIndexSnapshot: loginIndexByUsername.get(username) || null,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    projectId: args.projectId,
    mode: args.apply ? 'apply' : 'dry-run',
    reason: args.reason,
    backupPath: args.apply ? backupPath : '',
    counts: {
      requested: args.usernames.length,
      planned: changes.length,
      applied: 0,
      errors: errors.length,
    },
    changes: changes.map(({ userSnapshot, loginIndexSnapshot, ...change }) => change),
    errors,
  };

  if (args.apply && changes.length > 0) {
    writeJson(backupPath, {
      generatedAt: new Date().toISOString(),
      projectId: args.projectId,
      reason: args.reason,
      users: changes.map((change) => ({
        user: change.userSnapshot,
        loginIndex: change.loginIndexSnapshot,
      })),
    });

    for (const change of changes) {
      try {
        const now = new Date().toISOString();
        if (change.authUid) await updateAuthDisabled(args.projectId, token, change.authUid, true);
        await patchDocumentFields(
          args.projectId,
          `users/${encodeURIComponent(change.userId)}`,
          token,
          {
            active: false,
            status: 'blocked',
            accessRevokedAt: now,
            accessRevokedReason: args.reason,
            updatedAt: now,
          },
        );
        report.counts.applied += 1;
      } catch (error) {
        report.counts.errors += 1;
        report.errors.push({
          username: change.username,
          userId: change.userId,
          message: error.message || String(error),
        });
      }
    }
  }

  writeJson(outPath, report);
  writeFileSync(outPath.replace(/\.json$/i, '.md'), buildMarkdown(report));

  console.log(`User deactivation ${report.mode} complete for ${args.projectId}`);
  console.log(`Report: ${outPath}`);
  if (args.apply) console.log(`Backup: ${backupPath}`);
  console.log(`Planned: ${report.counts.planned}`);
  console.log(`Applied: ${report.counts.applied}`);
  console.log(`Errors: ${report.counts.errors}`);

  if (report.counts.errors > 0) process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
