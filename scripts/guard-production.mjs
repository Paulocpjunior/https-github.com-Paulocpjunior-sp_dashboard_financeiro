import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Baseline restaurada e homologada. Não remover para contornar um bloqueio.
const baseline = 'f5960d25a92768a66512c5408c504de62bcc997d';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const requireCondition = (condition, reason) => {
  if (!condition) throw new Error(`PUBLICAÇÃO BLOQUEADA: ${reason}`);
};
const source = (path) => readFileSync(path, 'utf8');
git('merge-base', '--is-ancestor', baseline, 'HEAD');
for (const [path, markers] of [
  ['components/Layout.tsx', ['Base de Faturamento', 'Tesouraria Wix', '<WixTreasuryModal', 'setShowWixTreasury(true)']],
  ['components/WixTreasuryModal.tsx', ['Preparar resgate no Mac', 'Abrir somente na Wix']],
  ['App.tsx', ['path="/faturamento"', '<BillingForecast']],
]) {
  for (const marker of markers) requireCondition(source(path).includes(marker), `${path}: recurso protegido ausente (${marker})`);
}
const config = JSON.parse(source('firebase.json'));
for (const route of ['/api/boleto-cloud-csv', '/api/pdf-download', '/api/pdf-download/**']) {
  requireCondition(config.hosting.rewrites.some(r => r.source === route && r.run?.serviceId === 'sp-pdf-download'), `rota protegida ausente: ${route}`);
}
if (!process.argv.includes('--check')) {
  const head = git('rev-parse', 'HEAD');
  requireCondition(process.env.FINANCEIRO_APPROVED_COMMIT === head, 'informe FINANCEIRO_APPROVED_COMMIT com o SHA completo explicitamente autorizado por Paulo');
  requireCondition(!git('status', '--porcelain', '--untracked-files=no'), 'existem alterações não commitadas');
  // Consulta remota obrigatória: falha de rede também bloqueia a publicação.
  const remote = git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
  requireCondition(head === remote, 'somente a versão atual de origin/main pode ser publicada');
  const version = JSON.parse(source('dist/version.json'));
  requireCondition(version.commit === head.slice(0, 7), 'build não corresponde ao commit autorizado; refaça o build');
}
console.log('Proteções de publicação financeira aprovadas.');
