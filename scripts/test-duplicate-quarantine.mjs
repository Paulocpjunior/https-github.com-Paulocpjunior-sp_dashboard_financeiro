#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupPath = resolve(`migration-backups/duplicate-quarantine-test-backup-${stamp}.json`);
const reportPath = resolve(`migration-backups/duplicate-quarantine-test-report-${stamp}.json`);
const includeOpenReportPath = resolve(`migration-backups/duplicate-quarantine-test-include-open-report-${stamp}.json`);

const doc = (id, data) => ({
  id,
  path: `projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${id}`,
  createTime: '2026-05-16T00:00:00.000Z',
  updateTime: data.updatedAt || '2026-05-16T00:00:00.000Z',
  data: {
    id,
    date: '2026-05-13',
    dueDate: '2026-05-13',
    paymentDate: '2026-05-13',
    bankAccount: '',
    type: 'Recebimento Wix / Cartao',
    movement: 'Entrada',
    status: 'Pago',
    client: 'Ivan soares',
    description: 'Cartao de credito/debito',
    valuePaid: 0,
    valueReceived: 4704.12,
    valorOriginal: 4704.12,
    totalCobranca: 0,
    updatedAt: data.updatedAt || '2026-05-16T00:00:00.000Z',
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
      count: 10,
      documents: [
        doc('wix-old', { updatedAt: '2026-05-13T20:58:26.521Z' }),
        doc('wix-new', { updatedAt: '2026-05-13T21:01:04.897Z' }),
        doc('open-a', {
          status: 'Pendente',
          paymentDate: '',
          client: 'Duplicidade aberta',
          description: 'Duplicidade aberta',
          valueReceived: 0,
          valorOriginal: 300,
          totalCobranca: 300,
        }),
        doc('open-b', {
          status: 'Pendente',
          paymentDate: '',
          client: 'Duplicidade aberta',
          description: 'Duplicidade aberta',
          valueReceived: 0,
          valorOriginal: 300,
          totalCobranca: 300,
        }),
        doc('payable-a', {
          type: 'Saida de Caixa / Contas a Pagar',
          movement: 'Saida',
          client: '14- Vale Refeicao - Escritorio-SODEXO',
          description: '14- Vale Refeicao - Escritorio-SODEXO',
          valuePaid: 31,
          valueReceived: 0,
          valorOriginal: 31,
          observacaoAPagar: 'VR BRUNA 13-05',
        }),
        doc('payable-b', {
          type: 'Saida de Caixa / Contas a Pagar',
          movement: 'Saida',
          client: '14- Vale Refeicao - Escritorio-SODEXO',
          description: '14- Vale Refeicao - Escritorio-SODEXO',
          valuePaid: 31,
          valueReceived: 0,
          valorOriginal: 31,
          observacaoAPagar: 'VR GABRIELLE 13-05',
        }),
        doc('paid-shadow-paid', {
          client: 'Cliente sombra',
          description: 'Cliente sombra',
          dueDate: '2026-05-14',
          observacao: 'Honorário Competência 05/2026',
          updatedAt: '2026-05-14T21:01:00.000Z',
        }),
        doc('paid-shadow-open', {
          client: 'Cliente sombra',
          description: 'Cliente sombra',
          dueDate: '2026-05-14',
          status: 'Pendente',
          paymentDate: '',
          observacao: 'Hon 05/2026',
          valueReceived: 0,
          valorOriginal: 4704.12,
          totalCobranca: 4704.12,
          updatedAt: '2026-05-14T21:02:00.000Z',
        }),
        doc('different-competence-paid', {
          client: 'Competencia diferente',
          description: 'Competencia diferente',
          dueDate: '2026-05-15',
          observacao: 'Honorário Competência 04/2026',
          updatedAt: '2026-05-15T21:01:00.000Z',
        }),
        doc('different-competence-open', {
          client: 'Competencia diferente',
          description: 'Competencia diferente',
          dueDate: '2026-05-15',
          status: 'Pendente',
          paymentDate: '',
          observacao: 'Honorários Competência 05/2026',
          valueReceived: 0,
          valorOriginal: 4704.12,
          totalCobranca: 4704.12,
          updatedAt: '2026-05-15T21:02:00.000Z',
        }),
      ],
    },
  ],
};

mkdirSync('migration-backups', { recursive: true });
writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);

execFileSync(process.execPath, [
  'scripts/quarantine-duplicate-transactions.mjs',
  '--input',
  backupPath,
  '--out',
  reportPath,
], { stdio: 'inherit' });

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

assert.equal(report.counts.duplicateGroups, 2, 'should plan one fully paid duplicate group and one paid-shadow group');
assert.equal(report.counts.plannedExclusions, 2, 'should plan stale copy exclusions');
assert.equal(report.counts.skippedOpenGroups, 1, 'should skip open-only duplicate group by default');

const wixGroup = report.groups.find((group) => group.duplicateKey.includes('ivan soares'));
const paidShadowGroup = report.groups.find((group) => group.reason === 'duplicate:paid-shadow');
const differentCompetenceGroup = report.groups.find((group) => group.duplicateKey.includes('competencia diferente'));

assert.ok(wixGroup, 'should plan the fully paid Wix duplicate group');
assert.equal(wixGroup.keepId, 'wix-new', 'should keep the newest/best document');
assert.deepEqual(wixGroup.excludeIds, ['wix-old'], 'should exclude only the stale Wix copy');
assert.ok(paidShadowGroup, 'should plan compatible paid-shadow group by default');
assert.equal(paidShadowGroup.keepId, 'paid-shadow-paid', 'paid-shadow group must keep the paid document');
assert.deepEqual(paidShadowGroup.excludeIds, ['paid-shadow-open'], 'paid-shadow group must exclude the open stale copy');
assert.equal(differentCompetenceGroup, undefined, 'should not quarantine paid/open records with different competencies');

execFileSync(process.execPath, [
  'scripts/quarantine-duplicate-transactions.mjs',
  '--input',
  backupPath,
  '--out',
  includeOpenReportPath,
  '--include-open',
], { stdio: 'inherit' });

const includeOpenReport = JSON.parse(readFileSync(includeOpenReportPath, 'utf8'));
const mixedGroup = includeOpenReport.groups.find((group) => group.duplicateKey.includes('duplicidade aberta'));

assert.ok(mixedGroup, 'include-open should plan the open-only duplicate group');
assert.equal(mixedGroup.keepId, 'open-a', 'include-open should keep one open copy');
assert.deepEqual(mixedGroup.excludeIds, ['open-b'], 'include-open should exclude the extra open copy');

console.log('Duplicate quarantine tests passed');
