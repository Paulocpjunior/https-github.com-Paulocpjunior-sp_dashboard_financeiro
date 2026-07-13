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

const versionPayload = {
  app: packageJson.name || 'sp-dashboard-financeiro',
  version: packageJson.version || '0.0.0',
  buildId,
  builtAt,
  commit: shortSha,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(versionPayload, null, 2)}\n`);

console.log(`Generated ${outputPath.replace(`${root}/`, '')} (${buildId})`);
