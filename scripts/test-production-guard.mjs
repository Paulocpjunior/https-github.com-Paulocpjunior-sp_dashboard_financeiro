import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/firebase-deploy.yml', 'utf8');
assert.match(workflow, /workflow_dispatch:\s+inputs:\s+approved_commit:/);
const steps = workflow.split(/\n {6}- name: /);
for (const marker of ['publish-billing-review-rules.py', 'action-hosting-deploy@', 'activate-checklist-route.py']) {
  const matches = steps.filter(step => step.includes(marker));
  assert.equal(matches.length, 1, `Etapa de publicação ausente ou duplicada: ${marker}`);
  assert.match(matches[0], /if: github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'\n/,
    `Push não pode executar publicação: ${marker}`);
  assert.ok(matches[0].includes("FINANCEIRO_APPROVED_COMMIT: '${{ inputs.approved_commit }}'"),
    `Publicação deve receber o SHA autorizado: ${marker}`);
}

const valid = spawnSync(process.execPath, ['scripts/guard-production.mjs', '--check'], { encoding: 'utf8' });
assert.equal(valid.status, 0, valid.stderr);
const unauthorized = spawnSync(process.execPath, ['scripts/guard-production.mjs'], {
  encoding: 'utf8', env: { ...process.env, FINANCEIRO_APPROVED_COMMIT: '' },
});
assert.notEqual(unauthorized.status, 0);
assert.match(unauthorized.stderr, /PUBLICAÇÃO BLOQUEADA.*FINANCEIRO_APPROVED_COMMIT/);
for (const marker of ['Tesouraria Wix', 'Base de Faturamento', 'Disponível em qualquer computador', 'path="/faturamento"', '/api/boleto-cloud-csv']) {
  // Simula remoções em memória: não modifica arquivos nem dados reais.
  const code = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.readFileSync;
    fs.readFileSync = function (...args) {
      const value = original.apply(this, args);
      return typeof value === 'string' ? value.replaceAll(${JSON.stringify(marker)}, 'RECURSO_REMOVIDO') : value;
    };
    syncBuiltinESMExports();
    process.argv.push('--check');
    await import('./scripts/guard-production.mjs');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `Deveria bloquear remoção: ${marker}`);
  assert.match(result.stderr, /PUBLICAÇÃO BLOQUEADA/);
}
console.log('Trava validada: baseline passa; sem autorização e cinco remoções simuladas bloqueiam.');
