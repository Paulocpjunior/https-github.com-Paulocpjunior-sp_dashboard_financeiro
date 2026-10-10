# Conciliação de boletos antigos

O administrador abre **Boletos Boleto Cloud → Conciliar boletos antigos**, pesquisa o título e abre **Detalhes**. O bloco de conciliação lista lançamentos existentes com o mesmo vencimento e CPF/CNPJ ou valor. A sugestão não é autorização nem vínculo automático.

1. Revisar o lançamento, CPF/CNPJ, referência, conta, valor e vencimento.
2. Consultar a API e apresentar a consequência antes da confirmação.
3. Confirmar vínculo e baixa integral, vínculo para baixa futura ou vínculo sem nova baixa quando o lançamento já estiver pago com data/valor coincidentes.
4. Divergências, pagamento parcial, encargos, marcação manual, cancelamento, ausência de CPF e conta diferente permanecem para revisão. Nenhuma receita é criada.

## Contratos e evidências

- API exige usuário ativo administrador e beneficiário da conta Itaú homologada. Permissão de leitura do histórico não autoriza conciliação.
- Revisão expira após dez minutos e pertence ao usuário, boleto e versão integral do lançamento. Uma nova consulta ao banco precede a confirmação.
- Transação Firestore revalida perfil, revisão, versão do lançamento e exclusividade do vínculo. `transactions.boletoReconciliation` impede dois boletos no mesmo lançamento; documento `boletoReconciliations/<boletoId>` impede dois lançamentos no mesmo boleto.
- `boletoReconciliationAudit` registra ator, revisão e estado original. `boletoReconciliationSettlements` registra antes/depois da baixa, uma vez por boleto. Coleções novas seguem a negação padrão das regras de cliente.
- A revisão e o vínculo não usam login do portal Boleto Cloud. Token e credenciais não são enviados à interface.
- Boletos nativos mantêm sua rotina existente. A emissão de um novo boleto é bloqueada para um recebível já conciliado.
- Webhook Jotform rejeita alterações financeiras tardias de lançamentos vinculados ou com baixa auditada, preservando a versão do Firestore. Checklist continua inalterado.

## Rotina automática

O mesmo job bancário executa uma fila separada de vínculos históricos confirmados, até vinte registros por rodada, com cursor e lease. Apenas vínculos aguardando pagamento são consultados. A configuração `BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED` continua controlando baixas.

A rotina confere novamente identidade, conta configurada, versão do lançamento, pagamento integral e origem bancária. Erros da API preservam dados para nova tentativa; divergências deixam o vínculo em revisão. Não há estorno ou desvinculação automática. Um vínculo em revisão precisa de análise operacional; esta entrega não oferece um comando de forçar baixa ou refazer vínculo.

A tela limita sugestões aos primeiros duzentos lançamentos do vencimento, com aviso explícito quando a consulta é parcial. Um identificador específico pode ser conferido separadamente. Juros, descontos e baixas parciais continuam fora do escopo.

## Publicação e validação

Publicar somente com SHA completo autorizado, preservando guard/predeploy. Ordem: proteção do webhook Jotform, serviço da API, imagem do job, Hosting. Preservar o roteamento do checklist na revisão homologada, conforme o procedimento existente. Conferir menus e versão pública antes de testar o fluxo.

Testes locais usam documentos sintéticos e API simulada: identidade divergente, pagamento manual/parcial, repetição, versão alterada, permissão revogada, revisão expirada, vínculo concorrente, já pago, baixa futura e indisponibilidade da API. Não houve alteração financeira real para validar a interface.
