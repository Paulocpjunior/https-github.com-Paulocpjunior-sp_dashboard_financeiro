import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const valid = spawnSync(process.execPath, ['scripts/guard-production.mjs', '--check'], { encoding: 'utf8' });
assert.equal(valid.status, 0, valid.stderr);
const unauthorized = spawnSync(process.execPath, ['scripts/guard-production.mjs'], {
  encoding: 'utf8', env: { ...process.env, FINANCEIRO_APPROVED_COMMIT: '' },
});
assert.notEqual(unauthorized.status, 0);
assert.match(unauthorized.stderr, /PUBLICAÇÃO BLOQUEADA.*FINANCEIRO_APPROVED_COMMIT/);
for (const marker of ['Tesouraria Wix', 'Base de Faturamento', 'Preparar resgate no Mac', 'path="/faturamento"', '/api/boleto-cloud-csv']) {
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
