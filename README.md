# SP Dashboard Financeiro

Dashboard financeiro da SP Contabil, publicado no Firebase Hosting e usando Firebase como base oficial.

## Producao

- URL oficial: https://gen-lang-client-0888019226.web.app
- Projeto Firebase: `gen-lang-client-0888019226`
- Hosting: Firebase Hosting
- Banco oficial: Cloud Firestore
- Autenticacao: Firebase Auth

O app nao usa Google Sheets nem Apps Script como fonte operacional de dados. A leitura e a manutencao financeira passam pelo Firebase.

## Rodar Localmente

Pre-requisitos:

- Node.js
- Firebase CLI autenticado, quando for publicar ou validar regras

Instale as dependencias:

```bash
npm install
```

Crie o arquivo local de ambiente:

```bash
cp .env.example .env.local
```

Rode o app:

```bash
npm run dev
```

Abra a URL indicada pelo Vite no terminal. A porta preferencial configurada e `3000`, mas o Vite pode usar outra porta se ela ja estiver ocupada.

## Comandos de Validacao

Antes de qualquer publicacao:

```bash
npm run lint
npm run build
npm audit
```

Para fazer tudo em um comando:

```bash
npm run check
```

## Deploy

Publicar somente o site:

```bash
npm run deploy:hosting
```

Validar regras do Firestore sem publicar:

```bash
npm run deploy:rules:dry-run
```

Publicar regras do Firestore:

```bash
npm run deploy:rules
```

Publicar site e regras:

```bash
npm run deploy:all
```

Depois do deploy, validar:

- https://gen-lang-client-0888019226.web.app
- https://gen-lang-client-0888019226.web.app/relatorios
- https://gen-lang-client-0888019226.web.app/admin

## Fluxo de Usuarios

- Usuarios entram por username ou e-mail.
- O login usa Firebase Auth e o indice `loginIndex/{username}` para manter compatibilidade com login por nome de usuario.
- O login legado por hash salvo no Firestore nao e mais aceito.
- Novos cadastros entram como `operacional`, `active: false` e `status: pending`.
- O administrador aprova ou rejeita usuarios no painel Admin.
- Recuperacao de senha usa Firebase Auth. Usuarios com e-mails tecnicos internos precisam ter e-mail real vinculado para receber reset.

## Auditoria Auth/Firestore

Para auditar perfis, vinculos com Firebase Auth, indice de login e campos legados:

```bash
npm run audit:auth
```

Para cruzar tambem com contas reais do Firebase Auth:

```bash
npm run audit:auth:with-export
```

A auditoria tambem destaca contas com e-mail tecnico/local, como `@auth.spcontabil.local`, porque a recuperacao de senha do Firebase Auth precisa de um e-mail real e entregavel.

Os relatorios JSON e Markdown sao salvos em `migration-backups/`, que nao deve ser commitado. O export temporario do Firebase Auth e removido automaticamente porque pode conter hashes sensiveis.

Apos revisar o relatorio, os campos legados de senha podem ser removidos com backup local automatico:

```bash
npm run audit:auth:cleanup
```

Para atualizar e-mails tecnicos de recuperacao, copie o modelo e preencha e-mails reais:

```bash
cp scripts/recovery-email-map.example.json migration-backups/recovery-email-map.json
npm run auth:update-recovery-emails
```

O comando acima faz apenas validacao e dry-run. Para aplicar, depois de revisar o relatorio gerado em `migration-backups/`:

```bash
npm run auth:update-recovery-emails:apply
```

O modo apply atualiza Firebase Auth, `users/{uid}` e `loginIndex/{username}`. Antes de aplicar, ele grava backup local em `migration-backups/`.

## Backup do Firestore

Antes de manutencoes diretas em dados, gere um backup local das colecoes principais:

```bash
npm run backup:firestore
```

Por padrao, o backup inclui `users`, `loginIndex` e `transactions`. Os arquivos JSON e Markdown sao salvos em `migration-backups/`, que nao deve ser commitado.

## Pre-Manutencao

Antes de qualquer alteracao manual em dados, rode o pacote completo de seguranca:

```bash
npm run maintenance:precheck
```

Esse comando cria um backup local do codigo, exporta Firestore e roda a auditoria Auth/Firestore. O resumo fica em `migration-backups/pre-maintenance-*.md`.

## Regras de Seguranca

As regras ficam em `firestore.rules`.

Resumo:

- usuario autenticado e ativo pode ler transacoes;
- usuario autenticado e ativo pode fazer baixa limitada;
- somente admin pode listar usuarios, aprovar cadastros, bloquear usuarios e excluir transacoes;
- cadastro publico nao pode criar admin;
- `migration-backups/`, `.firebase/`, `.env.local` e artefatos locais nao devem ser commitados.

Veja detalhes em `FIREBASE_SECURITY.md`.

## Variaveis e Chaves

- Arquivos `.env` e `.env.local` nao devem ser commitados.
- Variaveis `VITE_*` entram no bundle do navegador, entao nao devem receber segredos de producao.
- A IA financeira fica desativada no cliente por padrao. Para producao, use um backend/proxy seguro para chamadas de IA.
- O token de exportacao bancaria nao e mais salvo no navegador; ele vale apenas para a exportacao atual.

## Logs de Diagnostico

Em producao, os logs tecnicos do navegador ficam silenciosos por padrao.

Para diagnosticar algum problema pontual no navegador, habilite temporariamente:

```js
localStorage.setItem('sp_debug_logs', 'true')
```

Para desligar:

```js
localStorage.removeItem('sp_debug_logs')
```

## Ordem Recomendada Para Manutencao

1. Fazer backup geral antes da mudanca.
2. Criar branch `codex/...`.
3. Fazer alteracoes pequenas e focadas.
4. Rodar `npm run check`.
5. Criar PR e mergear na `main`.
6. Publicar com `npm run deploy:hosting` ou `npm run deploy:all`.
7. Validar producao nas rotas `/` e `/admin`.

## Backup Manual

Exemplo de backup local fora do repositorio:

```bash
mkdir -p ../backups
tar --exclude='./node_modules' --exclude='./dist' -czf "../backups/sp_dashboard_financeiro-backup-$(date +%Y%m%d-%H%M%S).tar.gz" .
```
