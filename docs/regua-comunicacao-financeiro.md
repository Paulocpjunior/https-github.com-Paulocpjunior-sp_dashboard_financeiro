# Régua de comunicação — base técnica, 11/10/2026

## Estado real

Base de planejamento, reserva transacional e processamento implementada em `communication-rule.js`, com testes sintéticos. **Não existe rota pública, job agendado, adaptador de envio ou ativação em produção nesta entrega.** Nenhum e-mail foi enviado e nenhuma coleção foi criada no banco real. O INVITE existente continua funcionando como download.

Remetente e resposta definidos por Paulo: **financeiro@spassessoriacontabil.com.br**. Essa definição não comprova permissão técnica de envio no Microsoft 365/gateway. Não reutilizar credenciais ou autorização de outro departamento. Destinatários reais e frequência ainda precisam ser configurados; não são inferidos de CPF ou de dados antigos.

## Contrato implementado

- Fonte normalizada pelo futuro adaptador do servidor: identificador, tipo pagar/receber, revisão, vencimento, valor em centavos, situação e confirmação da fonte. Não aceitar esse contrato diretamente do navegador.
- Destinatário individual validado e confirmado administrativamente. Identidade da etapa usa conta, tipo, vencimento e deslocamento, sem incluir endereço ou revisão; uma edição não recria silenciosamente a mesma etapa.
- Até cinco etapas explicitamente escolhidas entre 30 dias antes e o vencimento. Não há frequência padrão ativada. Horário técnico desta versão: 12:00 UTC. Etapas anteriores ao planejamento expiram, sem disparo retroativo em lote.
- Pós-vencimento está bloqueado: o INVITE atual exige boleto vigente; atraso necessita fluxo próprio de documento e mensagem.
- Reserva Firestore transacional exclusiva, prazo de cinco minutos e evento por tentativa. Execução desativada por padrão.
- Revalidação da fonte e da autorização antes e após preparar anexos. Pagamento integral ou parcial, exclusão, cancelamento e revisão divergente suspendem a etapa. No parcial, nunca enviar a cobrança integral antiga.
- PDF obrigatório, cabeçalho validado e limite total de 6 MB. Até três anexos. O adaptador deverá preparar boleto, demonstrativo quando aplicável e ICS usando os geradores existentes.
- Resultado `accepted` significa somente aceite pelo provedor, com identificador. Nunca representa entrega, leitura ou pagamento.
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
