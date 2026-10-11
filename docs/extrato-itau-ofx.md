# Extrato Itaú por OFX

Implementação para a conta Itaú 3145 / 99791-6, baseada na produção 42be3e0. Não depende da API bancária. A API automática continua pendente de habilitação pelo Itaú.

## Operação

Acesse **Extrato Itaú**. O administrador pode conceder **Consultar Itaú** e, separadamente, **Importar OFX Itaú** em Usuários. A segunda exige também a primeira. Administradores ativos têm ambas. Nenhuma permissão é concedida automaticamente a colaboradores.

1. Exporte OFX original da conta no Itaú Empresas.
2. Selecione o arquivo (até 2 MB / 400 movimentações).
3. Confira conta, período, histórico, entradas, saídas, saldo datado e duplicidades na prévia.
4. Confirme a importação.
5. Consulte o período desejado (até 93 dias; acima de 1.000 registros, reduza o período).

O saldo exibido é exclusivamente o saldo e a data informados no arquivo; não é saldo bancário em tempo real. A variação das movimentações não é apresentada como saldo. Nenhum saldo inicial é inferido. Períodos sem registros não comprovam ausência de movimentações no banco. A conciliação com contas a pagar/receber é uma etapa futura; não há baixa automática.

## Integridade e acesso

- Servidor verifica token Firebase com revogação e perfil atual em cada operação; acesso exige `active === true` e não aceita perfil excluído/bloqueado.
- A permissão `itau.openfinance.read` é restrita a esta conta. Importação exige também `itau.statement.import`.
- A tela acompanha o perfil e limpa os dados se o acesso for revogado. Respostas atrasadas não restauram dados após revogação.
- Respostas HTTP usam `no-store`. Extratos não são armazenados no localStorage.
- Armazenamento isolado: `bankStatements/itau-3145-997916/entries` e `/imports`. As regras Firestore existentes negam acesso direto; somente o servidor acessa as coleções.
- `bankStatementAudit` registra usuário, conta, horário e operação de prévia, importação ou consulta. Consultas registram período; importações registram hash e contagens. Não há painel de auditoria nesta etapa.
- Identidade por conta + FITID. Reenvios idênticos não duplicam dados. Conteúdo divergente para FITID existente bloqueia o arquivo inteiro para revisão. Não há exclusão/atualização automática de movimentações.
- Gravação atômica em transação Firestore: revalida perfil, importação e identificadores antes de criar novos registros e auditoria.
- Arquivo bruto não é persistido; metadados, hash SHA-256, valores em centavos, datas e identificadores de origem são preservados.
- Aceita OFX SGML/XML de conta corrente BRL, com agência explícita ou ACCTID concatenado exato `3145997916`. Outros formatos, correções OFX, ausência de FITID e identidade incompleta são bloqueados para revisão.

## Validação e limites

`npm run test:itau-statements` cobre parser e rotas com armazenamento simulado: autorização, revogação antes da importação, repetição, sobreposição, conflito, consulta e limite. Não equivale a teste com Firestore real nem a homologação de arquivo Itaú real.

Teste de navegador local com arquivo fictício: seleção, prévia, confirmação, consulta, perfil somente consulta e revogação. Nenhum registro financeiro de produção foi criado. A homologação final exige um OFX real desta conta para comparar todas as linhas, sinais, período e saldo. Arquivos bancários reais não devem ser commitados.

## Publicação

Ainda depende de autorização para o commit exato, conforme AGENTS.md. Publicar primeiro o serviço `sp-pdf-download` em `us-central1`, preservando configuração, identidade de serviço e segredos existentes. A revisão deve incluir `index.js`, `itau-ofx.js` e `itau-statements.js`. A publicação de Hosting acrescenta `/api/itau/**` para esse serviço e a rota `/extrato-itau`, preservando rotas de PDF e Boleto Cloud.

Após autorização: confirmar origin/main, executar as proteções, publicar backend e Hosting, verificar health, versão e bloqueio 401/403 de acessos sem sessão. Validar consulta/importação com usuário autorizado e arquivo real antes de anunciar homologação bancária. Não habilitar colaboradores para o teste sem definição explícita de quem terá acesso.


## Comparação de baixas nativas — implementação de 11/10/2026

A ação **Comparar baixas com o extrato** consulta débitos OFX do período e baixas nativas da mesma conta, incluindo margem de três dias antes/depois. Requer Consultar Itaú e algum direito de gestão de contas a pagar. Direitos são revalidados antes da resposta.

