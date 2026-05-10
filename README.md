# SP Dashboard Financeiro

Dashboard financeiro da SP Contabil, publicado no Firebase Hosting e usando Firebase como base oficial.

## Producao

- URL oficial: https://gen-lang-client-0888019226.web.app
- Projeto Firebase: `gen-lang-client-0888019226`
- Hosting: Firebase Hosting
- Banco oficial: Cloud Firestore
- Autenticacao: Firebase Auth

A URL antiga do Apps Script foi preservada no codigo apenas para compatibilidade historica. O app nao usa mais Google Sheets como fonte operacional de dados.

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
- https://gen-lang-client-0888019226.web.app/admin

## Fluxo de Usuarios

- Usuarios entram por username ou e-mail.
- O login usa Firebase Auth e o indice `loginIndex/{username}` para manter compatibilidade com login por nome de usuario.
- Novos cadastros entram como `operacional`, `active: false` e `status: pending`.
- O administrador aprova ou rejeita usuarios no painel Admin.
- Recuperacao de senha usa Firebase Auth. Usuarios com e-mails tecnicos internos precisam ter e-mail real vinculado para receber reset.

## Regras de Seguranca

As regras ficam em `firestore.rules`.

Resumo:

- usuario autenticado e ativo pode ler transacoes;
- usuario autenticado e ativo pode fazer baixa limitada;
- somente admin pode listar usuarios, aprovar cadastros, bloquear usuarios e excluir transacoes;
- cadastro publico nao pode criar admin;
- `migration-backups/`, `.firebase/`, `.env.local` e artefatos locais nao devem ser commitados.

Veja detalhes em `FIREBASE_SECURITY.md`.

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
