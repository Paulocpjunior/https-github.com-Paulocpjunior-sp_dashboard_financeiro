import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

{
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

  console.log('OK: autocadastro não consulta users sem ser admin.');
}
