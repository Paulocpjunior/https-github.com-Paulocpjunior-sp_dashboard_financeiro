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

## Conta Wix Pagamentos Brasil: Relatório de pagamentos importado

A conta da SPcontabil é **Wix Pagamentos Brasil** (`/wix-payments/br/`, conta N.º 002, Pix e boleto). O painel não mostra o `accountId` e as APIs de saldo/resgates acima são do Wix Payments internacional. Por isso o relatório aceita o CSV que o próprio painel exporta:

1. No painel Wix Pagamentos, **Relatório de pagamentos** → exportar (arquivo `funds-report-*.csv`, uma linha por parcela).
2. Na aba **Relatório de vendas**, botão **Importar relatório de pagamentos**. O arquivo vai junto em cada geração (`POST /api/wix-treasury/report` com `{ start, end, fundsCsv }`) e **não é guardado** (nem no navegador, nem no servidor).

Como o arquivo é lido:

| Coluna do CSV | Uso |
| --- | --- |
| `externalOrderId` | Casa a parcela com o pedido da loja (`order.id`). Sem pedido = venda avulsa (link de pagamento), somada à parte. |
| `payableStatus` | `Pago` → **Pago pela Wix** (depósito automático às segundas ou resgate); `Aguardando pagamento` → **em liberação**. |
| `paymentDate` | Data em que a Wix paga (ou pagou) a parcela. |
| `transactionCreationDate` | Período: entram as parcelas das vendas criadas no período (horário de Brasília). |
| `amount` / `wixFee` / `netAmount` | Bruto, taxa e líquido da parcela (formato `1.234,56`). |
| `payableType` | `Crédito`, `Reembolsar` (estorno) e `Chargeback`. |

Venda parcelada pode ter parcelas pagas e outras a liberar: os cartões somam **por parcela**. **A liberar pela Wix hoje** soma todas as parcelas `Aguardando pagamento` do arquivo, de qualquer período; **Pagamentos da Wix no período** soma as parcelas pagas por dia dentro do período (inclui vendas anteriores). Com o arquivo importado, a API de saldo/resgates não é chamada, mesmo que `WIX_PAYMENTS_ACCOUNT_ID` exista.

## Onde roda

Backend `sp-pdf-download` (Cloud Run, `us-central1`), módulo `cloud-run/pdf-download-service/wix-treasury.js`, rota interna `/api/wix-treasury/report` pelo Hosting (mesmo padrão de `/api/itau/**`). Exige sessão Firebase válida e usuário ativo, o mesmo critério de acesso ao modal. Mesmo padrão de credencial da integração da loja no app da Legalização (`backend/wix-provider.js`): API key no header `Authorization` + `wix-site-id`.

## Como ligar

1. Na Wix (conta dona do site SPcontabil), em **API Keys**, gerar ou editar uma chave com as permissões **Read Orders** e **View settlement reports and payouts**, liberada para o site `1e7a5d33-26d6-4f39-8f4c-be9452b1eb10`. Pode ser a mesma chave do `wix-sync-service`, se ela já tiver essas permissões.
2. Guardar a chave no Secret Manager (nunca em `VITE_*`, código ou logs) e vincular ao `sp-pdf-download` como `WIX_API_KEY`.
3. Opcional, só para conta Wix Payments internacional: cadastrar `WIX_PAYMENTS_ACCOUNT_ID`. Sem ele (caso da conta Brasil), o relatório mostra as vendas e pede o Relatório de pagamentos importado.
4. `WIX_SITE_ID` é opcional: o padrão é o site SPcontabil.

```bash
gcloud run services update sp-pdf-download --region us-central1 \
  --update-secrets WIX_API_KEY=<nome-do-secret>:latest \
  --update-env-vars WIX_PAYMENTS_ACCOUNT_ID=<id-da-conta-wix-payments>
```

A publicação do Hosting (rota `/api/wix-treasury/**`) segue a regra do repositório: só com autorização de Paulo pelo SHA completo.

## Testes

`node --test cloud-run/pdf-download-service/wix-treasury.test.js` (incluído no `npm test` do serviço): classificação por pedido, totais, período, permissões, credencial ausente sem chamada à Wix, mensagem de chave sem permissão e o Relatório de pagamentos importado (valores e datas BR, parcelas pagas/a liberar, envio por POST, arquivo grande ou vazio).
