# Envio do boleto ao cliente (e-mail e WhatsApp)

Pedido de Paulo em 22/10/2026: ao emitir o boleto, enviar ao cliente o INVITE com o PDF do boleto, por e-mail e por WhatsApp, usando o mesmo cadastro da emissão.

## Como funciona

- **Contatos**: vêm da Regra de faturamento do cliente (`billingProfiles`, chave `doc-<CPF/CNPJ>` e depois `client-<N.Cliente>`), o mesmo cadastro onde fica o endereço de cobrança usado na emissão. O canal só é usado se estiver marcado em "Meio de envio".
- **Quando**: logo após a emissão (individual ou em lote), a tela tenta enviar por cada meio cadastrado. O servidor só envia depois de conferir no Boleto Cloud que o boleto está em aberto, com registro bancário confirmado, e com o mesmo valor, vencimento e pagador. Enquanto o banco não confirma o registro, a tela tenta de novo por cerca de 2 minutos. Depois disso, o envio pode ser feito pelo botão "Enviar" na emissão individual.
- **E-mail**: sai da caixa financeiro@spassessoriacontabil.com.br pelo Microsoft 365. Leva o PDF do boleto, o demonstrativo (quando a composição confere) e o convite `.ics`, que contém o próprio PDF do boleto.
- **WhatsApp**: a tela envia pelo SP Connect (`/api/admin/whatsapp/enviar`, departamento `financeiro`) com a sessão do usuário. O modelo precisa ter cabeçalho de documento; o PDF do boleto vai como documento.
- **Trava**: cada boleto vai uma vez por canal (`boletoDeliveries`). Envio confirmado ou sem confirmação só é repetido com motivo (mínimo 10 caracteres). Falha comprovada pode tentar de novo. Tudo fica em `boletoDeliveries/{id}/events` (envio, reenvio com motivo e resultado).
- **Sandbox**: boleto de teste nunca é enviado ao cliente.

## O que falta para ativar (Paulo)

### E-mail (Microsoft 365)

1. No Microsoft Entra, um aplicativo com permissão de aplicativo `Mail.Send`, restrita à caixa financeiro@ (Application Access Policy).
2. No Cloud Run `sp-pdf-download`, definir `FINANCEIRO_GRAPH_TENANT_ID`, `FINANCEIRO_GRAPH_CLIENT_ID`, `FINANCEIRO_GRAPH_CLIENT_SECRET` (como segredo) e `FINANCEIRO_COMMUNICATION_SEND_ENABLED=true`.
3. Esta chave não liga a régua de lembretes: o worker da régua continua exigindo a configuração ativa e um agendador, que não existe.

### WhatsApp (SP Connect)

1. No Gerenciador do WhatsApp, criar um modelo UTILITY com cabeçalho DOCUMENTO e aguardar a aprovação da Meta.
2. No SP Connect, em Config Admin, cadastrar o modelo para o departamento `financeiro`, marcar "tem documento" e deixar só um modelo do Financeiro com documento ativo.
3. Variáveis disponíveis para o modelo: `cliente`, `nome`, `valor`, `vencimento`, `numero`, `boleto`.

## Primeiro teste

Emitir um boleto real para um cliente interno cujo cadastro tenha um e-mail e um WhatsApp da equipe, e conferir a chegada antes de liberar para os demais clientes.
