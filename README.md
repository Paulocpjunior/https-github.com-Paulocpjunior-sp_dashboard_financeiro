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

O workflow GitHub Actions de Firebase Hosting existe apenas para acionamento manual (`workflow_dispatch`). Merge ou push na `main` nao publica automaticamente.

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

A auditoria destaca contas ativas com e-mail tecnico/local, como `@auth.spcontabil.local`, porque a recuperacao de senha do Firebase Auth precisa de um e-mail real e entregavel. Contas inativas/bloqueadas com Firebase Auth desabilitado sao tratadas como e-mails tecnicos arquivados e nao entram como risco operacional.

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

Para bloquear usuarios que nao devem mais acessar o sistema, sem apagar historico:

```bash
npm run deactivate:users -- --username usuario --reason no_longer_part_of_team
```

Esse comando faz `dry-run` por padrao. Para aplicar depois de revisar o relatorio:

```bash
npm run deactivate:users -- --username usuario --reason no_longer_part_of_team --apply
```

Para transferir um e-mail real entre contas Firebase Auth, preservando a conta de origem como bloqueada/arquivada:

```bash
npm run transfer:auth-email -- --from-username usuario.origem --to-username usuario.destino --email email@dominio.com.br
```

Use `--apply` somente depois de revisar o dry-run. O comando atualiza Firebase Auth, `users/{uid}` e `loginIndex/{username}`, e grava backup local antes da aplicacao.

## Backup do Firestore

Antes de manutencoes diretas em dados, gere um backup local das colecoes principais:

```bash
npm run backup:firestore
```

Por padrao, o backup inclui `users`, `loginIndex` e `transactions`. Os arquivos JSON e Markdown sao salvos em `migration-backups/`, que nao deve ser commitado.

## Auditoria de Transacoes

Para verificar qualidade dos lancamentos a partir do backup local mais recente:

```bash
npm run audit:transactions
```

A auditoria nao altera o Firebase. Ela gera JSON e Markdown em `migration-backups/` com inconsistencias de datas, status, movimentacao, valores, ids e campos usados pelo refresh leve do Firestore. Para auditar um backup especifico:

```bash
npm run audit:transactions -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json
```

Registros marcados com `isExcluded=true` sao ignorados por padrao porque o app tambem os oculta. Para auditar tudo, inclusive quarentena:

```bash
npm run audit:transactions -- --include-excluded
```

## Auditoria de Integridade Financeira

Para identificar riscos operacionais antes dos relatorios e baixas:

```bash
npm run audit:integrity
```

Essa auditoria nao altera o Firebase. Ela usa o backup local mais recente e gera JSON, Markdown e CSV em `migration-backups/`.

Ela cruza os principais pontos que ja causaram divergencia operacional:

- mesmo `submissionId` ativo em mais de um documento;
- mesmo cliente/CNPJ, vencimento e valor com um registro pago e outro aberto;
- baixa importada como novo lancamento pago enquanto a copia antiga continua pendente;
- lancamento aberto com evidencia de baixa/pagamento;
- pago sem evidencia minima de baixa;
- contas a receber sem valor;
- contas a pagar sem valor;
- conflito ou ausencia de `N.Cliente`;
- valores preenchidos simultaneamente como pagar e receber;
- diferenca entre `totalCobranca` e `honorarios + valorExtra`.

Para exportar Firestore e auditar em seguida:

```bash
npm run audit:integrity:fresh
```

Para usar em validacao automatica e falhar se houver risco alto ou critico:

```bash
npm run audit:integrity:fail-high
```

Para auditar um backup especifico:

```bash
npm run audit:integrity -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json
```

Para focar somente um periodo de vencimento:

```bash
npm run audit:integrity -- --due-from 2026-05-01 --due-to 2026-05-31
```

Para validar as regras da auditoria com casos sinteticos de duplicidade, baixa e `N.Cliente`:

```bash
npm run test:integrity
```

## Cadastro Oficial de N.Cliente

Para gerar um plano da fonte oficial de `N.Cliente` a partir do backup local mais recente:

```bash
npm run registry:clients
```

Esse comando roda em `dry-run` por padrao e nao altera o Firebase. Ele cria relatorios JSON, Markdown e CSV em `migration-backups/`, separando:

- cadastros prontos, quando CPF/CNPJ ou nome normalizado apontam para um unico `N.Cliente`;
- conflitos, quando o mesmo CPF/CNPJ aparece com mais de um `N.Cliente`;
- cadastros sem `N.Cliente`;
- lancamentos que podem receber backfill seguro porque o cadastro esta pronto.

Para revisar um backup especifico:

```bash
npm run registry:clients -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json
```

Para gravar a colecao `clientRegistry` no Firebase, depois de revisar o relatorio:

```bash
npm run registry:clients:apply
```

Para tambem preencher em `transactions` apenas os lancamentos sem `N.Cliente` e com cadastro por CPF/CNPJ sem conflito:

```bash
npm run registry:clients:backfill
```

Backfill por nome sem CPF/CNPJ fica bloqueado por padrao e deve ser usado somente em revisao assistida com `--allow-name-backfill`.

Para validar a regra com casos sinteticos:

```bash
npm run test:client-registry
```

## Resolucao de Conflitos de N.Cliente

