import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildAuthEmailAlias } = await server.ssrLoadModule('/utils/authEmailAlias.ts');

  // A equipe compartilha a caixa financeiro@: o apelido separa as contas no
  // Firebase Auth sem tirar a entrega da caixa nem trocar o domínio.
  const alias = buildAuthEmailAlias('financeiro@spassessoriacontabil.com.br', 'hevelyn.almeida');
  assert.equal(alias, 'financeiro+hevelyn.almeida@spassessoriacontabil.com.br');

  // O domínio é o que a trava de envio do WhatsApp (CFI/SP Connect) cobra.
  for (const usuario of ['Hevelyn Almeida', 'rafaela', 'ana_paula']) {
    const gerado = buildAuthEmailAlias('Financeiro@SPAssessoriaContabil.com.br', usuario);
    assert.ok(gerado, `sem apelido para ${usuario}`);
    assert.ok(gerado.endsWith('@spassessoriacontabil.com.br'), gerado);
    assert.ok(!/[^a-z0-9._+@-]/.test(gerado), `apelido com caractere inválido: ${gerado}`);
  }

  // Dois usuários diferentes nunca podem cair no mesmo e-mail de autenticação.
  const usuarios = ['hevelyn.almeida', 'rafaela', 'ana_paula', 'beatriz'];
  const gerados = usuarios.map((u) => buildAuthEmailAlias('financeiro@spassessoriacontabil.com.br', u));
  assert.equal(new Set(gerados).size, usuarios.length);

  // Apelido de apelido não empilha: a base é sempre o endereço real da caixa.
  assert.equal(
    buildAuthEmailAlias('financeiro+rafaela@spassessoriacontabil.com.br', 'hevelyn.almeida'),
    'financeiro+hevelyn.almeida@spassessoriacontabil.com.br',
  );

  // Sem apelido possível, quem chama precisa continuar devolvendo o erro do Auth.
  assert.equal(buildAuthEmailAlias('financeiro@spassessoriacontabil.com.br', '  '), null);
  assert.equal(buildAuthEmailAlias('sem-arroba', 'hevelyn'), null);
  assert.equal(buildAuthEmailAlias('financeiro@local', 'hevelyn'), null);
  assert.equal(buildAuthEmailAlias('financeiro+hevelyn@sp.com.br', 'hevelyn'), null);

  // O autocadastro não pode mais consultar a coleção users, que firestore.rules
  // libera só para admin. A varredura cobra o fato no arquivo do serviço.
  const servico = readFileSync(new URL('../services/userAdminService.ts', import.meta.url), 'utf8');
  const criacao = servico.slice(servico.indexOf('createPendingUser:'), servico.indexOf('demoteAdministrator:'));
  assert.ok(criacao.length > 0, 'bloco createPendingUser não encontrado');
  for (const consulta of criacao.matchAll(/getDocs\s*\(|findUserDocByUsername\s*\(/g)) {
    const antes = criacao.slice(Math.max(0, consulta.index - 160), consulta.index);
    assert.ok(
      /isAdminCreation\s*(\?|&&)[^;]*$/.test(antes),
      `consulta a users sem guarda de admin no cadastro: ${consulta[0]}`,
    );
  }

  console.log('OK: apelido por usuário mantém a caixa e o domínio; autocadastro não consulta users sem ser admin.');
} finally {
  await server.close();
}
