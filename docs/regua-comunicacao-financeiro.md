# Régua de comunicação — base técnica, 11/10/2026

## Estado real

Base de planejamento, reserva transacional e processamento implementada em `communication-rule.js`, com testes sintéticos. A etapa seguinte acrescenta configuração administrativa e conector Microsoft Graph, ainda não publicados. **Não existe job agendado, ligação das fontes reais ao processador nem ativação em produção nesta entrega.** Nenhum e-mail foi enviado e nenhuma coleção foi criada no banco real. O INVITE existente continua funcionando como download.

Remetente e resposta definidos por Paulo: **financeiro@spassessoriacontabil.com.br**. Essa definição não comprova permissão técnica de envio no Microsoft 365/gateway. Não reutilizar credenciais ou autorização de outro departamento. Destinatários reais e frequência ainda precisam ser configurados; não são inferidos de CPF ou de dados antigos.

## Contrato implementado

- Fonte normalizada pelo futuro adaptador do servidor: identificador, tipo pagar/receber, revisão, vencimento, valor em centavos, situação e confirmação da fonte. Não aceitar esse contrato diretamente do navegador.
- Destinatário individual validado e confirmado administrativamente. Identidade da etapa usa conta, tipo, vencimento e deslocamento, sem incluir endereço ou revisão; uma edição não recria silenciosamente a mesma etapa.
- Até cinco etapas explicitamente escolhidas entre 30 dias antes e o vencimento. Não há frequência padrão ativada. Horário técnico desta versão: 12:00 UTC. Etapas anteriores ao planejamento expiram, sem disparo retroativo em lote.
- Pós-vencimento está bloqueado: o INVITE atual exige boleto vigente; atraso necessita fluxo próprio de documento e mensagem.
- Reserva Firestore transacional exclusiva, prazo de cinco minutos e evento por tentativa. Execução desativada por padrão.
- Revalidação da fonte e da autorização antes e após preparar anexos. Pagamento integral ou parcial, exclusão, cancelamento e revisão divergente suspendem a etapa. No parcial, nunca enviar a cobrança integral antiga.
- PDF obrigatório, cabeçalho validado e limite total de 6 MB. Até três anexos. O adaptador deverá preparar boleto, demonstrativo quando aplicável e ICS usando os geradores existentes.
- Resultado `accepted` significa somente aceite pelo provedor, com identificador de mensagem quando fornecido ou referência de correlação separada no Graph. Nunca representa entrega, leitura ou pagamento.
- Timeout, resposta inconclusiva e reserva abandonada ficam `unknown`, sem retentativa automática. Falha ao persistir após envio também não libera novo envio. Reprocessamento manual e consulta ao provedor ainda não implementados.
- `authorize(job)` deverá reler usuário responsável, configuração ativa, remetente e destinatário atuais. Ausência, falha ou revogação bloqueiam envio. `readSource` deverá conferir o estado bancário/financeiro autoritativo; falha de consulta não equivale a conta aberta.

Coleções planejadas: `financialCommunications` e `financialCommunicationEvents`, incluídas no backup. As regras atuais negam acesso direto do navegador. Somente o futuro serviço autenticado deverá acessá-las. O módulo não escreve em lançamentos, boletos ou saldos.

## Limites e próxima integração

1. Verificar canal autorizado e permissão da caixa remetente. Escolher e implementar o adaptador com timeout, referência idempotente e consulta de resultado; HTTP 202 não é entrega.
2. Implementar adaptadores de fontes reais a pagar/receber e política administrativa, com revisão consistente. Para receber, confirmar boleto registrado e situação atual no emissor; para pagar, destinatários internos configurados e documento da conta.
3. Criar prévia e configuração no modal de manutenção, com destinatários, dias, anexos e autorização explícita. A configuração administrativa é separada das alçadas financeiras, que continuam desativadas.
4. Implementar rotas com autenticação, permissões e histórico, e job com identidade de serviço. Nunca chamar o transporte dentro de uma transação Firestore, pois a transação pode repetir.
5. Acrescentar retorno autenticado do provedor para entrega/falha, vinculado ao identificador; implementar cancelamento das etapas pendentes e revisão dos resultados incertos.
6. Homologar envio único para destinatário autorizado: anexos, resposta, calendário, duplicidade, falha de rede e pagamento antes do disparo. Confirmar backup/restauração das coleções.
7. Publicar somente com SHA autorizado; ativação de envio deve ocorrer depois da homologação.

Existe intervalo inevitável entre a última consulta e a aceitação do provedor: pagamento ocorrido nesse intervalo pode coincidir com o lembrete. Não prometer cancelamento de e-mail já aceito nem atualização automática de um ICS já importado. A mensagem deve orientar a desconsiderar caso já pago.

## Configuração e conector preparados

- Manutenção → Lembretes e INVITE: dias de envio e destinatários internos a pagar, revisão e motivo obrigatório; envio continua desativado. Endereços internos nunca viram destinatários de contas a receber.
- GET/POST `/api/financial-entries/communication-settings`: administrador ativo, revalidação na transação, controle de revisão e auditoria em `financialSettingsAudit`. Não grava lançamentos. Persistência em `financialSettings/communicationRule`, coberta pelo backup existente.
- Não aceita `enabled: true`, nem alteração do remetente por parâmetro. Credenciais não são devolvidas ao navegador. Presença de configuração não prova permissão da caixa ou entrega.
- Conector em `communication-provider.js`: somente caixa financeiro@spassessoriacontabil.com.br; variáveis exclusivas `FINANCEIRO_GRAPH_TENANT_ID`, `FINANCEIRO_GRAPH_CLIENT_ID`, `FINANCEIRO_GRAPH_CLIENT_SECRET` e chave de ativação `FINANCEIRO_COMMUNICATION_SEND_ENABLED`. Não lê os segredos do CFI/DP. Nenhuma rota aciona o conector nesta etapa.
- Microsoft Graph `sendMail`: texto, PDF/ICS e cópia em Enviados. Redirecionamentos proibidos, timeouts limitados, sem retentativas ocultas e sem expor corpo de erro. Cada anexo menor que 3 MB e envelope JSON até 3,9 MB. Arquivos maiores bloqueiam; nunca remove anexos silenciosamente.
- HTTP 202 gera `accepted` com referência interna de correlação; não inventa message-id e não comprova entrega. Falta implementar consulta de envio/retorno de entrega e tratamento manual de resultados incertos.

Em 11/10, consulta somente dos nomes de configuração do serviço `sp-pdf-download` e dos nomes dos segredos no projeto Financeiro não encontrou credenciais de Graph/e-mail. Não foi possível comprovar permissão de envio da caixa. Nenhum segredo de outro departamento foi lido ou copiado e nenhum consentimento/IAM foi alterado.

Validação desta etapa: testes sintéticos do conector, autenticação da rota, alteração com revisão/auditoria, bloqueio de ativação e de reenvio; prévia local com revisão, salvamento simulado e recarga. Homologação com Microsoft 365 real e envio para destinatário autorizado continuam pendentes.

Referência oficial: https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0 — resposta 202 significa aceite; não confirma processamento completo ou entrega.
