#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORT_DIR = 'migration-backups';
const timestampForFile = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const doc = (id, data) => ({
  id,
  path: `projects/test/databases/(default)/documents/transactions/${id}`,
  createTime: '2026-05-16T00:00:00Z',
  updateTime: '2026-05-16T00:00:00Z',
  data: {
    type: 'Entrada de Caixa / Contas a Receber',
    movement: 'Entrada',
    status: 'Pago',
    date: '2026-05-01',
    dueDate: '2026-05-10',
    paymentDate: '2026-05-10',
    client: 'Cliente Teste',
    cpfCnpj: '',
    clientNumber: '100',
    valuePaid: 0,
    valueReceived: 100,
    honorarios: 100,
    valorExtra: 0,
    totalCobranca: 100,
    ...data,
  },
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runResolver = (backupPath, outPath, extraArgs = []) => {
  execFileSync(process.execPath, [
    'scripts/resolve-client-number-conflicts.mjs',
    '--input',
    backupPath,
    '--out',
    outPath,
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  return JSON.parse(readFileSync(outPath, 'utf8'));
};

const main = () => {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = timestampForFile();
  const backupPath = resolve(`${REPORT_DIR}/client-number-conflicts-test-backup-${stamp}.json`);

  const documents = [
    doc('cpf-winner-1', {
      client: 'CPF Seguro',
      cpfCnpj: '111.111.111-11',
      nCliente: '929',
      clientNumber: '929',
    }),
    doc('cpf-winner-2', {
      client: 'CPF Seguro',
      cpfCnpj: '111.111.111-11',
      clientNumber: '929',
    }),
    doc('cpf-loser', {
      client: 'CPF Seguro',
      cpfCnpj: '111.111.111-11',
      clientNumber: '953',
    }),
    ...Array.from({ length: 6 }, (_, index) => doc(`name-winner-${index}`, {
      client: 'Nome Seguro LTDA',
      clientNumber: '138',
    })),
    doc('name-loser', {
      client: 'Nome Seguro LTDA',
      clientNumber: '1380',
    }),
    doc('manual-a', {
      client: 'Nome Manual LTDA',
      clientNumber: '200',
    }),
    doc('manual-b', {
      client: 'Nome Manual LTDA',
      clientNumber: '201',
    }),
  ];

  const backup = {
    generatedAt: '2026-05-16T00:00:00Z',
    projectId: 'test',
    database: '(default)',
    collections: [
      {
        name: 'transactions',
        count: documents.length,
        documents,
      },
    ],
  };

  writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);

  const defaultOut = resolve(`${REPORT_DIR}/client-number-conflicts-test-report-${stamp}.json`);
  const defaultReport = runResolver(backupPath, defaultOut);
  assert(defaultReport.counts.conflictGroups === 3, `Expected 3 conflict groups, got ${defaultReport.counts.conflictGroups}`);
  assert(defaultReport.counts.safeResolutions === 1, `Expected 1 default safe resolution, got ${defaultReport.counts.safeResolutions}`);
  assert(defaultReport.counts.manualReviewGroups === 2, `Expected 2 default manual groups, got ${defaultReport.counts.manualReviewGroups}`);
  assert(defaultReport.counts.transactionPatchesPlanned === 1, `Expected 1 default transaction patch, got ${defaultReport.counts.transactionPatchesPlanned}`);
  assert(defaultReport.resolutions[0]?.winner === '929', 'Expected CPF conflict to resolve to 929.');

  const nameOut = resolve(`${REPORT_DIR}/client-number-conflicts-test-name-report-${stamp}.json`);
  const nameReport = runResolver(backupPath, nameOut, ['--include-name-only']);
  assert(nameReport.counts.safeResolutions === 2, `Expected 2 safe resolutions with --include-name-only, got ${nameReport.counts.safeResolutions}`);
  assert(nameReport.counts.transactionPatchesPlanned === 2, `Expected 2 transaction patches with --include-name-only, got ${nameReport.counts.transactionPatchesPlanned}`);
  assert(nameReport.resolutions.some((item) => item.winner === '138'), 'Expected name-only trailing-zero conflict to resolve to 138.');

  console.log('Client number conflict resolver tests passed');
  console.log(`Backup: ${backupPath}`);
  console.log(`Report: ${defaultOut}`);
};

main();
