# Integrações bancárias do Financeiro

Decisão de escopo de Paulo, 11/10/2026: uma conta operacional, Itaú 3145 / 99791-6, com duas frentes complementares. Este documento distingue o código existente do projeto futuro; não certifica funcionamento bancário em produção.

## 1. Retorno de boletos — existente

Itaú → Boleto Cloud → API do Financeiro → recebível vinculado.

O job `boleto-return-job.js` consulta emissões nativas, vínculos históricos confirmados e situações do histórico. Em `boleto-returns.js`, `evaluate` exige identidade da emissão, conta, pagador, valor, datas e pagamento de origem BANCO, sem marcação manual. Valor diferente, juros/desconto, vínculo inconsistente e alteração após baixa são encaminhados para revisão. Não é uma autorização irrestrita para baixar todos os recebíveis.

A aplicação grava a baixa e `boletoSettlementAudit` em transação. Repetição da mesma evidência não soma valor novamente. Auditoria existente impede reaplicar uma baixa cujo lançamento foi restaurado para pendente. Vínculos históricos têm seu próprio fluxo explícito em `boleto-reconciliation.js` e `boletoReconciliationSettlements`.

A consulta de histórico, isoladamente, não comprova vínculo com contas a receber. O código das proteções foi revisado; a execução atual do job e os pagamentos reais não foram auditados nesta alteração.

## 2. Conciliação bancária — fonte intermediária e destino futuro

Hoje: OFX → `bankStatements/itau-3145-997916/entries` → comparação com baixas nativas a pagar.

Futuro: API direta Itaú → normalização de movimentos da mesma conta → conciliação de créditos/recebimentos e débitos/pagamentos.

A comparação entregue no PR #67 é somente sugestão: mesmo valor efetivo e até três dias corridos, com ambiguidades explícitas. Não persiste vínculo nem faz baixa. A API direta do Itaú e a conciliação automática ainda não estão implementadas. Não presumir que acesso à API de cobrança dá acesso ao extrato, Pix ou pagamentos; a documentação e os escopos efetivamente contratados determinarão o adaptador.

## 3. Modelo alvo — a implementar após validar o contrato Itaú

Separar três entidades: obrigação (conta a pagar/receber), evento de pagamento e movimento bancário. Uma conciliação associa o movimento a um ou mais pagamentos; não cria um novo pagamento quando ele já existe.

Preservar identificador de origem, conta, direção, valor em centavos, datas de pagamento/crédito, horário de consulta, cobertura e referência da evidência. Usar identificadores bancários disponíveis e documentados; não assumir igualdade entre FITID do OFX e ID da API. Enquanto não houver prova de equivalência, sobreposições entre fontes exigem revisão e não entram duas vezes no total conciliado.

Vínculos e alocações precisam ser atômicos e auditáveis. A soma das alocações não pode exceder o movimento nem o saldo conciliável do pagamento. Agrupamentos, tarifas, diferenças, pagamentos parciais e estornos exigem regras próprias; sem evidência suficiente ficam pendentes. Importação repetida e chamadas concorrentes devem produzir um único efeito.

## 4. Ordem de chegada dos eventos

| Situação | Comportamento exigido do fluxo futuro |
|---|---|
| Boleto Cloud baixa primeiro; crédito Itaú chega depois | Vincular o crédito ao pagamento existente, sem nova baixa. |
| Crédito Itaú chega antes do retorno do boleto | Manter movimento aguardando vínculo; não baixar por coincidência de valor/data. |
| Mesma informação é consultada repetidamente | Atualizar consulta sem recriar movimento, pagamento ou alocação. |
| Pagamento nativo a pagar já registrado | Conciliar o débito com o pagamento existente, inclusive parcial. |
| Crédito/débito sem pagamento registrado | Exigir vínculo e evidência suficientes antes de registrar qualquer baixa. |
| Retorno e API são processados simultaneamente | Revalidar dentro de transação a obrigação, o pagamento e as alocações. |
| Estorno ou divergência após conciliação | Abrir revisão e preservar histórico; não apagar ou desfazer baixa automaticamente. |

## 5. Execução e critérios de aceite

1. Homologar o extrato OFX e as sugestões com arquivo real, conferindo período, sinais, cobertura e conta. Não alterar saldos para teste.
2. Implementar vínculos de conciliação e revisão humana, separados das baixas e com permissões próprias. Incluir rastreabilidade do recebimento já confirmado pelo Boleto Cloud.
3. Ao liberar a API Itaú, levantar contrato real, autenticação, identificadores, paginação, datas, limites e mecanismos de atualização. Guardar credenciais no cofre; não no frontend.
4. Implementar adaptador e ingestão idempotente com sobreposição temporal e controle de cobertura. Validar OFX/API sem dupla contagem.
5. Automatizar somente correspondências com evidência inequívoca; manter revisão para valor/data, agrupamentos e diferenças.
6. Validar as duas ordens de chegada, concorrência, repetição, retorno manual versus bancário, tarifa, parcial, estorno, falha de paginação e revogação de acesso.
7. Publicar cada entrega mediante autorização do SHA completo e conferir versão, serviço e fluxo real. Uma versão publicada não equivale à homologação da futura API bancária.

Não são parte desta entrega: conexão API Itaú, pagamento/transferência bancária, nova emissão de boleto, baixa de dados reais ou ativação de alçadas. Nenhum contrato homologado é removido.
