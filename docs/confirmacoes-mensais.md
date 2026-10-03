# Regras e obrigações confirmadas por cliente e competência

## Entrega dos itens 1 a 5

1. **Validação automatizada:** regressões de leitura e cruzamento, propostas verificadas em respostas reais de entrada/encerramento/suspensão, auditoria agregada de somente leitura do histórico real no fluxo oficial e testes de permissão em emulador isolado no GitHub. Não há certificação automática de contratos.
2. **Identificação:** associações estáveis por CPF/CNPJ ou Nosso Número permanecem automáticas. Um administrador pode registrar, com evidência, vínculo de item sem identificação a uma identidade estável. O vínculo é separado dos lançamentos e possui revisões. Números associados a documentos diferentes continuam bloqueados, exigindo correção comprovada na fonte.
3. **Observações:** extração determinística de propostas de honorários, CNPJ/CPF, início da responsabilidade, dia e última cobrança. Valores divergentes permanecem múltiplos; propostas não são aprovações.
4. **Obrigações mensais:** conferência por identidade e competência, com valor, vencimento, início da responsabilidade, dia, última cobrança, evento definido pelo STATUS e evidência. Administrador pode confirmar uma obrigação; colaborador ativo pode salvar revisão pendente. Saída/suspensão exige última cobrança para confirmar obrigação.
5. **Persistência:** coleções próprias `billingMonthlyReviews` e `billingIdentityLinks`. Cada gravação atualiza o registro e cria revisão histórica atomicamente. Responsável é o UID autenticado, data vem do servidor, e a revisão otimista impede sobrescrever silenciosamente outra alteração. As regras negam atualização e exclusão das revisões e exclusão dos registros principais.

## Uso

Em Faturamento, gerar a lista mensal e abrir **Registrar conferência** ou **Conferir identificação**. Revisar propostas e evidência, preencher condições e salvar como revisão pendente ou obrigação confirmada. Informações das fontes são novamente consultadas antes de salvar; diferenças exigem recarregar. Ao gerar nova lista, assinatura diferente sinaliza revalidação; registros cujo item desapareceu também são contabilizados como pendentes.

O filtro **Conferência** separa itens sem conferência salva, revisões pendentes, obrigações confirmadas e fontes alteradas que exigem revalidação. Funciona junto da busca e da situação, começando com todos os itens. Mudar o filtro retorna à primeira página; os totais e as revisões sem item correspondente não são filtrados nem apagados. O filtro não registra decisões ou cobranças.

**Consultar histórico** mostra 50 revisões por página, com responsável, data, condições e evidência. **Carregar revisões anteriores** acrescenta a próxima página sem descartar as revisões já exibidas. A paginação usa o último documento exibido como cursor, restrito à mesma competência e identificação. Em caso de falha ao buscar outra página, as anteriores continuam visíveis e é possível tentar novamente. Para ver revisões novas, use novamente **Consultar histórico**. Todas as revisões permanecem armazenadas. Vínculos existentes podem ser revisados por administrador, com evidência e controle de concorrência.

O histórico indica carregamento e permite nova tentativa após erro ou 30 segundos sem resposta; isso não cancela uma escrita. Cliques simultâneos no salvamento são bloqueados. Durante a gravação, os campos ficam desabilitados; editar condições antes de salvar exige marcar novamente a confirmação de revisão. Sair da tela durante a revalidação bloqueia o início da gravação, e a transação volta a conferir a operação após a leitura. Uma gravação já enviada ao servidor pode concluir: fechar a tela não equivale a desfazer o registro. Respostas de telas encerradas não atualizam a nova tela.

## Limites e próximos passos

A assinatura versão 2 inclui também nome, identificação original, CPF/CNPJ, Nosso Número, situação da linha e alertas do checklist. Alterações nesses campos exigem revalidação mesmo quando a fonte mantém a data de atualização. A ordem dos eventos e dos alertas não muda a assinatura. Após publicar esta versão, conferências com assinatura anterior aparecerão para revalidação; seus registros e históricos não são apagados nem regravados automaticamente.

A leitura do checklist valida também o formato de cada registro, a unicidade dos submissionIds e a correspondência entre registros e contagens de avisos. Respostas incompletas ou inconsistentes não geram lista parcial. Isso não elimina registros com pendências legítimas: valores nulos, identificação ausente e alertas da fonte continuam disponíveis para revisão. A sessão é conferida novamente após a leitura do corpo da resposta. Os testes desta validação e das conferências mensais integram o CI e o predeploy, sem dispensar a autorização por commit.

Esta entrega não cria transações, não altera respostas Jotform, não emite boletos nem aprova dispensas. Datas e valores sem evidência suficiente continuam pendentes. A assinatura e a nova consulta são controles de revisão; não substituem a futura revalidação no servidor para fechamento mensal. Fila com prazos, dispensas aprovadas, provas de emissão/envio, trava de fechamento e sincronização incremental continuam pendentes.

## Publicação e segurança

O fluxo oficial compara as regras atualmente publicadas com a base homologada e bloqueia divergência. Só adiciona os dois namespaces de conferência; regras anteriores permanecem intactas. Backup das regras anteriores e auditoria agregada, sem dados individuais, ficam no artefato de publicação. Não é um backup completo do banco. Nenhum cliente real é usado para teste de escrita.
