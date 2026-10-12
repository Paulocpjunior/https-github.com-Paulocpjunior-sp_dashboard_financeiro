# Comunicação: entrega e publicação

## Entrega de 12/10/2026

- Cadastro de pagadores: conversor do relatório oficial XLS/CSV para arquivo privado JSON; importação administrativa com prévia, checksum, revisão concorrente e auditoria. O sistema preenche a lista completa por CPF/CNPJ exato. Duplicidade, ausência e formato inválido ficam bloqueados. Nenhum cadastro ambíguo é combinado automaticamente.
- A API pública consultada não documenta listagem geral dos pagadores. A atualização do cadastro usa exportação oficial; não se afirma sincronização contínua. Referência: https://developers.boleto.cloud/v1/visao-geral/ e https://developers.boleto.cloud/v1/boletos/campos/.
- Boletos a receber: confirmação da situação atual, PDF, demonstrativo quando vinculado e calendário ICS. A alteração de qualquer destinatário, fonte ou cadastro invalida a conferência anterior.
- Contas a pagar: destinatários exclusivamente internos da configuração. Exige conta pendente, sem pagamento parcial, com um único PDF vinculado, hash verificado e vencimento vigente. Contas sem documento ou com múltiplos PDFs devem ser conferidas pelo fluxo homologado antes da preparação.
- Sem dias configurados: rascunho sem data, sem promoção nem envio. O formulário aceita salvar configuração com dias vazios.
- Cancelamento de etapa ainda não processada; revisão auditada de resultado incerto, bloqueado ou aceito. Revisão não declara entrega nem reenvia.
- Nenhuma rota HTTP envia mensagens; nenhum agendador foi ativado. `accepted` é aceite pelo provedor, não entrega.

## Como atualizar os cadastros

1. Exportar o relatório de pagadores do Boleto Cloud.
2. Preparar o arquivo: `python scripts/prepare-boleto-payers.py RELATORIO.XLS pagadores.json` (Python com xlrd para XLS; CSV dispensa xlrd).
3. Em Manutenção → Lembretes e INVITE → Atualizar cadastro, selecionar o JSON, revisar as contagens, informar o motivo e confirmar.
4. Selecionar cada cobrança e conferir todos os destinatários preenchidos. O cadastro importado é fonte de proposta, não autorização automática de disparo. Corrigir divergências na origem e repetir a exportação.

## Publicação protegida

1. CI e revisão concluídos; integrar na main e obter o SHA completo remoto.
2. Paulo autoriza esse SHA. Somente então preencher `FINANCEIRO_APPROVED_COMMIT` e executar o guard existente.
3. Fazer backup prévio; publicar o backend `sp-pdf-download` e a interface do mesmo SHA, preservando variáveis/segredos/IAM e rotas existentes. Conferir a imagem, revisão ativa, versão pública e menus homologados.
4. Homologar com consulta real: importar o relatório revisado, salvar um rascunho sem dias, conferir PDFs/ICS e auditoria. Não emitir boletos, alterar valores ou enviar em lote para validar a interface.
5. Realizar ensaio de restauração dos dados operacionais após existirem registros. O ensaio desta entrega foi executado em emulador local com dados fictícios, não certifica todos os dados de produção.

## Ativação futura — depende de Paulo

Dias ficam a definir. Não provisionar disparos enquanto esta decisão estiver pendente. Quando houver autorização: revisar dias e destinatários internos, promover apenas rascunhos novamente conferidos e sem data passada, revisar os anexos, autorizar separadamente a ativação, criar o índice composto aditivamente e provisionar o worker com identidade de serviço e zero retries. Manter o agendador pausado até homologação. Não reutilizar um resultado `unknown`; registrar a conferência manual.

O worker exige simultaneamente flag de servidor, configuração ativa e etapas `queued`; rascunhos não são selecionados. Não há botão de ativação nesta versão. Essa separação respeita a decisão de manter rascunhos e impede que a publicação por si só comece a enviar.

## Evidências locais

208 testes do serviço, TypeScript, build e contratos protegidos. Ensaio real de Firestore local: contas a receber e pagar, PDFs/ICS, auditoria, cancelamento e restauração de 9 documentos amostrados nas 4 coleções (13 documentos sintéticos no pacote). Zero escrita em produção e zero e-mails. A conferência visual usou dados fictícios.

Arquivo de pagadores disponível para importação: 1.076 registros, 1.075 CPF/CNPJ distintos, 44 bloqueados no cadastro completo. A ocorrência de bloqueio só impede a cobrança que referenciar esse cadastro; a contagem não significa 44 cobranças ativas com problema.