A projeção existente de pagamentos exclui estornos e usa cada pagamento parcial efetivo, não o valor nominal nem o acumulado da conta. Sugestões exigem valor exato em centavos e distância máxima de três dias corridos. Duas baixas candidatas para o mesmo débito, ou a mesma baixa candidata para dois débitos, são ambíguas. Mesmo uma sugestão única exige conferência do favorecido: valor/data não provam identidade.

Não altera lançamentos, saldos, vínculos ou estados de conciliação. Registra apenas auditoria da consulta. Créditos, pagamentos agrupados, contas pendentes e pagamentos legados sem auditoria nativa não são conciliados. Ausência de candidato não comprova falta de pagamento; pode haver cobertura incompleta do OFX, agrupamento, tarifas ou diferenças de data. Acima de 1.000 movimentos ou do limite de leitura integral do histórico nativo, a consulta falha sem resultado parcial.

Esta implementação ainda aguarda publicação e teste com extrato real. Testes automatizados usam dados fictícios.

## Formato real Itaú — referências de saldo (11/10/2026)

A validação local de um OFX original identificou três referências de saldo serializadas como `STMTTRN`, incluindo saldo anterior antes de `DTSTART`. O parser antigo recusava o período; simplesmente relaxar a data somaria os saldos às receitas. A correção reconhece somente os rótulos exatos normalizados `SALDO ANTERIOR` e `SALDO TOTAL DISPONÍVEL DIA`, preserva seus identificadores, datas, valores e descrições em `balanceRows` nos metadados da importação e os exclui de `entries`, totais e candidatos de conciliação. Outros rótulos iniciados por SALDO/SDO exigem revisão. Referências repetidas/incompatíveis são recusadas. Movimentações efetivas continuam obrigatoriamente dentro do período.

O arquivo também declarou CHARSET:1252 com bytes UTF-8. A leitura usa UTF-8 estrito quando válido e recorre à codificação legada declarada somente quando necessário. Testes cobrem ambos sem alterar descrições.

A prévia e o histórico exibem as referências separadamente. `LEDGERBAL` e saldo disponível diário não são tratados como equivalentes: datas/composição podem divergir e nenhuma diferença é corrigida automaticamente. Créditos agregados de boletos não comprovam o recebimento de um título individual.

Conferência local do arquivo real e soma independente concluídas; importação em produção e comparação com as baixas ainda dependem da publicação autorizada desta correção. O arquivo original e seus dados financeiros não estão no repositório. Fixtures de testes são fictícias.

## Revisão separada de pagamentos antigos (PR #73 publicado)

No Extrato Itaú, marque **Incluir conferência separada de pagamentos antigos** antes de comparar. Requer as mesmas permissões de extrato e contas a pagar, verificadas novamente antes de liberar o resultado. A consulta não altera lançamentos; registra apenas auditoria de leitura.

- Pesquisa `paymentDate` ISO e `dataPagamento` ISO/brasileiro dentro do intervalo, acrescido de três dias. Deduplica pelo ID do documento. Não cobre registros sem essas datas ou em outros formatos; não é uma auditoria completa da base.
- Exige saída paga, `valorPago` explícito positivo e datas coerentes. Não usa `valuePaid`/valor provisionado como substituto. Exclui registros nativos, estornados, excluídos e Wix.
- Conta diferente da conta operacional fica fora; conta ausente aparece como comprovação necessária, sem presumir que pertence ao Itaú.
- Mesmo valor e até três dias geram apenas candidatos. Vários candidatos ou o mesmo pagamento em vários movimentos aparecem como ambíguos.
- Limite de 5.000 documentos encontrados. Ao exceder, bloqueia o resultado e pede período menor. Leituras sequenciais não constituem snapshot global transacional.
- A lista fica separada das sugestões nativas. No PR #73 não havia confirmação de vínculo. A próxima etapa está descrita abaixo; não haverá baixa, estorno ou associação automática.

Validação com fixtures sintéticas e prévia local; nenhuma gravação financeira usada para teste.


## Vínculos legados auditados (preparados, não publicados)

Administrador ativo pode abrir **Revisar vínculo**, conferir débito e pagamento, informar justificativa e referência do comprovante e marcar a conferência de favorecido/conta/documento. **Confirmar vínculo bancário** grava somente metadados. O nome do responsável vem do usuário autenticado no servidor.

