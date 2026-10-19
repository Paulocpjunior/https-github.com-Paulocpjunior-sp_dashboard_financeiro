#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const outputPath = resolve(root, process.argv[2] || 'public/version.json');

const safeGit = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const builtAt = new Date().toISOString();
const shortSha = safeGit(['rev-parse', '--short', 'HEAD']);
const buildId = `${builtAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}${shortSha ? `-${shortSha}` : ''}`;

// Novidades: os últimos commits da main (sem merges), para o aviso de
// atualização listar o que mudou desde a versão aberta, como no Consultor DP.
// O título perde o "(#NN)" do squash e o prefixo "feat(x):"; os itens
// "- ..." ou "* ..." do corpo viram detalhes. O deploy usa fetch-depth: 0.
const limparTitulo = (t = '') => t
  .replace(/\s*\(#\d+\)\s*$/, '')
  .replace(/^(feat|fix|chore|refactor|perf|docs|style|test|build|ci)(\([^)]*\))?!?:\s*/i, '')
  .trim()
  .replace(/^\p{Ll}/u, (c) => c.toUpperCase());

const novidades = (max = 40) => {
  const log = safeGit(['log', '-n', String(max), '--no-merges', '--format=%h%x1f%cI%x1f%s%x1f%b%x1e', 'HEAD']);
  return log.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [commit, data, assunto, corpo = ''] = r.split('\x1f');
    const titulo = limparTitulo(assunto);
    const itens = [];
    for (const linha of corpo.split('\n')) {
      const l = linha.trim();
      if (/^(co-authored-by|claude-session|signed-off-by):/i.test(l) || /^https?:\/\//.test(l)) continue;
      const m = linha.match(/^\s*[-*]\s+(.*)$/);
      if (m) {
        const item = limparTitulo(m[1]);
        if (item && item !== titulo) itens.push(item);
      }
    }
    return { commit, data: (data || '').slice(0, 10), titulo, itens: itens.slice(0, 6) };
  }).filter((n) => n.commit && n.titulo && !/^merge\b/i.test(n.titulo));
};

const versionPayload = {
  app: packageJson.name || 'sp-dashboard-financeiro',
  version: packageJson.version || '0.0.0',
  buildId,
  builtAt,
  commit: shortSha,
  novidades: novidades(),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(versionPayload, null, 2)}\n`);

console.log(`Generated ${outputPath.replace(`${root}/`, '')} (${buildId})`);
