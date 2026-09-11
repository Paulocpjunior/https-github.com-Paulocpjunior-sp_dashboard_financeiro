#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupPath = resolve(`migration-backups/client-number-map-test-backup-${stamp}.json`);
const mapPath = resolve(`migration-backups/client-number-map-test-input-${stamp}.csv`);
const reportPath = resolve(`migration-backups/client-number-map-test-report-${stamp}.json`);

const tx = (id, data) => ({
  id,
  path: `projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${id}`,
  createTime: '2026-05-16T00:00:00.000Z',
  updateTime: '2026-05-16T00:00:00.000Z',
  data: {
    id,
    date: '2026-05-01',
    dueDate: '2026-05-10',
    paymentDate: '',
    bankAccount: '',
    type: 'Entrada de Caixa / Contas a Receber',
    movement: 'Entrada',
    status: 'Pendente',
    client: 'RENDAPE PARTICIPACOES LTDA',
    description: 'RENDAPE PARTICIPACOES LTDA',
    cpfCnpj: '65.014.642/0001-95',
    clientNumber: '',
    valuePaid: 0,
    valueReceived: 0,
    totalCobranca: 810.5,
    ...data,
  },
});

const registry = (id, data) => ({
  id,
  path: `projects/gen-lang-client-0888019226/databases/(default)/documents/clientRegistry/${id}`,
  createTime: '2026-05-16T00:00:00.000Z',
  updateTime: '2026-05-16T00:00:00.000Z',
  data: {
    id,
    key: 'doc:65014642000195',
    keyType: 'cnpj',
    cpfCnpjDigits: '65014642000195',
    client: 'RENDAPE PARTICIPACOES LTDA',
    clientNormalized: 'rendape participacoes ltda',
    clientNumber: '',
    clientNumberNormalized: '',
    status: 'missing_client_number',
    confidence: 'high',
    ...data,
  },
});

const backup = {
  generatedAt: new Date().toISOString(),
  projectId: 'gen-lang-client-0888019226',
  database: '(default)',
  collections: [
    {
      name: 'transactions',
      count: 3,
      documents: [
        tx('missing-cnpj', {}),
        tx('already-filled', { clientNumber: '1234' }),
        tx('payable-ignored', {
          type: 'Saida de Caixa / Contas a Pagar',
          movement: 'Saida',
          clientNumber: '',
          valuePaid: 100,
          totalCobranca: 0,
        }),
      ],
    },
    {
      name: 'clientRegistry',
      count: 2,
      documents: [
        registry('doc-65014642000195', {}),
        registry('name-2ca974f842b9a9f5', {
          key: 'name:rendape participacoes ltda',
          keyType: 'name',
          cpfCnpjDigits: '',
        }),
      ],
    },
  ],
};

mkdirSync('migration-backups', { recursive: true });
writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);
writeFileSync(mapPath, 'cpfCnpj;client;clientNumber\n65.014.642/0001-95;RENDAPE PARTICIPACOES LTDA;0571\n');

execFileSync(process.execPath, [
  'scripts/apply-client-number-map.mjs',
  '--input',
  backupPath,
  '--map',
  mapPath,
  '--out',
  reportPath,
], { stdio: 'inherit' });

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

assert.equal(report.counts.missingCandidates, 1, 'should list one missing client-number candidate');
assert.equal(report.counts.plannedTransactionUpdates, 1, 'should patch only the missing receivable transaction');
assert.equal(report.counts.plannedRegistryUpdates, 2, 'should patch CNPJ and name registry entries');
assert.equal(report.transactionUpdates[0].id, 'missing-cnpj');
assert.equal(report.transactionUpdates[0].plannedClientNumber, '0571');
assert(report.registryUpdates.some((item) => item.id === 'doc-65014642000195'), 'should update CNPJ registry doc');
assert(report.registryUpdates.some((item) => item.id === 'name-2ca974f842b9a9f5'), 'should update name registry doc');

console.log('Client number map tests passed');
