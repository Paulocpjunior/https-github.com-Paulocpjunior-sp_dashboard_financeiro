# INVITE de vencimento com boleto PDF

## Uso

Em Boletos Boleto Cloud → Detalhes, ou no modal de emissão após emitir, use:

- **Baixar INVITE com PDF (.ics)**: evento de dia inteiro na data de vencimento, com lembrete na véspera e PDF incorporado.
- **Preparar e-mail com INVITE e PDF**: arquivo `.eml` com o PDF separado e o convite anexados. Abra em um cliente de e-mail compatível, confira os anexos, escolha o destinatário e envie. Nenhum envio ocorre no servidor.

O destinatário precisa importar o ICS. O suporte ao PDF incorporado e aos lembretes varia por calendário; o PDF separado no e-mail é a alternativa. O arquivo não recebe atualizações automáticas após pagamento ou cancelamento. A abertura como rascunho depende do suporte do cliente a `X-Unsent: 1`.

## Arquitetura e origem

`convites-vencimento.cjs` é uma cópia integral do módulo compartilhado do CFI, commit `27c978d9` (`sefaz-backend/convites-vencimento.cjs`), que documenta a origem no DP (`services/agenda/convite.ts`). Mantém METHOD:PUBLISH, evento civil e VALARM -PT15H. `boleto-invite.js` adiciona UID estável da cobrança, CLASS:PRIVATE, anexo PDF binário RFC5545 e envelope MIME de rascunho.

Rotas GET autenticadas: `/api/boleto-cloud/items/:id/invite`, `/invite-email` e equivalentes em `/history/:id/`. Preservam as permissões existentes de emissão e consulta respectivamente. O servidor consulta situação, lê o PDF atualizado para o vencimento verificado e consulta situação novamente. Revalida usuário e lançamento antes da resposta. Token do emissor permanece no servidor.

Bloqueia boleto pago, baixado, vencido, sem registro confirmado, PDF inválido/maior que 3 MB e divergência de valor, vencimento ou documento. Cobranças vinculadas ao app também são conferidas contra o lançamento atual. A geração não altera valores, saldos, baixa, retorno bancário ou histórico financeiro.

## Validação e limites

Testes automatizados conferem as rotas, autorização, bytes exatos do PDF incorporado e separado, evento único, UID estável, limite de linhas ICS, virada de ano, bloqueios e alteração concorrente de situação. Testes utilizam fixtures fictícias e não emitem cobranças.

Homologação de abertura/importação em Outlook, Apple Calendar e Google Calendar, e entrega real de e-mail, ainda pendentes. Esta entrega não adiciona envio automático pelo gateway central nem sincronização posterior da agenda. Esses fluxos exigem integração própria do Financeiro; as rotas atuais do DP/CFI validam seus respectivos departamentos e não devem ser reutilizadas indevidamente.

Referências: https://www.rfc-editor.org/rfc/rfc5545#section-3.8.1.1 e https://developers.boleto.cloud/v1/boletos/.
