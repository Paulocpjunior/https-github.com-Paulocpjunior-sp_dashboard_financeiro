#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_DATABASE = '(default)';
const DEFAULT_MAPPING_PATH = 'migration-backups/recovery-email-map.json';
const DEFAULT_TECHNICAL_EMAIL_SUFFIXES = ['@auth.spcontabil.local', '.local'];
const REPORT_DIR = 'migration-backups';

const usage = `
Usage:
  node scripts/update-recovery-emails.mjs [options]

Options:
  --mapping <path>     JSON mapping file. Default: ${DEFAULT_MAPPING_PATH}
  --project <id>       Firebase project id. Default: ${DEFAULT_PROJECT_ID}
  --out <path>         JSON report path. Default: migration-backups/recovery-email-update-<timestamp>.json
  --apply              Apply changes. Without this flag the script only validates and reports.
  --technical-email-suffix <suffix>
                       Extra technical/local email suffix to reject. Repeatable.
  --help               Show this help.

Mapping format:
  {
    "users": [
      { "username": "raquel", "email": "raquel@real-domain.com.br" }
    ]
  }

You can also use an object map:
  {
    "raquel": "raquel@real-domain.com.br"
  }
`;

const parseArgs = (argv) => {
  const args = {
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    mapping: DEFAULT_MAPPING_PATH,
    out: '',
    apply: false,
    technicalEmailSuffixes: [...DEFAULT_TECHNICAL_EMAIL_SUFFIXES],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mapping') args.mapping = argv[++index];
    else if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--technical-email-suffix') args.technicalEmailSuffixes.push(argv[++index]);
    else if (arg === '--help' || arg === '-h') {
      console.log(usage.trim());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
};

const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const normalize = (value) => String(value || '').trim().toLowerCase();
const clean = (value) => String(value || '').trim();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const normalizeEmailSuffix = (suffix) => {
  const normalized = normalize(suffix);
  if (!normalized) return '';
  if (normalized.startsWith('@') || normalized.startsWith('.')) return normalized;
  return `@${normalized}`;
};
const normalizeEmailSuffixes = (suffixes) => [...new Set(suffixes.map(normalizeEmailSuffix).filter(Boolean))];
const isTechnicalEmail = (email, suffixes) => {
  const normalized = normalize(email);
  return Boolean(normalized) && suffixes.some((suffix) => normalized.endsWith(suffix));
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

const patchDocumentFields = async (projectId, documentPath, token, fields, fieldPaths) => {
  const params = new URLSearchParams();
  for (const fieldPath of fieldPaths) params.append('updateMask.fieldPaths', fieldPath);
  return requestJson(`${firestoreDocumentUrl(projectId, documentPath)}?${params.toString()}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)])),
    }),
  });
};

const exportFirebaseAuth = (projectId, stamp) => {
  mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = resolve(REPORT_DIR, `auth-export-${stamp}.json`);
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

const parseMapping = (mappingPath) => {
  if (!existsSync(mappingPath)) {
    throw new Error(`Mapping file not found: ${mappingPath}`);
  }

  const payload = JSON.parse(readFileSync(mappingPath, 'utf8'));
  const rows = Array.isArray(payload.users)
    ? payload.users.map((row) => ({
        username: row.username,
        userId: row.userId || row.uid || '',
        email: row.email || row.authEmail || '',
      }))
    : Object.entries(payload).map(([username, email]) => ({ username, userId: '', email }));

  return rows.map((row) => ({
    username: normalize(row.username),
    userId: clean(row.userId),
    email: normalize(row.email),
  }));
};

const validateEmail = (email, technicalEmailSuffixes) => {
  const errors = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push('invalid email format');
  }
  if (isTechnicalEmail(email, technicalEmailSuffixes)) {
    errors.push('email is technical/local');
  }
  if (email.endsWith('@empresa.com.br') || email.endsWith('@example.com') || email.endsWith('@example.com.br')) {
    errors.push('email looks like a placeholder');
  }
  return errors;
};

const updateAuthEmail = async (projectId, token, uid, email) =>
  requestJson(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, token, {
    method: 'POST',
    headers: {
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify({
      localId: uid,
      email,
      emailVerified: false,
    }),
  });

const buildPlan = ({ mappings, userDocs, loginIndexDocs, authUsers, technicalEmailSuffixes }) => {
  const usersById = new Map(userDocs.map((doc) => [doc.id, doc]));
  const usersByUsername = new Map(userDocs.map((doc) => [normalize(doc.data.username || doc.id), doc]));
  const loginIndexByUsername = new Map(loginIndexDocs.map((doc) => [normalize(doc.id), doc]));
  const errors = [];
  const warnings = [];
  const changes = [];
  const seenEmails = new Map();
  const seenTargets = new Set();

  for (const mapping of mappings) {
    const key = mapping.userId || mapping.username;
    const target = mapping.userId ? usersById.get(mapping.userId) : usersByUsername.get(mapping.username);

    if (!mapping.username && !mapping.userId) {
      errors.push({ code: 'MAPPING_TARGET_MISSING', message: 'Mapping row needs username or userId.', mapping });
      continue;
    }

    if (!target) {
      errors.push({ code: 'USER_NOT_FOUND', message: `No user found for ${key}.`, mapping });
      continue;
    }

    const username = normalize(target.data.username || target.id);
    const newEmail = mapping.email;
    const authUid = clean(target.data.authUid);
    const oldAuthEmail = normalize(target.data.authEmail || target.data.email);
    const oldProfileEmail = normalize(target.data.email);
    const emailErrors = validateEmail(newEmail, technicalEmailSuffixes);
    const duplicateEmailTarget = seenEmails.get(newEmail);
    const loginIndex = loginIndexByUsername.get(username);
    const authAccount = authUid ? authUsers.byUid.get(authUid) : null;
    const newEmailAccount = authUsers.byEmail.get(newEmail);

    if (seenTargets.has(target.id)) {
      errors.push({ code: 'DUPLICATE_TARGET', message: `User ${username} appears more than once in mapping.`, mapping });
      continue;
    }
    seenTargets.add(target.id);

    if (duplicateEmailTarget) {
      errors.push({
        code: 'DUPLICATE_NEW_EMAIL',
        message: `${newEmail} is mapped for both ${duplicateEmailTarget} and ${username}.`,
        username,
      });
    }
    seenEmails.set(newEmail, username);

    for (const error of emailErrors) {
      errors.push({ code: 'INVALID_NEW_EMAIL', message: `${newEmail}: ${error}.`, username });
    }

    if (!authUid) {
      errors.push({ code: 'AUTH_UID_MISSING', message: `User ${username} has no authUid.`, username });
    }
    if (!authAccount) {
      errors.push({ code: 'AUTH_ACCOUNT_NOT_FOUND', message: `Firebase Auth account not found for ${username}.`, username, authUid });
    }
    if (newEmailAccount && clean(newEmailAccount.localId || newEmailAccount.uid) !== authUid) {
      errors.push({
        code: 'NEW_EMAIL_ALREADY_IN_USE',
        message: `${newEmail} is already used by another Firebase Auth account.`,
        username,
        ownerUid: clean(newEmailAccount.localId || newEmailAccount.uid),
      });
    }
    if (!loginIndex) {
      errors.push({ code: 'LOGIN_INDEX_MISSING', message: `loginIndex/${username} is missing.`, username });
    }
    if (!oldAuthEmail) {
      errors.push({ code: 'OLD_AUTH_EMAIL_MISSING', message: `User ${username} has no current authEmail/email.`, username });
    }
    if (oldAuthEmail && !isTechnicalEmail(oldAuthEmail, technicalEmailSuffixes)) {
      warnings.push({
        code: 'CURRENT_EMAIL_IS_DELIVERABLE',
        message: `User ${username} already has a non-technical auth email. Verify this update is intentional.`,
        username,
        oldAuthEmail,
        newEmail,
      });
    }
    if (oldAuthEmail === newEmail && oldProfileEmail === newEmail) {
      warnings.push({
        code: 'NO_EMAIL_CHANGE',
        message: `User ${username} already uses ${newEmail}.`,
        username,
      });
    }

    changes.push({
      userId: target.id,
      username,
      authUid,
      oldAuthEmail,
      oldProfileEmail,
      newEmail,
      loginIndexPath: loginIndex ? `loginIndex/${loginIndex.id}` : '',
      authAccountFound: Boolean(authAccount),
      firestoreUserPath: `users/${target.id}`,
      userSnapshot: target,
      loginIndexSnapshot: loginIndex || null,
    });
  }

  return { changes, errors, warnings };
};

const writeJson = (path, payload) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  args.technicalEmailSuffixes = normalizeEmailSuffixes(args.technicalEmailSuffixes);

  const stamp = timestampForFile();
  const mappingPath = resolve(args.mapping);
  const reportPath = resolve(args.out || `${REPORT_DIR}/recovery-email-update-${stamp}.json`);
  const backupPath = resolve(REPORT_DIR, `recovery-email-update-backup-${stamp}.json`);

  const mappings = parseMapping(mappingPath);
  if (mappings.length === 0) {
    throw new Error(`Mapping file has no users: ${mappingPath}`);
  }

  const token = getAccessToken();
  const authExportPath = exportFirebaseAuth(args.projectId, stamp);

  try {
    const [userDocs, loginIndexDocs] = await Promise.all([
      listCollection(args.projectId, 'users', token),
      listCollection(args.projectId, 'loginIndex', token),
    ]);
    const authUsers = loadAuthUsers(authExportPath);
    const plan = buildPlan({
      mappings,
      userDocs,
      loginIndexDocs,
      authUsers,
      technicalEmailSuffixes: args.technicalEmailSuffixes,
    });

    const report = {
      generatedAt: new Date().toISOString(),
      projectId: args.projectId,
      mode: args.apply ? 'apply' : 'dry-run',
      mappingPath,
      counts: {
        mappings: mappings.length,
        changes: plan.changes.length,
        errors: plan.errors.length,
        warnings: plan.warnings.length,
      },
      errors: plan.errors,
      warnings: plan.warnings,
      changes: plan.changes.map(({ userSnapshot, loginIndexSnapshot, ...change }) => change),
    };

    if (plan.errors.length > 0) {
      writeJson(reportPath, report);
      console.log(`Recovery email update ${args.apply ? 'blocked' : 'dry-run blocked'} for ${args.projectId}`);
      console.log(`Report: ${reportPath}`);
      console.log(`Errors: ${plan.errors.length}`);
      process.exitCode = 1;
      return;
    }

    if (args.apply) {
      writeJson(backupPath, {
        generatedAt: new Date().toISOString(),
        projectId: args.projectId,
        mappingPath,
        documents: plan.changes.map((change) => ({
          user: {
            id: change.userSnapshot.id,
            path: change.userSnapshot.path,
            createTime: change.userSnapshot.createTime,
            updateTime: change.userSnapshot.updateTime,
            data: change.userSnapshot.data,
          },
          loginIndex: change.loginIndexSnapshot
            ? {
                id: change.loginIndexSnapshot.id,
                path: change.loginIndexSnapshot.path,
                createTime: change.loginIndexSnapshot.createTime,
                updateTime: change.loginIndexSnapshot.updateTime,
                data: change.loginIndexSnapshot.data,
              }
            : null,
          auth: {
            uid: change.authUid,
            oldEmail: change.oldAuthEmail,
            newEmail: change.newEmail,
          },
        })),
      });

      for (const change of plan.changes) {
        await updateAuthEmail(args.projectId, token, change.authUid, change.newEmail);
        const now = new Date().toISOString();
        await patchDocumentFields(
          args.projectId,
          `users/${encodeURIComponent(change.userId)}`,
          token,
          {
            authEmail: change.newEmail,
            email: change.newEmail,
            recoveryEmailUpdatedAt: now,
            updatedAt: now,
          },
          ['authEmail', 'email', 'recoveryEmailUpdatedAt', 'updatedAt'],
        );
        await patchDocumentFields(
          args.projectId,
          `loginIndex/${encodeURIComponent(change.username)}`,
          token,
          {
            uid: change.authUid,
            authEmail: change.newEmail,
            email: change.newEmail,
            updatedAt: now,
          },
          ['uid', 'authEmail', 'email', 'updatedAt'],
        );
      }

      report.backupPath = backupPath;
    }

    writeJson(reportPath, report);
    console.log(`Recovery email update ${args.apply ? 'applied' : 'dry-run complete'} for ${args.projectId}`);
    console.log(`Report: ${reportPath}`);
    if (args.apply) console.log(`Backup: ${backupPath}`);
    console.log(`Changes: ${plan.changes.length}`);
    console.log(`Warnings: ${plan.warnings.length}`);
  } finally {
    rmSync(authExportPath, { force: true });
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
