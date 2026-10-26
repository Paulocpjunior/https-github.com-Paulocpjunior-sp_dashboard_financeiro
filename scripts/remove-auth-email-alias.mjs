#!/usr/bin/env node
//
// Desfaz os logins internos financeiro+usuario@ criados em 26/10.
//
// Paulo (26/10): toda conta do Financeiro usa financeiro@ e nenhum e-mail
// inexistente é inventado. O login interno volta ao padrão técnico que o
// sistema já usava (usuario@auth.spcontabil.local), que não aparece em tela e
// não recebe nada. O e-mail do cadastro (financeiro@) não muda, nem a senha.
//
// Simulação por padrão. Nada é escrito sem --aplicar. Cada conta ajustada
// deixa registro em userAccountAudit.
//
//   node scripts/remove-auth-email-alias.mjs
//   node scripts/remove-auth-email-alias.mjs --aplicar
//
import { execFileSync } from 'node:child_process';

const PROJETO = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0888019226';
const BANCO = '(default)';
const DOMINIO_TECNICO = '@auth.spcontabil.local';
const APELIDO = /^[^@+\s]+\+[^@\s]+@spassessoriacontabil\.com\.br$/i;

const aplicar = process.argv.includes('--aplicar');
const desconhecidas = process.argv.slice(2).filter((a) => a !== '--aplicar');
if (desconhecidas.length) {
  console.error(`Opção desconhecida: ${desconhecidas.join(' ')}`);
  process.exit(1);
}

const limpar = (valor) => String(valor || '').trim();
const acesso = process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim()
  || execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();

const pedir = async (url, opcoes = {}) => {
  const resposta = await fetch(url, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${acesso}`,
      Accept: 'application/json',
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.headers || {}),
    },
  });
  if (resposta.status === 404 && opcoes.permitir404) return null;
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Falha (${resposta.status}) em ${url}: ${corpo.slice(0, 500)}`);
  }
  return resposta.status === 204 ? {} : resposta.json();
};

const documentos = `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/${encodeURIComponent(BANCO)}/documents`;
const auth = (acao, corpo) => pedir(`https://identitytoolkit.googleapis.com/v1/projects/${PROJETO}/accounts:${acao}`, {
  method: 'POST',
  headers: { 'X-Goog-User-Project': PROJETO },
  body: JSON.stringify(corpo),
});
const texto = (doc, campo) => limpar(doc?.fields?.[campo]?.stringValue);
const valor = (v) => (typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) });
const atualizar = (caminho, campos) => {
  const mascara = new URLSearchParams();
  Object.keys(campos).forEach((c) => mascara.append('updateMask.fieldPaths', c));
  return pedir(`${documentos}/${caminho}?${mascara}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(campos).map(([c, v]) => [c, valor(v)])) }),
  });
};

const listarUsuarios = async () => {
  const todos = [];
  let pagina = '';
  do {
    const params = new URLSearchParams({ pageSize: '300' });
    if (pagina) params.set('pageToken', pagina);
    const resposta = await pedir(`${documentos}/users?${params}`);
    todos.push(...(resposta.documents || []));
    pagina = resposta.nextPageToken || '';
  } while (pagina);
  return todos;
};

const principal = async () => {
  const usuarios = await listarUsuarios();
  const alvos = [];

  for (const doc of usuarios) {
    const uid = doc.name.split('/').pop();
    const authEmail = texto(doc, 'authEmail').toLowerCase();
    const contaAuth = (await auth('lookup', { localId: [uid] })).users?.[0];
    const emailAuth = limpar(contaAuth?.email).toLowerCase();
    if (!APELIDO.test(authEmail) && !APELIDO.test(emailAuth)) continue;

    const username = texto(doc, 'username').toLowerCase();
    if (!username || !/^[a-z0-9._-]+$/.test(username)) {
      throw new Error(`Usuário "${username}" (${uid}) não serve de login interno. Nada foi alterado.`);
    }
    alvos.push({ uid, username, de: emailAuth || authEmail, para: `${username}${DOMINIO_TECNICO}`, existeAuth: Boolean(contaAuth) });
  }

  if (!alvos.length) {
    console.log('Nenhuma conta com login financeiro+usuario@. Nada a fazer.');
    return;
  }

  for (const alvo of alvos) {
    const ocupado = (await auth('lookup', { email: [alvo.para] })).users?.find((u) => u.localId !== alvo.uid);
    if (ocupado) throw new Error(`${alvo.para} já é de outra conta (${ocupado.localId}). Nada foi alterado.`);
    console.log(`${alvo.username}: ${alvo.de} -> ${alvo.para}${alvo.existeAuth ? '' : ' (sem conta no Auth!)'}`);
  }

  if (!aplicar) {
    console.log(`\nSimulação: ${alvos.length} conta(s). Rode de novo com --aplicar para gravar.`);
    return;
  }

  const agora = new Date().toISOString();
  const dia = agora.slice(0, 10).replace(/-/g, '');
  for (const alvo of alvos) {
    if (alvo.existeAuth) await auth('update', { localId: alvo.uid, email: alvo.para, emailVerified: false });
    await atualizar(`users/${alvo.uid}`, { authEmail: alvo.para, updatedAt: agora });
    const indice = await pedir(`${documentos}/loginIndex/${encodeURIComponent(alvo.username)}`, { permitir404: true });
    if (indice && texto(indice, 'uid') === alvo.uid) {
      await atualizar(`loginIndex/${encodeURIComponent(alvo.username)}`, { authEmail: alvo.para, updatedAt: agora });
    }
    await atualizar(`userAccountAudit/apelido-desfeito-${dia}-${alvo.uid}`, {
      uid: alvo.uid,
      username: alvo.username,
      acao: 'authEmail',
      de: alvo.de,
      para: alvo.para,
      motivo: 'Paulo 26/10: todas as contas usam financeiro@; desfeito o login financeiro+usuario@',
      executadoEm: agora,
      executadoPor: 'scripts/remove-auth-email-alias.mjs',
    });
    const conferido = (await auth('lookup', { localId: [alvo.uid] })).users?.[0];
    if (alvo.existeAuth && limpar(conferido?.email).toLowerCase() !== alvo.para) {
      throw new Error(`Conferência falhou para ${alvo.username}: o Auth mostra ${conferido?.email}.`);
    }
    console.log(`OK ${alvo.username}: ${alvo.para}`);
  }
  console.log(`\nPronto: ${alvos.length} conta(s) ajustada(s). Senha e e-mail do cadastro não mudaram.`);
};

principal().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exit(1);
});
