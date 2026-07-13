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
    status: 'Pendente',
    date: '2026-05-01',
    dueDate: '2026-05-10',
    paymentDate: '',
    client: 'Cliente Teste',
    valuePaid: 0,
    valueReceived: 0,
    honorarios: 100,
    valorExtra: 0,
    totalCobranca: 100,
    ...data,
  },
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const main = () => {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = timestampForFile();
  const backupPath = resolve(`${REPORT_DIR}/client-registry-test-backup-${stamp}.json`);
  const outPath = resolve(`${REPORT_DIR}/client-registry-test-report-${stamp}.json`);

  const backup = {
    generatedAt: '2026-05-16T00:00:00Z',
    projectId: 'test',
    database: '(default)',
    collections: [
      {
        name: 'transactions',
        count: 8,
        documents: [
          doc('ready-source', {
            client: 'Empresa Pronta LTDA',
            cpfCnpj: '11.111.111/0001-11',
            nCliente: '0007',
            clientNumber: '0007',
          }),
          doc('ready-missing-number', {
            client: 'Empresa Pronta LTDA',
            cpfCnpj: '11.111.111/0001-11',
            clientNumber: '',
          }),
          doc('conflict-a', {
            client: 'Empresa Conflito LTDA',
            cpfCnpj: '22.222.222/0001-22',
            clientNumber: '8',
          }),
          doc('conflict-b', {
            client: 'Empresa Conflito LTDA',
            cpfCnpj: '22.222.222/0001-22',
            clientNumber: '9',
          }),
          doc('name-ready-source', {
            client: 'Nome Sem Documento LTDA',
            cpfCnpj: '',
            clientNumber: '0100',
          }),
          doc('name-ready-missing', {
            client: 'Nome Sem Documento LTDA',
            cpfCnpj: '',
            clientNumber: '',
          }),
          doc('payable-ignored', {
            type: 'Saída de Caixa / Contas a Pagar',
            movement: 'Saída',
            client: 'Fornecedor Ignorado',
            valuePaid: 200,
            honorarios: 0,
            totalCobranca: 0,
            clientNumber: '999',
          }),
          doc('excluded-ignored', {
            client: 'Empresa Excluida LTDA',
            cpfCnpj: '33.333.333/0001-33',
            clientNumber: '333',
            isExcluded: true,
          }),
        ],
      },
    ],
  };

  writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);
  execFileSync(process.execPath, [
    'scripts/build-client-registry.mjs',
    '--input',
    backupPath,
    '--out',
    outPath,
  ], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  const report = JSON.parse(readFileSync(outPath, 'utf8'));
  assert(report.counts.registryGroups === 3, `Expected 3 registry groups, got ${report.counts.registryGroups}`);
  assert(report.counts.registryReady === 2, `Expected 2 ready groups, got ${report.counts.registryReady}`);
  assert(report.counts.registryConflicts === 1, `Expected 1 conflict, got ${report.counts.registryConflicts}`);
  assert(report.counts.transactionUpdatesSafe === 1, `Expected 1 safe update, got ${report.counts.transactionUpdatesSafe}`);
  assert(report.counts.transactionUpdatesManualReview === 0, `Expected 0 manual-review updates, got ${report.counts.transactionUpdatesManualReview}`);
  assert(report.counts.nonReceivableSkipped === 1, `Expected 1 non-receivable skip, got ${report.counts.nonReceivableSkipped}`);
  assert(report.counts.excludedSkipped === 1, `Expected 1 excluded skip, got ${report.counts.excludedSkipped}`);

  const readyUpdate = report.transactionUpdates.find((item) => item.id === 'ready-missing-number');
  assert(readyUpdate?.plannedClientNumber === '0007', 'Expected missing CNPJ record to be backfilled with 0007.');

  const nameUpdate = report.transactionUpdates.find((item) => item.id === 'name-ready-missing');
  assert(!nameUpdate, 'Expected name-only backfill to be blocked by default.');

  const nameOutPath = resolve(`${REPORT_DIR}/client-registry-test-name-backfill-report-${stamp}.json`);
  execFileSync(process.execPath, [
    'scripts/build-client-registry.mjs',
    '--input',
    backupPath,
    '--out',
    nameOutPath,
    '--allow-name-backfill',
  ], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  const nameReport = JSON.parse(readFileSync(nameOutPath, 'utf8'));
  assert(nameReport.counts.transactionUpdatesSafe === 2, `Expected 2 safe updates with --allow-name-backfill, got ${nameReport.counts.transactionUpdatesSafe}`);

  console.log('Client registry tests passed');
  console.log(`Backup: ${backupPath}`);
  console.log(`Report: ${outPath}`);
};

main();
