# Desligamento do Jotform no Financeiro

Solicitado por Paulo em 12/10/2026. Preparado no código; ainda não aplicado em produção.

## Escopo

- Bloquear webhook, reconciliação, alteração de respostas e consulta do checklist antes de chamadas externas ou gravações.
- Preservar transações, clientes e eventos históricos no Firestore, os dados na conta Jotform e as funcionalidades nativas do Financeiro.
- Manter a Base de Faturamento e consultar seus cadastros diretamente no Firestore. A consulta contratual externa está desativada. Não substituir ausência de dados por checklist vazio ou mensalidade conferida.
- Pausar o Scheduler `jotform-reconcile-missed-webhooks`, remover as credenciais do runtime atual e redirecionar todas as tags antigas para a revisão desativada.
- Não revogar a chave global da conta Jotform: sua utilização por outros apps não foi inventariada. Revisões antigas podem reter configurações, mas deixam de receber tráfego pelas URLs normais e tags. IAM administrativo continua podendo alterar isso.

## Publicação protegida

Após aprovação de Paulo para o SHA completo atual da main:

1. Conferir menus/contratos da produção, executar testes, gerar build e informar `FINANCEIRO_APPROVED_COMMIT` com o SHA expressamente aprovado.
2. Executar `python3 scripts/retire-jotform.py`. O script exige o guard original, implanta revisão sem tráfego, verifica o bloqueio, pausa o agendamento e promove o corte para todas as tags. Guarda somente metadados de roteamento, sem segredos.
3. Executar o deploy oficial do Hosting para o mesmo SHA. A etapa existente de fixação do checklist passa a exigir a revisão desativada.
4. Conferir saúde com `jotformEnabled: false`, HTTP 410 nas rotas legadas, Scheduler PAUSED, ausência das duas credenciais no runtime atual e consulta dos cadastros do Firestore na interface. Registrar as evidências sem chaves.

Em caso de falha, manter o corte já aplicado e corrigir a etapa restante; não reativar automaticamente credenciais, Scheduler ou revisões antigas. Uma reversão precisa de decisão explícita de Paulo.

## Pendência funcional

A consulta do aplicativo lê clientRegistry e billingProfiles diretamente no Firestore, com o token do usuário e as regras existentes. A lista mensal mantém o histórico de transactions no Firestore. Campos operacionais não são convertidos em eventos ou valores contratuais: essas lacunas permanecem explícitas, sem impedir a consulta dos dados disponíveis. O antigo endpoint Jotform permanece bloqueado.

## Checklist do Legal (20/10/2026)

Paulo esclareceu que o Checklist é um formulário à parte, do departamento Legal (Jotform `210135417457653`, "Check List Atual 2026"), e que ele orienta todos os apps: entrada e saída de clientes, valores, tributação, serviços contratados, alterações contratuais e baixas. O desligamento acima vale para o formulário de caixa (`210020525580845`); a leitura do Checklist volta, só para consulta.

- O servidor libera somente `POST /api/billing-checklist/review`, com sessão Firebase e perfil financeiro ativo. Webhook, reconciliação e alteração de respostas seguem em HTTP 410.
- A chave fica no Secret Manager (`jotform-checklist-api-key`), exposta ao runtime como `JOTFORM_CHECKLIST_API_KEY`. Usar uma chave Jotform de leitura. `JOTFORM_API_KEY` e `JOTFORM_RECONCILE_KEY` continuam fora do runtime.
- A tela mostra o Checklist do Legal e mantém a consulta aos cadastros do Firestore. A lista mensal escolhe a fonte; o padrão é o Checklist.

Publicação, com o SHA completo aprovado em `FINANCEIRO_APPROVED_COMMIT`:

1. `python3 scripts/enable-legal-checklist.py` (Cloud Shell ou Mac com gcloud). Na primeira vez pede a chave sem exibi-la e cria o segredo.
2. Deploy oficial do Hosting pelo GitHub Actions com o mesmo SHA. A fixação da rota exige `checklistReadEnabled: true`, então o Hosting não publica a tela antes do servidor.

## Checklist do Legal sai do Jotform (28/10/2026)

Paulo: "todos apps passam a ler o checklist do app legalizacao, jotform morre". A tela passa a ler o checklist do app Legalização pelo túnel do CFI (`GET /api/admin/cadastro/checklist-legalizacao`), com o token do usuário logado. Os honorários só vêm quando o token é deste projeto; sem eles a leitura é recusada, nunca mostrada como completa.

- Uma linha por empresa (`legalizacao/<id>`), não mais por resposta do formulário. O STATUS, as datas de entrada, saída e suspensão, o nosso número e a última observação vêm do app.
- O cadastro de cliente a partir do checklist (`client-registration.js`) aceita `legalizacao/<id>`; respostas numéricas antigas continuam válidas para o histórico. Vale após o deploy do `pdf-download-service`.
- A rota `POST /api/billing-checklist/review` deixa de ser chamada pela tela. Desligá-la (`CHECKLIST_READ_ENABLED = false`) e remover `JOTFORM_CHECKLIST_API_KEY` do runtime é o passo seguinte, com o roteiro de publicação protegida acima.
