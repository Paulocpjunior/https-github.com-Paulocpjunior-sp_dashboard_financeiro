# Correção de vencimento — Contas a Receber

Quando o vencimento foi lançado errado (ex.: cobrança de novembro lançada com vencimento em outubro):

1. Na lista, abra **Recebimentos da conta** e escolha **Corrigir vencimento**.
2. Informe o vencimento correto e o motivo. Revise "antes → depois" e confirme.
3. O vencimento anterior, o novo, o motivo, autor e horário ficam em `dueDateAmendments` e em `receivableAudit` (`due-date-amendment`).

Só é aceita para conta em aberto, sem recebimento registrado, sem boleto emitido ou vinculado (Boleto Cloud, conciliação ou resolução manual de RET) e fora da integração Wix. Também é recusada se já existir conta com o mesmo CPF/CNPJ e valor no novo vencimento. Conta com baixa precisa ser estornada antes; boleto já emitido mantém o vencimento original no banco e precisa ser tratado no Boleto Cloud.

Permissão nova: `receivables.amend` (Corrigir vencimento de contas a receber). Administradores já têm acesso; colaboradoras recebem pela tela de usuários.

Publicação: backend `sp-pdf-download` e Hosting no mesmo SHA autorizado, conforme AGENTS.md.