Para gerar um plano de resolucao dos conflitos de `N.Cliente`:

```bash
npm run resolve:client-conflicts
```

Esse comando roda em `dry-run` por padrao e nao altera o Firebase. Ele resolve automaticamente apenas conflitos objetivos:

- um unico valor com origem em `nCliente` vence quando os concorrentes nao possuem essa evidencia;
- pares com zero extra no fim, como `138` versus `1380`, quando existe diferenca forte de ocorrencias;
- um numero dominante com pelo menos 90% da evidencia.

Por padrao, apenas grupos com CPF/CNPJ entram na resolucao automatica. Para incluir grupos antigos que so possuem nome do cliente:

```bash
npm run resolve:client-conflicts -- --include-name-only
```

Para aplicar depois da revisao do relatorio:

```bash
npm run resolve:client-conflicts:apply
```

Para validar as regras com casos sinteticos:

```bash
npm run test:client-conflicts
```

## Aplicacao Manual de N.Cliente Oficial

Quando a auditoria encontrar cadastros sem `N.Cliente` e nao houver evidencia segura no historico, gere um template para preenchimento pelo cadastro oficial:

```bash
npm run client-numbers:map -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json
```

O comando cria um `.template.csv` ao lado do relatorio. Preencha apenas a coluna `clientNumber` com o codigo oficial e rode um dry-run:

```bash
npm run client-numbers:map -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json --map migration-backups/client-number-map-plan-YYYYMMDDTHHMMSSZ.template.csv
```

Depois de revisar o Markdown gerado, aplique:

```bash
npm run client-numbers:map:apply -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json --map migration-backups/client-number-map-plan-YYYYMMDDTHHMMSSZ.template.csv
```

Esse fluxo atualiza os lancamentos sem `N.Cliente` e as entradas correspondentes em `clientRegistry`, sempre por CPF/CNPJ ou nome normalizado exato. Ele nao inventa codigo e nao altera registros que ja tenham outro `N.Cliente`.

Para limitar a lista a um mes ou periodo especifico:

```bash
npm run client-numbers:map -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json --due-from 2026-05-01 --due-to 2026-05-31
```

## Normalizacao de Transacoes

Para preparar um plano de correcoes seguras a partir do backup local mais recente:

```bash
npm run normalize:transactions
```

Esse comando roda em `dry-run` por padrao e nao altera o Firebase. Ele planeja apenas normalizacoes seguras: `updatedAt` ausente, datas parseaveis, aliases de status/movimentacao, valores numericos gravados como texto, totais derivados seguros e ajustes pequenos de componentes quando `totalCobranca` bate com `valueReceived`.

Para revisar um backup especifico:

```bash
npm run normalize:transactions -- --input migration-backups/firestore-data-backup-YYYYMMDDTHHMMSSZ.json
```

Para aplicar de forma controlada, use `--apply` somente depois de revisar o Markdown gerado. Tambem e possivel limitar por lote:

```bash
npm run normalize:transactions -- --apply --limit 100
```

Tambem e possivel executar grupos especificos:

```bash
npm run normalize:transactions -- --only paymentDates
npm run normalize:transactions -- --only directions
npm run normalize:transactions -- --only business
npm run normalize:transactions -- --only recommended
npm run normalize:transactions -- --only totalComponents
```

Para colocar em quarentena logica transacoes irrecuperaveis, sem excluir documentos:

```bash
npm run quarantine:transactions
```

Esse comando tambem roda em `dry-run` por padrao. Em `--apply`, ele marca os documentos com `isExcluded=true`, `exclusionReason`, `excludedAt` e `updatedAt`.

Para colocar em quarentena logica apenas copias duplicadas de transacoes ativas:

```bash
npm run quarantine:duplicates
```

Esse comando tambem roda em `dry-run` por padrao. Ele agrupa por movimento, cliente/documento, vencimento, valor e detalhe do lancamento. Em contas a receber, tambem reconhece a sombra de baixa quando uma versao paga e outra pendente compartilham cliente, vencimento e valor com competencia/observacao compativel; nesses casos o documento pago fica ativo e a copia pendente entra em quarentena logica. Em contas a pagar, `observacaoAPagar` entra na chave para nao tratar despesas iguais de pessoas diferentes como duplicidade. Em `--apply`, apenas as copias excedentes recebem `isExcluded=true`; o documento mestre fica ativo.

## Pre-Manutencao

Antes de qualquer alteracao manual em dados, rode o pacote completo de seguranca:

```bash
npm run maintenance:precheck
```

Esse comando cria um backup local do codigo, exporta Firestore, roda a auditoria de transacoes e roda a auditoria Auth/Firestore. O resumo fica em `migration-backups/pre-maintenance-*.md`.

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

## Performance Firestore

O carregamento inicial ainda busca a base financeira oficial completa para preservar filtros, relatorios e KPIs sem mudanca visual. Depois disso, o auto-refresh evita baixar todas as transacoes a cada ciclo: primeiro consulta um fingerprint leve da colecao (`count` + ultimo `updatedAt`) e so faz nova leitura completa quando ha mudanca detectada ou apos uma reconferencia programada.

As alteracoes feitas pelo app em `transactions` gravam `updatedAt` automaticamente para que essa checagem detecte baixas e novos lancamentos sem varrer a colecao inteira.

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
