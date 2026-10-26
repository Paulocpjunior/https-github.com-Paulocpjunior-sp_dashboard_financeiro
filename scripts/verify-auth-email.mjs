#!/usr/bin/env node
//
// Marca o e-mail de uma conta do Financeiro como verificado no Firebase Auth.
//
// O envio de boleto por WhatsApp passa pelo CFI/SP Connect, que só aceita token
// com e-mail do domínio da casa E com email_verified = true. Conta criada pelo
// painel Admin nasce sem verificação, então a pessoa é barrada no envio.
//
// Simulação por padrão. Nada é escrito sem --aplicar. Toda escrita deixa
// registro em userAccountAudit.
//
//   node scripts/verify-auth-email.mjs --usuario hevelyn.almeida
//   node scripts/verify-auth-email.mjs --usuario hevelyn.almeida --aplicar
//
import { execFileSync } from 'node:child_process';

const PROJETO_PADRAO = 'gen-lang-client-0888019226';
const BANCO = '(default)';
const DOMINIO_DA_CASA = '@spassessoriacontabil.com.br';

const ajuda = `
Uso:
  node scripts/verify-auth-email.mjs --usuario <usuario> [opções]

Opções:
  --usuario <nome>   Usuário de acesso, como ele entra no app. Obrigatório.
  --motivo <texto>   Motivo gravado na auditoria.
  --projeto <id>     Projeto Firebase. Padrão: ${PROJETO_PADRAO}
  --aplicar          Grava. Sem isto, só mostra o que faria.
  --ajuda            Mostra esta ajuda.
`;

const limpar = (valor) => String(valor || '').trim();
const normalizarUsuario = (valor) => limpar(valor).toLowerCase().replace(/\s/g, '');

const lerArgumentos = (argv) => {
  const args = {
    usuario: '',
    motivo: 'liberar envio de WhatsApp: e-mail verificado',
    projeto: process.env.FIREBASE_PROJECT_ID || PROJETO_PADRAO,
    aplicar: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--usuario') args.usuario = normalizarUsuario(argv[++i]);
    else if (arg === '--motivo') args.motivo = limpar(argv[++i]);
    else if (arg === '--projeto') args.projeto = limpar(argv[++i]);
    else if (arg === '--aplicar') args.aplicar = true;
    else if (arg === '--ajuda' || arg === '-h') {
      console.log(ajuda.trim());
      process.exit(0);
    } else throw new Error(`Opção desconhecida: ${arg}`);
  }

  if (!args.usuario) throw new Error('--usuario é obrigatório.');
  return args;
};

const token = () => {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN.trim();
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
};

const pedir = async (url, acesso, opcoes = {}) => {
  const resposta = await fetch(url, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${acesso}`,
      Accept: 'application/json',
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.headers || {}),
    },
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Falha (${resposta.status}) em ${url}: ${corpo.slice(0, 500)}`);
  }

  return resposta.status === 204 ? {} : resposta.json();
};

const documento = (projeto, caminho) =>
  `https://firestore.googleapis.com/v1/projects/${projeto}/databases/${encodeURIComponent(BANCO)}/documents/${caminho}`;

const valorFirestore = (valor) => {
  if (valor === null) return { nullValue: null };
  if (typeof valor === 'boolean') return { booleanValue: valor };
  return { stringValue: String(valor) };
};

const principal = async () => {
  const args = lerArgumentos(process.argv.slice(2));
  const acesso = token();

  const indice = await pedir(documento(args.projeto, `loginIndex/${encodeURIComponent(args.usuario)}`), acesso)
    .catch(() => null);
  if (!indice) {
    throw new Error(`Usuário "${args.usuario}" não está no loginIndex. A conta já foi aprovada no painel Admin?`);
  }

  const uid = limpar(indice.fields?.uid?.stringValue);
  const email = limpar(indice.fields?.authEmail?.stringValue).toLowerCase();
  if (!uid || !email) throw new Error(`Índice de login incompleto para "${args.usuario}".`);

  const conta = await pedir(`https://identitytoolkit.googleapis.com/v1/projects/${args.projeto}/accounts:lookup`, acesso, {
    method: 'POST',
    headers: { 'X-Goog-User-Project': args.projeto },
    body: JSON.stringify({ localId: [uid] }),
  });

  const atual = (conta.users || [])[0];
  if (!atual) throw new Error(`Conta ${uid} não existe no Firebase Auth.`);

  const verificado = atual.emailVerified === true;
  const doDominio = email.endsWith(DOMINIO_DA_CASA);

  console.log(`usuário:    ${args.usuario}`);
  console.log(`uid:        ${uid}`);
  console.log(`e-mail:     ${email}`);
  console.log(`verificado: ${verificado ? 'sim' : 'não'}`);
  console.log(`domínio:    ${doDominio ? 'ok' : `FORA de ${DOMINIO_DA_CASA}`}`);

  if (!doDominio) {
    throw new Error('O e-mail está fora do domínio da casa: o envio por WhatsApp seria barrado mesmo verificado.');
  }

  if (verificado) {
    console.log('\nNada a fazer: já está verificado.');
    return;
  }

  if (!args.aplicar) {
    console.log('\nSimulação. Rode de novo com --aplicar para marcar como verificado.');
    return;
  }

  await pedir(`https://identitytoolkit.googleapis.com/v1/projects/${args.projeto}/accounts:update`, acesso, {
    method: 'POST',
    headers: { 'X-Goog-User-Project': args.projeto },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });

  const agora = new Date().toISOString();
  const registro = `verificado-${agora.slice(0, 10).replace(/-/g, '')}-${uid}`;
  await pedir(`${documento(args.projeto, `userAccountAudit/${registro}`)}`, acesso, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries({
          uid,
          username: args.usuario,
          authEmail: email,
          acao: 'emailVerified',
          de: false,
          para: true,
          motivo: args.motivo,
          executadoEm: agora,
          executadoPor: 'scripts/verify-auth-email.mjs',
        }).map(([chave, valor]) => [chave, valorFirestore(valor)]),
      ),
    }),
  });

  console.log(`\nPronto: e-mail marcado como verificado. Auditoria: userAccountAudit/${registro}`);
  console.log('A pessoa precisa sair do app e entrar de novo para o token novo valer.');
};

principal().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exit(1);
});