- Prévia e confirmação releem a movimentação e o lançamento. A confirmação compara a impressão dos dados completos e a revisão do vínculo; mudanças bloqueiam a operação.
- Uma transação Firestore controla a exclusividade por débito e pagamento, revalida o administrador, grava o histórico e registra a operação idempotente. O mesmo pagamento não pode ser associado a dois débitos pela ferramenta.
- **Desfazer vínculo** exige justificativa e revisão atual. Libera o pagamento para nova revisão e preserva o histórico. Não estorna a baixa.
- Ao consultar, vínculos ativos com fonte modificada ou ausente são marcados para revisão. Não há correção ou desvinculação automática.
- Apenas pagamentos legados, valor pago explícito igual ao débito e até três dias de diferença. Não abrange baixas nativas, créditos, rateios, lotes ou pagamentos de valor diferente. A referência textual do comprovante não constitui upload nem verificação automática do documento; a confirmação depende da revisão humana.
- Armazenamento: `bankLegacyLinks`, `bankLegacyPaymentLocks`, `bankLegacyLinkOperations`, mais eventos em `bankStatementAudit`. As coleções novas entram no backup padrão. Clientes Firestore continuam sem acesso direto; as rotas autenticadas do servidor aplicam as permissões.
- A leitura dos vínculos limita-se a 1.000 por período; cada histórico comporta 100 ações. Limites bloqueiam resultados/operações em vez de truncar silenciosamente.

Testes de concorrência, repetição, mudança de fonte, revogação, histórico e preservação dos documentos financeiros são sintéticos. Nenhum vínculo real foi confirmado para testar a interface. A homologação com comprovante verdadeiro permanece pendente após publicação autorizada.

## Vínculos de baixas nativas — implementação preparada

A revisão nativa recebe o identificador do lançamento e da baixa individual. Confere `payablePayments`, ausência de estorno em `payableReversals` e igualdade com o evento original de `payableAudit`. O valor comparado é o efetivamente pago naquele evento, inclusive pagamento parcial, nunca o total provisionado. Conta Itaú, valor idêntico e margem de três dias continuam obrigatórios; favorecido e comprovante precisam ser conferidos pelo administrador.

Rotas autenticadas: `POST /api/itau/native-links/preview`, `/confirm` e `/unlink`. Operadores sem papel de administrador não confirmam. A confirmação relê fontes e permissões dentro de transação e compara a impressão digital da prévia. Estorno ou alteração posterior sinaliza revisão; desfazer vínculo não estorna a baixa.

As coleções `bankLegacyLinks`, `bankLegacyPaymentLocks` e `bankLegacyLinkOperations` são compartilhadas com o fluxo anterior para preservar backups e impedir dois vínculos para o mesmo débito. Registros novos têm `kind: native` e `paymentRequestId`; registros antigos sem `kind` continuam legados. A trava de pagamento nativo é por lançamento + baixa, permitindo conciliar separadamente parcelas reais. Histórico e auditoria identificam a baixa. Nenhuma operação escreve em `transactions`, `payableAudit` ou nas movimentações do extrato.

A confirmação/desfazimento usa os mesmos controles de repetição segura e versões do vínculo antigo. Histórico limitado a 100 ações por débito; consultas acima de 1.000 vínculos bloqueiam em vez de apresentar cobertura parcial. Pagamentos agrupados, créditos e conciliação automática por API Itaú continuam fora desta entrega. A validação local usa dados fictícios; não equivale a homologação bancária real.

## Grupos de baixas nativas — implementação preparada

O administrador usa **Conferir grupo** no débito e seleciona de 2 a 25 baixas existentes. Pesquisa por favorecido/identificador, lista de selecionadas e soma/diferença permanecem visíveis; a pesquisa exibe até 50 resultados, sem perder seleções anteriores. A soma exata apenas habilita a revisão, não comprova identidade. O comprovante do lote e cada favorecido precisam ser conferidos. Não há busca automática de combinações, rateio de diferenças ou criação de baixas.

`POST /api/itau/group-links/preview`, `/confirm`, `/unlink`: administrador ativo; mesma conta, margem de três dias para cada baixa, soma em centavos exata, evento de auditoria íntegro e ausência de estorno. A confirmação relê todas as fontes dentro da transação; bloqueia mudanças desde a prévia e qualquer baixa/débito já vinculado. Usa as mesmas coleções e travas dos vínculos individuais, com `kind: native-group`, membros e histórico preservados no backup existente. Solicitações repetidas são idempotentes. O desfazimento libera todos os membros atomicamente, sem estornar pagamentos; é permitido mesmo quando uma fonte desapareceu.

Uma alteração posterior sinaliza revisão do grupo. O histórico é limitado a 100 ações e 700 KB por documento, com bloqueio explícito se exceder o limite. Grupos de pagamentos legados sem eventos auditados, créditos, divisão de uma baixa em vários débitos e confirmação automática não fazem parte desta entrega. Validação local usa fontes fictícias; nenhum agrupamento bancário real foi confirmado.
