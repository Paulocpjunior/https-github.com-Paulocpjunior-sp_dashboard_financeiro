# Tesouraria Wix — relatório de vendas x resgatado x a receber

Dentro do modal **Tesouraria Wix** (mesmo menu, mesma URL do app), a aba **Relatório de vendas** consulta a Wix e confronta, por pedido da loja:

| Coluna | De onde vem |
| --- | --- |
| Vendido / pago pelo cliente | Pedidos eCommerce da Wix (`POST /ecom/v1/orders/search`), por data de criação no horário de Brasília |
| Em liberação / disponível / resgatado | Registros do saldo Wix Payments (`POST /wixpay-balances/v5/balance-records/query`) casados pelo ID do pedido |
| Resgates do período | Transferências ao banco (`GET /wixpay-payouts/v4/payouts`) |
| Saldo hoje | Soma dos registros com etiqueta `PENDING` e `AVAILABLE` |
| Lançado no Financeiro | Existe o documento `transactions/wix-{ID do pedido}` criado pelo `/sync-wix-orders` |

Situações por pedido: **Resgatado**, **Disponível para resgate**, **Em liberação na Wix** (com a data prevista), **Aguardando pagamento do cliente**, **Pago fora do Wix Payments** (pagamento manual/offline — conferir no banco) e **Cancelado** (fica fora das somas). Movimentos do saldo sem pedido da loja (faturas Wix, estornos, ajustes) aparecem somados à parte. O relatório exporta CSV (ponto e vírgula, abre direto no Excel).

**Somente leitura.** Não grava nada na Wix nem em `transactions`; o resgate continua sendo feito na página oficial de transferências pelo botão **Abrir Tesouraria Wix**.

## Conta Wix Pagamentos Brasil: liberações calculadas automaticamente

A conta da SPcontabil é do Wix Pagamentos Brasil (`/wix-payments/br/`, conta N.º 002). As APIs de saldo e resgates acima são do Wix Payments dos EUA e da Europa, e o painel brasileiro não mostra o ID da conta. Sem `WIX_PAYMENTS_ACCOUNT_ID`, o servidor lê as transações do caixa da Wix (`GET /payments/v2/transactions`, de 400 dias antes do período até hoje, para pegar parcelas de cartão ainda em aberto) e prevê cada parcela com as regras da Wix Brasil:

| Forma | Taxa | Liberação |
| --- | --- | --- |
| Cartão | 3,7% + R$ 0,30 por venda, dividida pelas parcelas | parcela k em 30·k + 1 dias, passando o fim de semana para segunda |
| Pix | 0,95% | no mesmo dia |
| Boleto | R$ 2,99 | 5 dias depois (o arquivo da Wix varia de 2 a 8) |

As regras foram conferidas no Relatório de pagamentos exportado do painel (2.280 parcelas, 2022–2026): as taxas batem no centavo, e as datas de cartão batem ou ficam a 1 dia. Parcela com data já passada conta como **Liberado pela Wix**; as demais, como **A receber**. Faturas Wix e links de pagamento entram em "Recebimentos sem pedido da loja". Os valores aparecem como previstos no modal. Se a chave não puder ler as transações, o relatório de vendas continua saindo e mostra o motivo.

## Onde roda

Backend `sp-pdf-download` (Cloud Run, `us-central1`), módulo `cloud-run/pdf-download-service/wix-treasury.js`, rota interna `/api/wix-treasury/report` pelo Hosting (mesmo padrão de `/api/itau/**`). Exige sessão Firebase válida e usuário ativo, o mesmo critério de acesso ao modal. Mesmo padrão de credencial da integração da loja no app da Legalização (`backend/wix-provider.js`): API key no header `Authorization` + `wix-site-id`.

## Como ligar

1. Na Wix (conta dona do site SPcontabil), em **API Keys**, gerar ou editar uma chave com as permissões **Read Orders** e **View settlement reports and payouts**, liberada para o site `1e7a5d33-26d6-4f39-8f4c-be9452b1eb10`. Pode ser a mesma chave do `wix-sync-service`, se ela já tiver essas permissões.
2. Guardar a chave no Secret Manager (nunca em `VITE_*`, código ou logs) e vincular ao `sp-pdf-download` como `WIX_API_KEY`.
3. Cadastrar `WIX_PAYMENTS_ACCOUNT_ID` com o ID da conta Wix Payments. Sem ele o relatório mostra só as vendas e avisa o que falta.
4. `WIX_SITE_ID` é opcional: o padrão é o site SPcontabil.

```bash
gcloud run services update sp-pdf-download --region us-central1 \
  --update-secrets WIX_API_KEY=<nome-do-secret>:latest \
  --update-env-vars WIX_PAYMENTS_ACCOUNT_ID=<id-da-conta-wix-payments>
```

A publicação do Hosting (rota `/api/wix-treasury/**`) segue a regra do repositório: só com autorização de Paulo pelo SHA completo.

## Testes

`node --test cloud-run/pdf-download-service/wix-treasury.test.js` (incluído no `npm test` do serviço): classificação por pedido, totais, período, permissões, credencial ausente sem chamada à Wix e mensagem de chave sem permissão.
