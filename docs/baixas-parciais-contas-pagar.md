# Contas a pagar: baixas parciais e ajustes

Implementação de 10/10/2026. Campos comparados com o formulário Jotform 210020525580845 (Controle de Caixa), sem alteração no checklist.

- Banco, forma, pago por, autorizado por, favorecido PF/PJ, observação e comprovante seguem os parâmetros efetivos da Manutenção.
- Valor original (`valuePaid`/`valorOriginal`) é preservado. `valorPago` é a soma efetivamente paga; `payableBalance` contém totais em centavos.
- Saldo novo = saldo anterior + juros + multa - desconto - pagamento. Ajustes exigem justificativa. Valores negativos, excesso de pagamento e data anterior à última baixa são recusados.
- Parcial exige saldo positivo e mantém status Pendente (a tabela exibe Parcial). Quitação exige saldo zero e muda para Pago.
- `payablePayments` preserva cada baixa, responsáveis, data, ajustes, comprovantes e saldo. `payableAudit` registra antes/depois. O webhook existente protege contas com `payableSettlement` contra sobrescrita.
- Confirmação exige revisão/versionamento, permissão revalidada e chave idempotente. Clique repetido não duplica pagamento. O modal fecha somente após resposta de sucesso.
- Resumos de títulos, acumulados, gráfico por vencimento, aging, alertas e exportação de valor pago/saldo usam valores efetivos. Filtro por data de baixa continua sendo por **última baixa do título**, não um extrato de parcelas por período. Cada parcela fica no histórico do modal.
- Nenhum pagamento bancário é executado. INVITE da conta parcialmente paga informa o saldo restante. Recorrência conserva a provisão original, sem copiar pagamentos.

Validação: testes de backend sintéticos, idempotência/concorrência, cálculo e leitura REST dos acumulados, lint/build e simulação local de parcial seguida de quitação com desconto. Não houve escrita em dados financeiros reais.

Publicação exige aprovação do SHA completo conforme AGENTS.md; publicar backend e frontend compatíveis. Abas antigas devem ser recarregadas para preencher os novos campos obrigatórios.
