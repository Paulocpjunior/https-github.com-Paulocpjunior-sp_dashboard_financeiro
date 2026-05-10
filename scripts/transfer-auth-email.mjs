#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const REPORT_DIR = 'migration-backups';
const TECHNICAL_AUTH_DOMAIN = '@auth.spcontabil.local';

const usage = `
Usage:
  node scripts/transfer-auth-email.mjs --from-username <source> --to-username <target> --email <email> [options]

Options:
  --from-username <name>  Username that currently owns the email.
  --to-username <name>    Username that should receive the email.
  --email <email>         Deliverable email to transfer.
  --reason <text>         Reason stored in profile notes. Default: email_transferred_to_admin
  --project <id>          Firebase project id. Default: ${DEFAULT_PROJECT_ID}
  --out <path>            JSON report path. Default: migration-backups/auth-email-transfer-<timestamp>.json
  --apply                 Apply changes. Without this flag the script only validates and reports.
  --help                  Show this help.

This script does not delete users. In apply mode it moves the email in Firebase
Auth, updates users/loginIndex, and disables the source account.
`;

const clean = (value) => String(value || '').trim();
const normalize = (value) => clean(value).toLowerCase();
const normalizeUsername = (value) => normalize(value).replace(/\s/g, '');
const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const parseArgs = (argv) => {
  const args = {
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    fromUsername: '',
    toUsername: '',
    email: '',
    reason: 'email_transferred_to_admin',
    out: '',
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from-username') args.fromUsername = normalizeUsername(argv[++index]);
    else if (arg === '--to-username') args.toUsername = normalizeUsername(argv[++index]);
    else if (arg === '--email') args.email = normalize(argv[++index]);
    else if (arg === '--reason') args.reason = clean(argv[++index]);
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

  if (!args.fromUsername) throw new Error('--from-username is required.');
  if (!args.toUsername) throw new Error('--to-username is required.');
  if (args.fromUsername === args.toUsername) throw new Error('--from-username and --to-username must be different.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.email)) throw new Error('--email must be a valid email.');
  if (args.email.endsWith(TECHNICAL_AUTH_DOMAIN) || args.email.endsWith('.local')) {
    throw new Error('--email must be deliverable, not a technical/local email.');
  }

  return args;
};

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

const updateAuthAccount = async (projectId, token, uid, fields) =>
  requestJson(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, token, {
    method: 'POST',
    headers: {
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify({
      localId: uid,
      ...fields,
    }),
  });

const exportFirebaseAuth = (projectId, stamp) => {
  mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = resolve(REPORT_DIR, `auth-transfer-export-${stamp}.json`);
  execFileSync('firebase', ['auth:export', outputPath, '--format=json', '--project', projectId], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return outputPath;
};

const loadAuthUsers = (path) => {
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  const users = Array.isArray(payload) ? payload : payload.users || [];
  const byUid = new Map();
  const byEmail = new Map();

  for (const account of users) {
    const uid = clean(account.localId || account.uid);
    const email = normalize(account.email);
    if (uid) byUid.set(uid, account);
    if (email) byEmail.set(email, account);
  }

  return { users, byUid, byEmail };
};

const safeAuthAccount = (account) => account
  ? {
      uid: clean(account.localId || account.uid),
      email: account.email || '',
      disabled: account.disabled === true,
    }
  : null;

const buildMarkdown = (report) => {
  const lines = [
    '# Auth Email Transfer',
    '',
    `Generated at: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `Mode: ${report.mode}`,
    `Email: ${report.email}`,
    `From: ${report.fromUsername}`,
    `To: ${report.toUsername}`,
    '',
    '## Plan',
    '',
    `- Source user: ${report.plan.sourceUserId || 'not found'}`,
    `- Target user: ${report.plan.targetUserId || 'not found'}`,
    `- Source archive auth email: ${report.plan.sourceArchiveEmail || 'not planned'}`,
    `- Target will be active admin: ${report.plan.targetWillBeAdmin ? 'yes' : 'no'}`,
    '',
    '## Counts',
    '',
    `- Errors: ${report.counts.errors}`,
    `- Applied steps: ${report.counts.appliedSteps}`,
    '',
  ];

  if (report.errors.length > 0) {
    lines.push('## Errors', '');
    for (const error of report.errors) lines.push(`- ${error.code}: ${error.message}`);
    lines.push('');
  }

  if (report.appliedSteps.length > 0) {
    lines.push('## Applied Steps', '');
    for (const step of report.appliedSteps) lines.push(`- ${step}`);
    lines.push('');
  }

  lines.push(
    '## Safety',
    '',
    report.mode === 'dry-run'
      ? 'Dry-run only. No Firebase Auth accounts or Firestore documents were changed.'
      : 'Apply mode was used. No users were deleted; source profile was disabled and preserved.',
  );

  return `${lines.join('\n')}\n`;
};

const writeReport = (path, report) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.replace(/\.json$/i, '.md'), buildMarkdown(report));
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const stamp = timestampForFile();
  const outPath = resolve(args.out || `${REPORT_DIR}/auth-email-transfer-${stamp}.json`);
  const backupPath = resolve(REPORT_DIR, `auth-email-transfer-backup-${stamp}.json`);
  const authExportPath = exportFirebaseAuth(args.projectId, stamp);

  try {
    const token = getAccessToken();
    const [userDocs, loginIndexDocs] = await Promise.all([
      listCollection(args.projectId, 'users', token),
      listCollection(args.projectId, 'loginIndex', token),
    ]);
    const authUsers = loadAuthUsers(authExportPath);
    const usersByUsername = new Map(userDocs.map((doc) => [normalizeUsername(doc.data.username || doc.id), doc]));
    const loginIndexByUsername = new Map(loginIndexDocs.map((doc) => [normalizeUsername(doc.id), doc]));
    const sourceUser = usersByUsername.get(args.fromUsername);
    const targetUser = usersByUsername.get(args.toUsername);
    const errors = [];

    const sourceAuthUid = clean(sourceUser?.data.authUid);
    const targetAuthUid = clean(targetUser?.data.authUid);
    const sourceAuthAccount = sourceAuthUid ? authUsers.byUid.get(sourceAuthUid) : null;
    const targetAuthAccount = targetAuthUid ? authUsers.byUid.get(targetAuthUid) : null;
    const currentEmailOwner = authUsers.byEmail.get(args.email);
    const sourceArchiveEmail = sourceAuthUid
      ? `${args.fromUsername.replace(/[^a-z0-9._-]/g, '')}-transfer-${sourceAuthUid.slice(0, 8).toLowerCase()}${TECHNICAL_AUTH_DOMAIN}`
      : '';
    const archiveEmailOwner = sourceArchiveEmail ? authUsers.byEmail.get(sourceArchiveEmail) : null;

    if (!sourceUser) errors.push({ code: 'SOURCE_USER_NOT_FOUND', message: `No user found for ${args.fromUsername}.` });
    if (!targetUser) errors.push({ code: 'TARGET_USER_NOT_FOUND', message: `No user found for ${args.toUsername}.` });
    if (sourceUser && !sourceAuthUid) errors.push({ code: 'SOURCE_AUTH_UID_MISSING', message: `${args.fromUsername} has no authUid.` });
    if (targetUser && !targetAuthUid) errors.push({ code: 'TARGET_AUTH_UID_MISSING', message: `${args.toUsername} has no authUid.` });
    if (sourceAuthUid && !sourceAuthAccount) errors.push({ code: 'SOURCE_AUTH_ACCOUNT_NOT_FOUND', message: `Firebase Auth account not found for ${args.fromUsername}.` });
    if (targetAuthUid && !targetAuthAccount) errors.push({ code: 'TARGET_AUTH_ACCOUNT_NOT_FOUND', message: `Firebase Auth account not found for ${args.toUsername}.` });
    if (!currentEmailOwner) {
      errors.push({ code: 'EMAIL_OWNER_NOT_FOUND', message: `${args.email} is not currently used by a Firebase Auth account.` });
    } else if (clean(currentEmailOwner.localId || currentEmailOwner.uid) !== sourceAuthUid) {
      errors.push({
        code: 'EMAIL_NOT_OWNED_BY_SOURCE',
        message: `${args.email} belongs to another Firebase Auth account, not ${args.fromUsername}.`,
        ownerUid: clean(currentEmailOwner.localId || currentEmailOwner.uid),
      });
    }
    if (archiveEmailOwner && clean(archiveEmailOwner.localId || archiveEmailOwner.uid) !== sourceAuthUid) {
      errors.push({
        code: 'ARCHIVE_EMAIL_ALREADY_IN_USE',
        message: `${sourceArchiveEmail} is already used by another Firebase Auth account.`,
        ownerUid: clean(archiveEmailOwner.localId || archiveEmailOwner.uid),
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      projectId: args.projectId,
      mode: args.apply ? 'apply' : 'dry-run',
      reason: args.reason,
      fromUsername: args.fromUsername,
      toUsername: args.toUsername,
      email: args.email,
      backupPath: args.apply ? backupPath : '',
      counts: {
        errors: errors.length,
        appliedSteps: 0,
      },
      plan: {
        sourceUserId: sourceUser?.id || '',
        targetUserId: targetUser?.id || '',
        sourceAuthUid,
        targetAuthUid,
        sourceCurrentAuthEmail: sourceUser?.data.authEmail || sourceUser?.data.email || '',
        targetCurrentAuthEmail: targetUser?.data.authEmail || targetUser?.data.email || '',
        sourceArchiveEmail,
        sourceWillBeDisabled: true,
        targetWillBeAdmin: true,
        sourceLoginIndexPath: loginIndexByUsername.has(args.fromUsername) ? `loginIndex/${args.fromUsername}` : '',
        targetLoginIndexPath: loginIndexByUsername.has(args.toUsername) ? `loginIndex/${args.toUsername}` : '',
        currentEmailOwner: safeAuthAccount(currentEmailOwner),
        sourceAuthAccount: safeAuthAccount(sourceAuthAccount),
        targetAuthAccount: safeAuthAccount(targetAuthAccount),
      },
      appliedSteps: [],
      errors,
    };

    if (errors.length > 0) {
      writeReport(outPath, report);
      console.log(`Auth email transfer ${report.mode} blocked for ${args.projectId}`);
      console.log(`Report: ${outPath}`);
      console.log(`Errors: ${errors.length}`);
      process.exitCode = 1;
      return;
    }

    if (args.apply) {
      writeFileSync(
        backupPath,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            projectId: args.projectId,
            reason: args.reason,
            sourceUser,
            targetUser,
            sourceLoginIndex: loginIndexByUsername.get(args.fromUsername) || null,
            targetLoginIndex: loginIndexByUsername.get(args.toUsername) || null,
            sourceAuthAccount: safeAuthAccount(sourceAuthAccount),
            targetAuthAccount: safeAuthAccount(targetAuthAccount),
          },
          null,
          2,
        )}\n`,
      );

      const now = new Date().toISOString();

      await updateAuthAccount(args.projectId, token, sourceAuthUid, {
        email: sourceArchiveEmail,
        emailVerified: false,
        disableUser: true,
      });
      report.appliedSteps.push(`Moved source auth email to ${sourceArchiveEmail} and disabled ${args.fromUsername}.`);

      await patchDocumentFields(
        args.projectId,
        `users/${encodeURIComponent(sourceUser.id)}`,
        token,
        {
          active: false,
          status: 'blocked',
          email: '',
          authEmail: sourceArchiveEmail,
          accessRevokedAt: now,
          accessRevokedReason: args.reason,
          emailTransferredToUsername: args.toUsername,
          emailTransferredToUserId: targetUser.id,
          emailTransferredValue: args.email,
          updatedAt: now,
        },
      );
      report.appliedSteps.push(`Updated source profile users/${sourceUser.id}.`);

      await patchDocumentFields(
        args.projectId,
        `loginIndex/${encodeURIComponent(args.fromUsername)}`,
        token,
        {
          uid: sourceAuthUid,
          authEmail: sourceArchiveEmail,
          email: sourceArchiveEmail,
          updatedAt: now,
        },
      );
      report.appliedSteps.push(`Updated source loginIndex/${args.fromUsername}.`);

      await updateAuthAccount(args.projectId, token, targetAuthUid, {
        email: args.email,
        emailVerified: false,
        disableUser: false,
      });
      report.appliedSteps.push(`Moved ${args.email} to target auth account ${args.toUsername}.`);

      await patchDocumentFields(
        args.projectId,
        `users/${encodeURIComponent(targetUser.id)}`,
        token,
        {
          active: true,
          status: 'approved',
          role: 'admin',
          email: args.email,
          authEmail: args.email,
          recoveryEmailUpdatedAt: now,
          emailTransferredFromUsername: args.fromUsername,
          emailTransferredFromUserId: sourceUser.id,
          previousAuthEmail: report.plan.targetCurrentAuthEmail,
          updatedAt: now,
        },
      );
      report.appliedSteps.push(`Updated target profile users/${targetUser.id}.`);

      await patchDocumentFields(
        args.projectId,
        `loginIndex/${encodeURIComponent(args.toUsername)}`,
        token,
        {
          uid: targetAuthUid,
          authEmail: args.email,
          email: args.email,
          updatedAt: now,
        },
      );
      report.appliedSteps.push(`Updated target loginIndex/${args.toUsername}.`);

      report.counts.appliedSteps = report.appliedSteps.length;
    }

    writeReport(outPath, report);

    console.log(`Auth email transfer ${report.mode} complete for ${args.projectId}`);
    console.log(`Report: ${outPath}`);
    if (args.apply) console.log(`Backup: ${backupPath}`);
    console.log(`Errors: ${report.counts.errors}`);
    console.log(`Applied steps: ${report.counts.appliedSteps}`);
  } finally {
    rmSync(authExportPath, { force: true });
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
