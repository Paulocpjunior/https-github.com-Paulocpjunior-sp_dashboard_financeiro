# Composição de créditos agrupados de boletos

Implementação local de 14/10/2026, pendente de publicação autorizada por SHA.

## Operação

1. Importe o extrato e consulte os recebimentos do período.
2. Na linha `BOLETOS RECEBIDOS`, abra **Conferir composição**.
3. Consulte o detalhamento bancário do lote. A lista apresenta boletos com data de crédito correspondente no histórico Boleto Cloud; isso não prova que todos pertençam ao mesmo lote.
4. Confira cada boleto, cliente, pagamento e valor. Selecione somente as baixas individuais comprovadas pelo detalhamento.
5. A soma deve fechar exatamente com o crédito. Informe a referência do relatório, revise e confirme o vínculo com o extrato.
6. Reabra a composição para consultar os membros. Para corrigir a associação, desfaça somente o vínculo com uma justificativa e refaça a conferência. As baixas permanecem intactas.

## Limites explícitos

A conciliação não baixa títulos pendentes e não cria receita. O boleto precisa ter vínculo com seu lançamento, retorno `BANCO` e baixa individual auditada pelo fluxo já existente. Títulos sem vínculo, baixas manuais e retornos ainda não consultados ficam bloqueados para revisão em **Boletos Boleto Cloud**. A importação do extrato resumido, por si só, não fornece a composição individual.

Sem data de crédito ou sem detalhamento individual suficiente, o lote permanece pendente. Não há rateio estimado, seleção automática por coincidência de valor/data ou ajuste automático de juros/descontos/tarifas. Diferenças líquidas/brutas e recebimentos agrupados por intermediários, como PAGAR.ME, exigem tratamento próprio e não são aceitos como lote de boletos por esta funcionalidade.

Não foi validada a composição dos lotes reais do usuário nem aplicada conciliação em produção. A verificação de interface utiliza exclusivamente dados fictícios.

## Controles

- Leitura requer usuário ativo com consultar Itaú, histórico Boleto Cloud e ler recebíveis, ou administrador ativo. Gravação requer também registrar recebimentos.
- Prévia e confirmação revalidam dados, valor em centavos, datas, banco, documento do pagador, beneficiário e auditoria da baixa.
- Confirmação transacional com fingerprint, revisão, idempotência por solicitação e reservas exclusivas por boleto e lançamento.
- Auditoria imutável de confirmar/desfazer; coleções `bankReceivableGroups`, `bankReceivableClaims`, `bankReceivableGroupOperations` incluídas no backup.
- Nenhuma escrita em `transactions`, extrato original, emissão de boletos ou configuração de envios automáticos.
- Até 200 membros por composição e 500 candidatos por data; excedentes bloqueiam para revisão.

## Validação

Testes sintéticos cobrem preservação de fontes, diferença de total, repetição, banco/data/cliente divergentes, ausência de auditoria, baixa manual, alterações após prévia, concorrência, permissões revogadas, idempotência e desvinculação. Interface conferida com seleção, revisão, referência obrigatória e confirmação simulada; layout em desktop e celular.
