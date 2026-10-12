# Comunicação Financeiro — validação de 12/10/2026

## Evidências

- Paulo confirmou recebimento do modelo HTML às 11h07 e do teste com PDF às 11h17, na caixa iCloud autorizada.
- Consulta de situação de boleto existente retornou HTTP 200, EM_ABERTO e REGISTRO_CONFIRMADO.
- O novo adaptador local consultou situação, baixou PDF e reconferiu situação. O PDF real possui uma página; metadados correspondem ao número e vencimento esperados.
- Nenhum boleto emitido, lançamento alterado, job persistido ou e-mail adicional enviado na validação do adaptador.
- Relatórios oficiais foram cruzados por documento exato. Prévia local contém 352 boletos e 1.076 cadastros, com divergências e múltiplos destinatários identificados. Os relatórios não substituem consulta atual antes do envio.

## Implementação local

`communication-boleto-source.js` fornece `readSource` e `prepare` para o processador existente. Exige vínculo fornecido pelo servidor, revisão, identidade esperada do boleto e destinatário confirmado. Usa somente GET, sem redirecionamentos. A revisão incorpora vínculo e resposta atual do emissor, detectando alterações durante a preparação. Bloqueia pagamento, baixa, registro ausente, divergência, PDF inválido ou composição não verificável.

O módulo não expõe rota nem ativa agendamento. Credenciais, exportações, PDFs reais e evidências individuais ficam fora do Git. Não foi publicado.

## Fluxo administrativo acrescentado

A área de comunicação ganhou pesquisa de boletos da conta homologada, prévia com consulta atual, confirmação de destinatário e motivo, rascunhos por etapa e conferência de PDFs sem envio. A lista mostra as últimas 100 etapas, datas, resultados e pendências. As rotas exigem administrador ativo e revalidam a permissão antes de responder ou gravar. A prévia é recalculada no servidor; valores financeiros e tokens não são aceitos do navegador.

Os contatos confirmados ficam em `financialCommunicationContacts`, agora incluída no backup, com confirmação auditada em `financialCommunicationEvents`. Rascunhos ficam em `financialCommunications`; o processador não os seleciona. Pagamento, baixa, mudança de conta, lançamento divergente ou contato alterado impedem a preparação. Não há rota HTTP para disparar e-mails.

`communication-worker.cjs` é o ponto de entrada preparado para processamento futuro. Exige chave do servidor e configuração ativa, seleciona até 50 etapas elegíveis e usa reservas transacionais. Não foi criado agendador. O índice necessário está descrito em `communication-index.json`: criar de forma aditiva, nunca substituir os índices existentes por esse arquivo isolado.

## Pendências para operação automática

1. Dias ficam para definir depois: manter rascunhos sem data. A política confirmada inclui todos os e-mails cadastrados e conferidos, com deduplicação e revisão da lista completa. Resolver contatos divergentes antes da confirmação.
2. Publicar interface/serviço com autorização do SHA completo; homologar em produção a preparação com dados reais, sem envio em lote.
3. Preparar ativação explícita e promoção revisada de rascunhos após as decisões. Provisionar índice e agendador somente na publicação/ativação autorizada.
4. A etapa seguinte deste PR integrou importação de cadastros, avisos internos a pagar e anexos ICS. Consulte `comunicacao-publicacao-e-ativacao.md` para os limites e evidências atuais. Os recursos homologados de INVITE não foram removidos.
5. Resultados incertos exigem conferência manual; não há retentativa automática nem exclusão do histórico para recomeçar.

Consulta antes do envio reduz cobranças indevidas, mas não elimina o intervalo entre pagamento e aceite da mensagem pelo provedor. Não declarar recebimento com base apenas em HTTP 202.
