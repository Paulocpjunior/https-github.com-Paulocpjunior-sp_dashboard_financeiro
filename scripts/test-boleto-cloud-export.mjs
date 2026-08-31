import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const source = readFileSync(new URL('../components/DataTable.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../pages/Dashboard.tsx', import.meta.url), 'utf8');

assert.match(source, /canExportBoletoCloud = false/, 'a exportação deve ser bloqueada por padrão');
assert.match(source, /!isSaidaTransaction\(row\)/, 'saídas não podem entrar no arquivo de boletos');
assert.match(source, /pendingReceivablesData\.filter\(row =>/, 'o arquivo deve usar somente recebíveis pendentes');
assert.match(source, /Geração bloqueada:.*CPF\/CNPJ inválido ou vazio/s, 'documentos inválidos devem bloquear a geração');
assert.match(source, /Geração bloqueada: informe o Token/, 'token vazio deve bloquear a geração');
assert.match(source, /useGrouping: false/, 'o valor deve sair com duas casas e sem separador de milhar');
assert.match(source, /const cpfCnpj = formatDocument\(/, 'o CPF/CNPJ deve sair formatado conforme o manual oficial');
assert.match(source, /NOVA CONTA ITAÚ — Banco 341, agência 3145, conta 99791-6/, 'a conta autorizada deve ficar explícita no modal');
assert.match(source, /const closeExportModal = \(\) => \{\s*setExportToken\(''\)/s, 'fechar ou cancelar deve apagar o token da memória');
assert.match(source, /const isContasAReceber = isReceivablesMode \|\|/, 'o atalho de contas a receber deve liberar o preparador');
assert.match(source, /possibleDuplicates\?\.byTransactionId\.has\(row\.id\)/, 'lançamentos com indício de duplicidade devem bloquear a geração');
assert.match(source, /URL\.revokeObjectURL\(url\)/, 'o arquivo temporário deve liberar a URL após o download');
assert.match(source, /Nenhum boleto foi emitido/, 'a interface deve declarar que o arquivo é apenas preparatório');
assert.match(dashboardSource, /hasFinancialPermission\(currentUser, 'billing\.boleto-cloud\.issue'\)/, 'a tela deve respeitar a permissão financeira dedicada');
assert.match(dashboardSource, /canExportBoletoCloud=\{canExportBoletoCloud\}/, 'a permissão deve chegar ao componente de exportação');
assert.match(dashboardSource, /isReceivablesMode=\{isContasAReceber\}/, 'o modo de contas a receber deve chegar ao componente de exportação');

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { getOriginalAmount } = await server.ssrLoadModule('/utils/transactionAmounts.ts');
  assert.equal(getOriginalAmount({
    id: 'receber-1', date: '2026-08-31', dueDate: '2026-09-10', bankAccount: 'Itau',
    type: 'Entrada de Caixa / Contas a Receber', description: 'Honorarios', status: 'Pendente',
    client: 'Cliente Teste', paidBy: '', movement: 'Entrada', valuePaid: 0, valueReceived: 800,
    honorarios: 1000, valorExtra: 250, totalCobranca: 1250,
  }), 1250, 'o valor do boleto deve usar sempre o total da cobrança');
} finally {
  await server.close();
}

console.log('OK: preparação Boleto Cloud usa o total da cobrança e bloqueia dados, saídas e usuários inválidos.');
