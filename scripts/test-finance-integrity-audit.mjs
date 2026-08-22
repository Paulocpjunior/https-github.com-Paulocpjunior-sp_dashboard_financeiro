#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupPath = resolve(`migration-backups/finance-integrity-test-backup-${stamp}.json`);
const reportPath = resolve(`migration-backups/finance-integrity-test-report-${stamp}.json`);

const doc = (id, data) => ({
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
    client: 'CLIENTE TESTE LTDA',
    description: 'CLIENTE TESTE LTDA',
    valuePaid: 0,
    valueReceived: 0,
    totalCobranca: 100,
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
      count: 14,
      documents: [
        doc('dup-sub-a', { submissionId: 'sub-1', dueDate: '2026-05-11', totalCobranca: 100 }),
        doc('dup-sub-b', { submissionId: 'sub-1', dueDate: '2026-05-12', totalCobranca: 150 }),
        doc('paid-open-a', { client: 'DUP PAGO ABERTO LTDA', description: 'DUP PAGO ABERTO LTDA', dueDate: '2026-05-13', totalCobranca: 200, status: 'Pendente' }),
        doc('paid-open-b', { client: 'DUP PAGO ABERTO LTDA', description: 'DUP PAGO ABERTO LTDA', dueDate: '2026-05-13', totalCobranca: 200, status: 'Pago', paymentDate: '2026-05-13', valueReceived: 200 }),
        doc('paid-shadow-a', { client: 'SOMBRA DE BAIXA LTDA', description: 'SOMBRA DE BAIXA LTDA', cpfCnpj: '11.111.111/0001-11', clientNumber: '111', dueDate: '2026-05-19', totalCobranca: 810.5, status: 'Pago', paymentDate: '2026-05-19', valueReceived: 810.5 }),
        doc('paid-shadow-b', { client: 'SOMBRA DE BAIXA LTDA', description: 'SOMBRA DE BAIXA LTDA', cpfCnpj: '11.111.111/0001-11', clientNumber: '111', dueDate: '2026-05-19', totalCobranca: 810.5, status: 'Pendente', observacao: 'Honorários Competência 05/2026' }),
        doc('different-competence-a', { client: 'COMPETENCIA DIFERENTE LTDA', description: 'COMPETENCIA DIFERENTE LTDA', cpfCnpj: '22.222.222/0001-22', clientNumber: '222', dueDate: '2026-05-20', totalCobranca: 900, status: 'Pago', paymentDate: '2026-05-20', valueReceived: 900, observacao: 'Honorário Competência 04/2026' }),
        doc('different-competence-b', { client: 'COMPETENCIA DIFERENTE LTDA', description: 'COMPETENCIA DIFERENTE LTDA', cpfCnpj: '22.222.222/0001-22', clientNumber: '222', dueDate: '2026-05-20', totalCobranca: 900, status: 'Pendente', observacao: 'Honorários Competência 05/2026' }),
        doc('open-paid-evidence', { dueDate: '2026-05-14', status: 'Pendente', paymentDate: '2026-05-14', totalCobranca: 300 }),
        doc('missing-client-number', { dueDate: '2026-05-15', cpfCnpj: '12.345.678/0001-90', totalCobranca: 400 }),
        doc('client-number-1', { dueDate: '2026-05-16', cpfCnpj: '98.765.432/0001-10', clientNumber: '0100', totalCobranca: 500 }),
        doc('client-number-2', { dueDate: '2026-05-17', cpfCnpj: '98.765.432/0001-10', clientNumber: '0101', totalCobranca: 500 }),
        doc('payable-detail-a', {
          type: 'Saída de Caixa / Contas a Pagar',
          movement: 'Saida',
          status: 'Pago',
          client: '14- Vale Refeição - Escritório-SODEXO',
          description: '14- Vale Refeição - Escritório-SODEXO',
          dueDate: '2026-05-18',
          paymentDate: '2026-05-18',
          valuePaid: 31,
          valueReceived: 0,
          totalCobranca: 0,
          observacaoAPagar: 'VR BRUNA 18-05',
        }),
        doc('payable-detail-b', {
          type: 'Saída de Caixa / Contas a Pagar',
          movement: 'Saida',
          status: 'Pago',
          client: '14- Vale Refeição - Escritório-SODEXO',
          description: '14- Vale Refeição - Escritório-SODEXO',
          dueDate: '2026-05-18',
          paymentDate: '2026-05-18',
          valuePaid: 31,
          valueReceived: 0,
          totalCobranca: 0,
          observacaoAPagar: 'VR BRUNA 18-05',
        }),
      ],
    },
  ],
};

mkdirSync('migration-backups', { recursive: true });
writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);

execFileSync(process.execPath, [
  'scripts/audit-finance-integrity.mjs',
  '--input',
  backupPath,
  '--out',
  reportPath,
  '--max-examples',
  '20',
], { stdio: 'inherit' });

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const count = (code) => report.findingsByCode[code]?.count || 0;

assert.equal(count('DUPLICATE_SUBMISSION_ID'), 1, 'should find duplicated submissionId');
assert.equal(count('PAID_AND_OPEN_DUPLICATE'), 2, 'should find paid/open duplicate and paid-shadow duplicate');
assert.equal(count('OPEN_WITH_PAYMENT_EVIDENCE'), 1, 'should find open record with payment evidence');
assert.equal(count('MISSING_CLIENT_NUMBER'), 1, 'should find missing client number');
assert.equal(count('CLIENT_NUMBER_CONFLICT'), 1, 'should find client number conflict');
assert.equal(count('EXACT_ACTIVE_DUPLICATE'), 0, 'should not mark employee VR/VT benefit lines as duplicates');
assert.equal(report.counts.critical, 0, 'test data should not produce critical findings');
assert.equal(report.counts.high, 4, 'test data should produce exactly four high findings');

console.log('Finance integrity audit tests passed');
