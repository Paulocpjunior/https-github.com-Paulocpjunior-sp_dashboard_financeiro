# Histórico Boleto Cloud

A rota `/boletos` acrescenta o histórico do emissor sem modificar os lançamentos, saldos, emissão direta ou outros menus do Financeiro. Requer usuário ativo e administrador ou permissão `billing.boleto-cloud.history.read`, independente da permissão de emissão. O servidor verifica novamente o perfil antes de responder ou gravar uma consulta.

## Fonte e atualização

A API consultada permite obter a situação e o PDF de um boleto conhecido. Não foi identificado um endpoint documentado para listar todos os boletos. A carga inicial usa o relatório Excel oficial do painel, incluindo os tokens individuais; os tokens nunca são devolvidos ao navegador. Não há senha de painel nem sessão de navegador no serviço.

Novas emissões confirmadas pelo app são incorporadas de `boletoIssues`. O beneficiário depende de um vínculo conferido entre a impressão digital da conta emissora e o cadastro do painel. Contas sem vínculo aparecem como não identificadas; não são atribuídas automaticamente a outro beneficiário.

Novos títulos criados fora do app exigem nova carga do relatório. O botão Recarregar histórico relê a base (cache máximo de 30 segundos); Atualizar situação consulta somente o boleto escolhido. Não há sincronização automática de todos os títulos nesta versão. Registro e protesto não constam no Excel e permanecem explicitamente indisponíveis até consulta à API. Uma consulta com erro preserva os dados anteriores.

## Definições dos indicadores

- Total em aberto exclui títulos pagos ou baixados; atraso é o subconjunto vencido antes de hoje.
- Criados usa a data de criação do relatório; vencendo usa vencimento.
- Pagos no mês usa data do pagamento, inclusive títulos vencidos em outro mês.
- Cartões e gráficos somam valor nominal, como o painel Boleto Cloud. A tabela informa também valor efetivamente pago, que pode incluir juros ou descontos.
- Pagadores e beneficiários são contagens distintas por documento. Datas diárias usam America/Sao_Paulo.
- Filtro de beneficiário afeta os indicadores. Pesquisa textual afeta a tabela e seus totais, não os cartões.

## Importação operacional

1. Exportar Excel por períodos de criação sem sobreposição. Conferir que a soma dos períodos cobre todo o painel.
2. Em ambiente Python com `xlrd`, executar `python scripts/read-boleto-history.py --output /caminho/privado/history.json /caminho/relatorios/*.XLS`.
3. O leitor valida cabeçalhos, datas, tokens únicos e quantidade/valores dos rodapés de cada planilha. Arquivos de clientes e tokens ficam fora do Git.
4. Opcionalmente incluir `issuanceAccounts`, mapa de SHA-256 de `JSON.stringify(accountToken)` para `{bank, beneficiaryDocument, beneficiaryName}`. O vínculo precisa ser conferido no cadastro real da conta; não registrar o token no payload.
5. `node scripts/import-boleto-history.mjs /caminho/privado/history.json` apenas valida e mostra totais e hash.
6. Com a carga autorizada, `--apply` salva snapshot imutável em `boletoHistorySnapshots`, relê todos os blocos e verifica os totais. Ainda não o ativa.
7. `--apply --activate` muda o ponteiro `boletoHistory/production` com precondição de versão e registra o snapshot anterior. Recusa trocar por carga mais antiga. Nunca grava em `transactions`.

Consultas posteriores ficam em `boletoHistoryUpdates`, com usuário/data em `boletoHistoryAudit`. Importação mais recente prevalece sobre consultas anteriores. Essas coleções não têm acesso direto pelo cliente nas regras existentes; são acessadas pelo serviço autenticado.

## Publicação e verificação

Publicar serviço Cloud Run e Hosting a partir do mesmo commit remoto autorizado, respeitando AGENTS.md, guard-production e predeploy. Manter as credenciais existentes. Ativar apenas um snapshot completamente conferido. Não publicar relatórios ou payload em Hosting.

Antes de liberar: testes `test:boleto-cloud`, `test:financial-permissions`, testes do serviço PDF, lint e build. Comparar menus protegidos; verificar versão pública, endpoint anônimo recusado e página autenticada. Conferir os dez cartões com o painel original usando o mesmo dia, mês e beneficiários. Validar pesquisa, paginação, detalhes e PDF sem emitir ou baixar financeiramente títulos para testar.

Em caso de regressão, restaurar a revisão anterior do serviço e Hosting. O ponteiro guarda a referência anterior e os snapshots são preservados; não apagar histórico para reverter interface.
