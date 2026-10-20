# Correção de valores e extras — Contas a Receber

Quando o lançamento saiu sem um extra (ou com honorários errados):

1. Na lista, abra **Registrar recebimento** da conta e escolha **Corrigir valores / extras**.
2. Ajuste os honorários, use **Adicionar valor extra** para cada serviço (lista de extras do cadastro) e informe o motivo.
3. Revise "antes → depois" e confirme. O total, os extras e o demonstrativo passam a usar os novos valores.

Log: cada correção grava `chargeAmendments` no lançamento (valores antes/depois, extras, motivo, autor, horário) e um registro `charge-amendment` em `receivableAudit` com o lançamento completo antes e depois. O histórico aparece em **Histórico de valores**.

Só vale para lançamento feito no Financeiro (nativo), em aberto, sem recebimento ativo e sem boleto emitido ou vinculado. Também é recusada se já existir conta com o mesmo CPF/CNPJ, vencimento e o novo valor.

Boleto já emitido: o banco cobra o valor do título, então a correção é recusada. Para cobrar o adicional, faça um novo lançamento só com o valor extra (que pode ter boleto próprio), ou cancele o boleto no Boleto Cloud antes de corrigir.

Permissão nova: `receivables.adjust` (Corrigir valores e extras de contas a receber). Administradores já têm acesso; colaboradoras recebem pela tela de usuários ou por `python3 scripts/grant-operational-corrections.py --permissions receivables.amend receivables.adjust` (prévia; `--apply` grava).

## Estornar baixa

O botão **Estornar baixa manual** aparece quando a última baixa foi registrada manualmente no Financeiro. Quando não aparece, a tela agora explica o motivo: falta da permissão `receivables.reverse`, baixa automática pelo retorno do banco (boleto pago, `boletoSettlement`) ou baixa vinda do histórico importado. Esses dois últimos casos não têm estorno pela tela e ficam com o administrador.

Publicação: backend `sp-pdf-download` e Hosting no mesmo SHA autorizado, conforme AGENTS.md.
