#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0888019226';
const DEFAULT_BACKUP_ROOT = '../backups';
const REPORT_DIR = 'migration-backups';
const CODE_BACKUP_BASENAME = 'sp_dashboard_financeiro';

const usage = `
Usage:
  node scripts/pre-maintenance-check.mjs [options]

Options:
  --project <id>          Firebase project id. Default: ${DEFAULT_PROJECT_ID}
  --backup-root <path>    Code backup directory. Default: ${DEFAULT_BACKUP_ROOT}
  --out <path>            Summary report path. Default: migration-backups/pre-maintenance-<timestamp>.json
  --skip-code-backup      Do not create the local code archive.
  --skip-firestore        Do not export Firestore data.
  --skip-auth-audit       Do not run Firebase Auth/Firestore audit.
  --help                  Show this help.

This command is read-only for Firebase. It creates local backups/reports before data maintenance.
`;

const parseArgs = (argv) => {
  const args = {
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    backupRoot: DEFAULT_BACKUP_ROOT,
    out: '',
    skipCodeBackup: false,
    skipFirestore: false,
    skipAuthAudit: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project') args.projectId = argv[++index];
    else if (arg === '--backup-root') args.backupRoot = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--skip-code-backup') args.skipCodeBackup = true;
    else if (arg === '--skip-firestore') args.skipFirestore = true;
    else if (arg === '--skip-auth-audit') args.skipAuthAudit = true;
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

const runCommand = (command, args, options = {}) => {
  const startedAt = new Date().toISOString();
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      command: [command, ...args].join(' '),
      status: 'passed',
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout,
      stderr: '',
    };
  } catch (error) {
    return {
      command: [command, ...args].join(' '),
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || '',
    };
  }
};

const writeJson = (path, payload) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
};

const buildMarkdown = (report) => {
  const lines = [
    '# Pre-Maintenance Check',
    '',
    `Generated at: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `Status: ${report.status}`,
    '',
    '## Outputs',
    '',
    `- Code backup: ${report.outputs.codeBackup || 'skipped'}`,
    `- Firestore backup: ${report.outputs.firestoreBackup || 'skipped'}`,
    `- Auth audit: ${report.outputs.authAudit || 'skipped'}`,
    '',
    '## Steps',
    '',
  ];

  for (const step of report.steps) {
    lines.push(`- ${step.name}: ${step.status}`);
  }

  lines.push('', '## Notes', '', 'All generated data files are local operational artifacts and should remain outside Git.');
  return `${lines.join('\n')}\n`;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const stamp = timestampForFile();
  const cwd = process.cwd();
  const reportPath = resolve(args.out || `${REPORT_DIR}/pre-maintenance-${stamp}.json`);
  const markdownPath = reportPath.replace(/\.json$/i, '.md');
  const backupRoot = resolve(args.backupRoot);
  const firestoreBackupPath = resolve(`${REPORT_DIR}/firestore-data-backup-${stamp}-pre-maintenance.json`);
  const authAuditPath = resolve(`${REPORT_DIR}/firestore-auth-audit-${stamp}-pre-maintenance.json`);
  const codeBackupPath = resolve(backupRoot, `${CODE_BACKUP_BASENAME}-backup-${stamp}-pre-maintenance.tar.gz`);

  const report = {
    generatedAt: new Date().toISOString(),
    projectId: args.projectId,
    repository: {
      cwd,
      directory: basename(cwd),
    },
    status: 'passed',
    outputs: {},
    steps: [],
  };

  const pushStep = (name, result, outputKey, outputPath) => {
    report.steps.push({ name, ...result });
    if (result.status === 'passed' && outputKey) report.outputs[outputKey] = outputPath;
    if (result.status !== 'passed') report.status = 'failed';
    writeJson(reportPath, report);
    writeFileSync(markdownPath, buildMarkdown(report));
  };

  mkdirSync(REPORT_DIR, { recursive: true });

  if (!args.skipCodeBackup) {
    mkdirSync(backupRoot, { recursive: true });
    pushStep(
      'code backup',
      runCommand('tar', [
        '--exclude=./node_modules',
        '--exclude=./dist',
        '--exclude=./.git',
        '--exclude=./migration-backups',
        '-czf',
        codeBackupPath,
        '-C',
        cwd,
        '.',
      ]),
      'codeBackup',
      codeBackupPath,
    );
  } else {
    pushStep('code backup', { status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), command: '', stdout: '', stderr: '' });
  }

  if (!args.skipFirestore && report.status === 'passed') {
    pushStep(
      'firestore backup',
      runCommand(process.execPath, [
        'scripts/export-firestore-data.mjs',
        '--project',
        args.projectId,
        '--out',
        firestoreBackupPath,
      ]),
      'firestoreBackup',
      firestoreBackupPath,
    );
  } else if (args.skipFirestore) {
    pushStep('firestore backup', { status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), command: '', stdout: '', stderr: '' });
  }

  if (!args.skipAuthAudit && report.status === 'passed') {
    pushStep(
      'auth audit',
      runCommand(process.execPath, [
        'scripts/audit-firestore-auth.mjs',
        '--project',
        args.projectId,
        '--export-auth',
        '--out',
        authAuditPath,
      ]),
      'authAudit',
      authAuditPath,
    );
  } else if (args.skipAuthAudit) {
    pushStep('auth audit', { status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), command: '', stdout: '', stderr: '' });
  }

  writeJson(reportPath, report);
  writeFileSync(markdownPath, buildMarkdown(report));

  console.log(`Pre-maintenance check ${report.status} for ${args.projectId}`);
  console.log(`Summary: ${reportPath}`);
  console.log(`Markdown: ${markdownPath}`);
  for (const [key, value] of Object.entries(report.outputs)) {
    console.log(`${key}: ${value}`);
  }

  if (report.status !== 'passed') process.exit(1);
};

main();
