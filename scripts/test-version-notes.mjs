import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { mesmoCommit, novidadesDesde, dataBr } = await server.ssrLoadModule('/utils/versionNotes.ts');
  const lista = [
    { commit: 'ccc3333', data: '2026-10-19', titulo: 'Botão Imprimir / PDF', itens: [] },
    { commit: 'bbb2222', data: '2026-10-18', titulo: 'Liberado e a receber automáticos', itens: [] },
    { commit: 'aaa1111', data: '2026-10-17', titulo: 'Relatório de pagamentos', itens: [] },
  ];

  assert.deepEqual(novidadesDesde(lista, 'bbb2222').itens.map((n) => n.commit), ['ccc3333']);
  assert.deepEqual(novidadesDesde(lista, 'aaa1111abc').itens.map((n) => n.commit), ['ccc3333', 'bbb2222']);
  assert.deepEqual(novidadesDesde(lista, 'zzz', 2), { itens: lista.slice(0, 2), mais: 1 });
  assert.deepEqual(novidadesDesde(undefined, 'x'), { itens: [], mais: 0 });
  assert.equal(mesmoCommit('abc1234', 'abc12345'), true);
  assert.equal(mesmoCommit('', 'abc'), false);
  assert.equal(dataBr('2026-10-19'), '19/10/2026');
} finally {
  await server.close();
}

// O version.json mantém os campos que o guard de produção lê e ganha as novidades.
const out = join(mkdtempSync(join(tmpdir(), 'sp-version-')), 'version.json');
execFileSync('node', ['scripts/write-build-version.mjs', out], { stdio: 'ignore' });
const payload = JSON.parse(readFileSync(out, 'utf8'));
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(payload.commit, head);
assert.ok(payload.buildId.endsWith(head));
assert.ok(Array.isArray(payload.novidades) && payload.novidades.length > 0);
for (const n of payload.novidades) {
  assert.ok(n.commit && n.titulo, 'novidade sem commit ou título');
  assert.doesNotMatch(n.titulo, /\(#\d+\)$|^(feat|fix)(\(|:)/);
  assert.ok(n.itens.every((i) => !/^co-authored-by:/i.test(i)));
}

console.log('Aviso de atualização: novidades e version.json conferidos.');
