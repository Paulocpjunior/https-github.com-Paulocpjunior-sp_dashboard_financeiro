# Envio do boleto ao cliente (e-mail e WhatsApp)

Pedido de Paulo em 22/10/2026: ao emitir o boleto, enviar ao cliente o INVITE com o PDF do boleto, por e-mail e por WhatsApp, usando o mesmo cadastro da emissão.

## Como funciona

- **Contatos**: vêm da Regra de faturamento do cliente (`billingProfiles`, chave `doc-<CPF/CNPJ>` e depois `client-<N.Cliente>`), o mesmo cadastro onde fica o endereço de cobrança usado na emissão. O canal só é usado se estiver marcado em "Meio de envio".
- **Quando**: logo após a emissão (individual ou em lote), a tela tenta enviar por cada meio cadastrado. O servidor só envia depois de conferir no Boleto Cloud que o boleto está em aberto, com registro bancário confirmado, e com o mesmo valor, vencimento e pagador. Enquanto o banco não confirma o registro, a tela tenta de novo por cerca de 2 minutos. Depois disso, o envio pode ser feito pelo botão "Enviar" na emissão individual.
- **Reenvio automático pelo servidor (24/10)**: se a tela foi fechada ou o registro do banco demorou mais que os 2 minutos, o job `sp-boleto-returns` (a cada 15 minutos) envia por e-mail o boleto emitido pelo app que nunca foi enviado por esse canal. Mesmas conferências da tela (cobrança em aberto e não vencida, e-mail na Regra de faturamento, registro confirmado, mesmo valor, vencimento e pagador). Enviado, incerto ou com falha não é tocado pelo job. Registro ainda não confirmado espera de forma crescente (até 12 tentativas, `boletoDeliverySweep`). Autor `system:delivery-sweep`, `automatic: true` no envio; resumo em `boletoReturnJobs/delivery-production`. Só pega boleto emitido depois da primeira publicação do job com esta etapa (`BOLETO_DELIVERY_SWEEP_SINCE`, preservado nas publicações seguintes); os anteriores ficam com a equipe pelo botão, ou entram com `--delivery-since` no deploy, só com aprovação do Paulo. WhatsApp continua só pela tela.
- **E-mail**: sai da caixa financeiro@spassessoriacontabil.com.br pelo Microsoft 365. Leva o PDF do boleto, o demonstrativo (quando a composição confere) e o convite `.ics`, que contém o próprio PDF do boleto. O corpo segue o layout padrão dos apps da SP (logo inline, faixa azul, rodapé), o mesmo do Consultor Fiscal (`sefaz-backend/email-layout.js`) e da Legalização, em `cloud-run/pdf-download-service/email-layout.js`. Mudança de layout precisa ser feita nas cascas de todos os apps.
- **INVITE**: todo e-mail leva o convite `.ics` com o PDF do boleto dentro. O WhatsApp leva o PDF; o modelo da Meta só aceita um documento por mensagem, então o convite vai pelo e-mail.
- **WhatsApp**: a tela envia pelo SP Connect (`/api/admin/whatsapp/enviar`, departamento `financeiro`) com a sessão do usuário. O modelo precisa ter cabeçalho de documento; o PDF do boleto vai como documento.
- **Trava**: cada boleto vai uma vez por canal (`boletoDeliveries`). Envio confirmado ou sem confirmação só é repetido com motivo (mínimo 10 caracteres). Falha comprovada pode tentar de novo. Tudo fica em `boletoDeliveries/{id}/events` (envio, reenvio com motivo e resultado).
- **Sandbox**: boleto de teste nunca é enviado ao cliente.

## O que falta para ativar (Paulo)

### E-mail (Microsoft 365)

Reaproveita o mesmo aplicativo que o Consultor Fiscal já usa para mandar e-mail aos clientes ("Consultor Fiscal Inteligente - Notificacoes", `Mail.Send` de aplicação no tenant). Nenhum aplicativo novo.

1. Copiar, sem alterar nada no Consultor Fiscal, o `GRAPH_TENANT_ID`, o `GRAPH_CLIENT_ID` e o segredo `graph-notificacoes-secret` (projeto `consultorfiscalapp`) para o `sp-pdf-download` como `FINANCEIRO_GRAPH_TENANT_ID`, `FINANCEIRO_GRAPH_CLIENT_ID` e `FINANCEIRO_GRAPH_CLIENT_SECRET` (segredo no projeto do Financeiro), e ligar `FINANCEIRO_COMMUNICATION_SEND_ENABLED=true`. Nunca girar nem recriar o segredo do Consultor Fiscal: ele derrubaria os envios de lá.
2. Esta chave não liga a régua de lembretes: o worker da régua continua exigindo a configuração ativa e um agendador, que não existe.

### WhatsApp (SP Connect)

É o mesmo canal que os outros apps já usam (SP Connect). Falta só um modelo do Financeiro que leve documento.

1. Se já existir um modelo aprovado com cabeçalho DOCUMENTO que sirva para boleto, basta cadastrá-lo para o Financeiro. Se não, criar no Gerenciador do WhatsApp um modelo UTILITY com cabeçalho DOCUMENTO e aguardar a aprovação da Meta.
2. No SP Connect, em Config Admin, cadastrar o modelo para o departamento `financeiro`, marcar "tem documento" e deixar só um modelo do Financeiro com documento ativo.
3. Variáveis disponíveis para o modelo: `cliente`, `nome`, `valor`, `vencimento`, `numero`, `boleto`.
4. Botões "Adicionar à agenda" (Paulo, 24/10/2026): o modelo `boleto_financeiro` tem dois botões de link com final variável, nesta ordem: **Google Agenda** `https://calendar.google.com/calendar/render?{{1}}` e **Outlook** `https://outlook.office.com/calendar/0/deeplink/compose?{{1}}`. O envio manda `agendaGoogle` e `agendaOutlook` (o que vem depois do "?", com número, valor e vencimento, evento de dia inteiro no vencimento). No SP Connect, cadastrar os botões com essas chaves, na mesma ordem. Precisa do SP Connect com suporte a botões de link (CFI e `sp-connect`); sem ele, o modelo com botão é recusado pela Meta no envio.

## Primeiro teste

Emitir um boleto real para um cliente interno cujo cadastro tenha um e-mail e um WhatsApp da equipe, e conferir a chegada antes de liberar para os demais clientes.

## Alerta diário (24/10/2026)

Pedido do Paulo: nenhum problema do faturamento pode ficar sem aviso. O job `sp-boleto-returns` envia, uma vez por dia a partir das 8h (Brasília), um e-mail da caixa financeiro@ para `BOLETO_DAILY_ALERT_EMAIL` (`--alert-email` no deploy, preservado depois), com PDF boleto por boleto. Sai mesmo sem pendência ("sem pendências"), para provar que funciona. Lista: emissão sem confirmação há mais de 10 minutos; boleto com e-mail no cadastro e não enviado há mais de 1 hora; envio com falha ou sem confirmação; boleto com WhatsApp no cadastro que não saiu por WhatsApp (modelo ausente, número inválido ou falha); boleto sem envio digital (Impresso); retornos em conferência ou com erro; arquivos de retorno pendentes; atenção do histórico e do envio automático; execuções do job com erro no dia anterior e no dia (`boletoReturnJobs/runs-AAAA-MM-DD`). Estado em `boletoReturnJobs/alert-production`; falha de envio tenta de novo até 3 vezes no dia. Não cobre os logs do Cloud Run (memória): esses ficam no monitoramento do Google Cloud.
