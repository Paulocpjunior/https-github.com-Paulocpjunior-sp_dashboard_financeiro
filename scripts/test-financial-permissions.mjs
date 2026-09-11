import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const {
    FINANCIAL_PERMISSION_OPTIONS,
    canOpenWixTreasury,
    hasFinancialPermission,
    sanitizeFinancialPermissions,
  } = await server.ssrLoadModule('/utils/financialPermissions.ts');

  assert.deepEqual(
    FINANCIAL_PERMISSION_OPTIONS.map(option => option.value),
    ['wix.treasury.open', 'billing.boleto-cloud.issue', 'itau.openfinance.read'],
  );

  assert.deepEqual(
    sanitizeFinancialPermissions([
      'wix.treasury.open',
      'itau.openfinance.read',
      'itau.openfinance.read',
      'unknown.permission',
    ]),
    ['wix.treasury.open', 'itau.openfinance.read'],
  );

  const operator = {
    id: 'op', username: 'operador', name: 'Operador', role: 'operacional', active: true,
    financialPermissions: ['itau.openfinance.read'],
  };
  assert.equal(hasFinancialPermission(operator, 'itau.openfinance.read'), true);
  assert.equal(hasFinancialPermission(operator, 'billing.boleto-cloud.issue'), false);
  assert.equal(canOpenWixTreasury(operator), false);
  assert.equal(hasFinancialPermission({ ...operator, active: false }, 'itau.openfinance.read'), false);
  assert.equal(hasFinancialPermission({ ...operator, role: 'admin', financialPermissions: [] }, 'billing.boleto-cloud.issue'), true);

  console.log('OK: permissões financeiras são independentes, sanitizadas e bloqueiam usuários inativos.');
} finally {
  await server.close();
}
