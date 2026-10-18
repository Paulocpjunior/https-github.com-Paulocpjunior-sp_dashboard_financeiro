# FiA — Assistente Financeira

Nome aprovado por Paulo: Financeiro + IA. A identidade MiA permanece no DP/Folha; esta alteração não muda nomes em outros módulos.

Implementação preparada em 11/10/2026; não habilitada em produção até a publicação do novo SHA autorizado.

## Operação

- Rotas `/api/financial-ai/status` e `/api/financial-ai/query`, autenticadas com Firebase e verificação de revogação.
- Perfil ativo admin/operacional; bloqueados/excluídos recusados. Escopo de leitura de transações acompanha as regras atuais, nas quais usuários ativos consultam o painel. Nenhum acesso a segredos, usuários de terceiros ou coleções arbitrárias.
- Frontend envia IDs do recorte, nunca valores como fonte confiável. Servidor relê todos os IDs no Firestore, até 300; ausentes/excluídos bloqueiam a resposta em vez de truncar. Lotes podem ter instantes de leitura distintos, não são snapshot transacional global.
- Dados mínimos: ID, nome/descrição, datas, situação, direção, valores numéricos e saldo parcial. CPF/CNPJ, contatos, anexos e notas livres não são enviados ao provedor. Pergunta do próprio usuário também é enviada; não inserir segredos no chat.
- Somente consulta e sugestão de filtros. Não possui ferramentas de emissão, envio, pagamento, baixa ou alteração de cadastros. Filtros passam por allowlist/validação de datas no servidor.
- Resposta identifica quantidade e horário da releitura do recorte. Projeção não presume saldo bancário nem cobertura de todo o histórico. Respostas do modelo exigem conferência humana; não substituem cálculos contábeis determinísticos.
- Quota persistente por usuário em `financialAIUsage`: intervalo mínimo 3 segundos, 100 consultas/dia UTC, incluindo tentativas que falham após reserva. Coleção sem acesso direto ao cliente. Não armazena perguntas/respostas.

## Infraestrutura e implantação

Vertex AI no mesmo projeto, autenticação pela identidade do Cloud Run via ADC. Nenhuma chave no navegador. Modelo escolhido sozinho desde 18/10/2026 (`cloud-run/pdf-download-service/gemini-motor.js`): o mais novo Gemini Flash que o Vertex lista, conferido a cada 6 h com a régua do CFI (`gemini-modelo.mjs`); sem lista, `gemini-3.8-flash`. Pino manual: env `FINANCIAL_AI_MODEL`. Endpoint global. Antes: `gemini-2.5-flash`, testado com prompt técnico sem informações financeiras em 11/10/2026. Não é promessa de disponibilidade futura do modelo.

API aiplatform habilitada. A conta de serviço existente já possuía permissões; nenhuma nova atribuição IAM foi adicionada. Não é necessário criar chave de API.

Depois de aprovação do SHA completo: publicar serviço e Hosting usando as travas existentes e configurar `FINANCIAL_AI_ENABLED=true` na revisão nova. Preservar outras variáveis/segredos. Validar status autenticado, acesso negado sem token e uma consulta real autorizada. Para desabilitar: `FINANCIAL_AI_ENABLED=false` com fluxo de publicação autorizado.

125 testes do serviço (incluindo 10 novos de IA), TypeScript e build aprovados durante preparação. Preview `/dev/mia` contém só dados fictícios, excluído do build de produção.

Referência técnica: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart
