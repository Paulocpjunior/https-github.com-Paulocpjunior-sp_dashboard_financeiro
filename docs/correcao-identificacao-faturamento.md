# Correção de Empresa, CPF/CNPJ e N.Cliente — Base de Faturamento

Na **Base de Faturamento**, o lápis **Editar regra** abre a "Regra de faturamento e envio". Empresa, CPF/CNPJ e N.Cliente deixaram de ser campos cinza: qualquer colaboradora ativa pode corrigi-los, junto com o restante da regra.

1. Corrija o nome, o CPF/CNPJ ou o N.Cliente.
2. Ao mudar qualquer um dos três, aparece **Motivo da correção da identificação** (mínimo 10 caracteres).
3. Salve. A tela recarrega com a identificação nova no histórico e na Base de Faturamento.

O servidor (`sp-pdf-download`, rota `customers/billing-profile`) faz tudo numa transação:

- CPF/CNPJ precisa ter dígitos verificadores válidos; documento ou número já preenchido não pode ficar em branco.
- Recusa CPF/CNPJ ou N.Cliente que pertença a outro cliente (no `clientRegistry` ou em outra correção). Se for a mesma empresa, o caminho é **Cadastros de clientes › Unificar**.
- A correção entra no cadastro de clientes (`financialSettings/customerDirectory`), como as correções de nome. Lançamentos, `clientRegistry` e dados de outros apps não são alterados.
- A regra de faturamento acompanha a nova identificação. A regra antiga fica inativa com `movedTo` e nunca é apagada.

Log: toda gravação da regra cria `billingProfileAudit` (quem, quando, motivo, cadastro e regra antes/depois). Correção de identificação também gera `customerAudit` com o cadastro completo antes e depois.

A gravação da regra passou a ser feita só pelo servidor, também para administradores. Por isso, publique o backend antes do Hosting, no mesmo SHA autorizado, conforme AGENTS.md.
