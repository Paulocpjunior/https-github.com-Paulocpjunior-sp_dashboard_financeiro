# Trava mensal de faturamento — implantação por etapas

Objetivo: todo cliente do mês anterior e todo novo cliente contratualmente devido no mês atual precisa de lançamento, documento de cobrança emitido e envio conforme contrato; a ausência só pode ser encerrada com justificativa válida, evidência e aprovação. Pagamento ou inadimplência do mês anterior não dispensa faturamento do atual.

## Etapa 1 — conferência de lançamentos, implementada para revisão

A Base de Faturamento ganhou uma conferência independente para o mês atual contra o imediatamente anterior. A projeção existente do próximo mês, perfis, PDFs, CSVs, Tesouraria Wix e permissões foram mantidos. Vencimento é o critério inicial da nova conferência; lançamento também pode ser selecionado. Não confundir a projeção existente, baseada em lançamento, com essa nova comparação.

São evidenciados: ausência de lançamento, alteração de valor, falta de identificação, número de cliente ligado a documentos distintos, múltiplas cobranças e datas inválidas. Identidade usa CPF/CNPJ ou número do cliente; nomes não unem automaticamente registros. Valores vêm dos helpers financeiros homologados, em centavos. Valores do mês anterior são referência para investigação, não confirmação de receita devida; extras, parcelas e reajustes precisam ser confrontados com o contrato.

Consulta diretamente o servidor Firestore, sem fallback ao cache e sem paginação parcial. Limite de segurança: 20.000 documentos; excesso ou falha tornam a consulta indisponível. A leitura inclui todos os registros para encontrar datas faltantes e conflitos de identidade. Cada resultado indica horário da leitura e precisa ser atualizado após correções. Uma consulta não reserva nem fecha o mês.

Métricas já calculadas: clientes anteriores, clientes sem lançamento, cobertura de lançamentos, valor anterior das ausências e novos clientes já lançados. Novos clientes que ainda não foram lançados só aparecerão após integração contratual. Checklist e emissão permanecem com cobertura **indisponível**, nunca 100% por ausência de dados. Não existe liberação ou gravação de fechamento nesta etapa: o painel sinaliza pendências; a trava operacional depende das etapas 2–4.

Backup anterior a esta alteração: `/workspace/backups/financeiro-antes-trava-faturamento-20260930T230659Z/`. Commit-base: `892c504bb548c4841dd3502e89b6047b1ec0cc14`. Código e histórico Git; não inclui banco Firestore ou credenciais. SHA-256 de `codigo.tar.gz`: `c90ad47bff531fce6b8c993a1909f2b0f875297074b3e7ae302b87fc54a24d3b`; de `historico.bundle`: `d59b24bd808c55a0d4c0b0c8d112e67b096aad349fc997390abd235bf8dbc750`. Restauração de código pelo arquivo e de refs pelo bundle; reverter o commit da etapa também preserva o histórico.

## Etapa 2 — leitura contratual do checklist Jotform

Formulário identificado pela conexão Jotform em 30/09/2026: **Check List Atual 2026**, ID `210135417457653`, URL https://form.jotform.com/210135417457653, habilitado, 26 questões e 1.420 respostas informadas no metadado. Esse total não é quantidade de clientes ativos nem quantidade de registros lidos pelo SaaS.

Campos visíveis no metadado: EMPRESA NOME, Nosso Número, Honorários, Serviços Contratados, DATA CADASTRO ESCRITÓRIO, DATA SAIDA ESCRITÓRIO (duas versões), DATA ALTERAÇÃO (duas versões), DATA SUSPENSÃO (duas versões), DATA BAIXA, Status Clientes, Responsável a partir de/até, OBSERVAÇÃO e Upload de Arquivos. O conector forneceu títulos, sem IDs das perguntas ou conteúdo bruto estruturado das respostas. A leitura adicional do HTML público confirmou IDs de alguns campos e widgets, sem ler respostas pessoais. A consulta de uma resposta foi exibida na interface do conector, sem payload utilizável na implementação. **Ainda não foi feita ingestão das 1.420 respostas.**

Próximo requisito técnico: acesso backend de leitura à API Jotform e esquema completo (`/form/210135417457653/questions`), com credencial em Secret Manager, nunca no navegador/repositório. Não editar o formulário. Conferir os IDs observados no HTML contra o esquema da API e as respostas reais/widgets, distinguir versões antigas/atuais dos campos e mapear explicitamente: identidade, início efetivo, valor recorrente, extras com período, dia/vencimento da cobrança, saída efetiva e **última competência cobrável**. Os títulos vistos não comprovam a existência de um campo estruturado de última cobrança ou vencimento; não inferir isso de uma observação ou do nome de um campo.

IDs observados no HTML público (ainda sem mapeamento contratual homologado):

| Informação | IDs de pergunta | Observação |
| --- | --- | --- |
| Empresa | 24 | Texto; não usar nome sozinho como identidade |
| Nosso Número | 33 | Confirmar equivalência com N.Cliente financeiro |
| Honorários | 36 | Widget Entrada Mascarada; validar valor BR na resposta |
| Cadastro no escritório | 11 | Data composta dia/mês/ano |
| Saída | 39 e 53 | Não escolher uma versão sem confirmar vigência |
| Alteração | 43 e 54 | Preservar histórico e resolver conflitos |
| Suspensão | 48 e 55 | Não equivale automaticamente a dispensa |
| Baixa | 44 e 56 | Confirmar significado contratual |
| Responsável a partir de / até | 30 e 40 | Não assumir competência de cobrança |
| Status Clientes | 47 | Widget de seleção |
| Serviços Contratados | 38 | Widget de seleção |
| Observações / anexos | 5 e 34 | Evidência referenciada; texto não autoriza dispensa |

O item “CNPJ” da relação de documentos (pergunta 21) é uma linha de conferência SIM/NÃO/OBSERVAÇÃO, não um campo confirmado de número do CNPJ. Falta confirmar última competência cobrável, data/dia de cobrança e extras estruturados antes de automatizar a decisão.

Sincronização inicial paginada e incremental idempotente por submissionId + updatedAt; retenção da origem, versão e hash; validação de todos os dados antes de publicar snapshot. Respostas repetidas precisam compor histórico contratual com vigência, sem simplesmente sobrescrever pelo registro mais recente. Contradições entre datas/campos, identidade ambígua e exclusões do Jotform viram pendência, jamais dispensa automática. Não inserir cobranças financeiras durante a sincronização inicial.

Métricas de leitura: total declarado pela fonte; respostas recebidas; respostas normalizadas válidas; rejeitadas; conflitos; clientes identificados; contratos ativos por competência; clientes novos ainda não lançados; data da última sincronização completa. Cobertura de leitura = respostas processadas / respostas esperadas da mesma consulta; mudança do total ou paginação incompleta invalida snapshot. Estabelecer limite de defasagem antes da liberação mensal. Sem leitura completa e fresca, o mês permanece pendente.

## Etapa 3 — pendências e dispensas comprovadas

Conciliar união de clientes anteriores + contratos ativos + novos clientes, usando identidade oficial e vigência. Checklist define obrigação contratual; lançamentos comprovam registro; emissor comprova documento emitido; canal de entrega comprova envio. Não somar Jotform e Wix como se fossem automaticamente cobranças distintas da mesma obrigação. Confrontar valores por obrigação/parcela; mudanças legítimas de extras não são omissão recorrente.

Cada ausência cria tarefa visível no app com cliente, período, valor esperado, prazo e responsável. Exemplo: cliente cobrado em agosto e ausente em setembro fica pendente mesmo que agosto esteja pago. Saída em setembro não dispensa automaticamente setembro: respeitar última competência cobrável e cláusula de proporcionalidade.

Dispensa deve registrar código de motivo permitido (término, suspensão prevista, carência contratual ou cobrança extraordinária não recorrente), vigência, última competência cobrável, justificativa, referência de submission/contrato/anexo, autor, aprovador e timestamps. Texto livre sozinho não basta. Operacional pode preparar justificativa; aprovação é administrativa, conforme o modelo atual de permissões. Contrato encerrado não exclui lançamentos já devidos. Ausência de valor vira pendência, não zero.

## Etapa 4 — emissão, envio e trava de conclusão no backend

Estados distintos por obrigação: esperada → lançada → emitida → enviada; ou dispensada com aprovação válida. Pago é um estado de liquidação posterior e não substitui prova de emissão. Lançamento, PDF preparatório e CSV Boleto Cloud não provam emissão. Integrar retorno do emissor (identificador verificável e status, incluindo cancelamento) e recibo de entrega. Enquanto não houver prova automática, anexos manuais requerem validação administrativa e trilha auditável.

Adicionar operação server-side de concluir faturamento. Revalidar autenticação/role, checklist completo e recente, valores, ausência de tarefas abertas, dispensas aprovadas, documento emitido vigente e entrega exigida. Transação atômica deve comparar revisão/hash das fontes e gravar snapshot mensal imutável com autor/data. Mudança posterior de contrato, lançamento, dispensa ou cancelamento invalida a validação e exige reabertura auditada. Bloqueio só no frontend não é trava válida.

Não bloquear criação/correção de lançamentos ou emissão de boletos faltantes: essas ações resolvem a pendência. Bloquear **conclusão mensal** e considerar validação prévia dos itens de um lote antes de emitir; lote parcial deve permanecer explicitamente incompleto. Nenhum pagamento, emissão real, mensagem de cobrança ou gravação financeira é necessário para testes.

Métricas finais: esperados, lançados, emitidos, enviados, dispensados válidos, omissões, divergências e percentual de obrigações resolvidas. Exibir denominadores, fonte e versão. Uma base vazia ou indisponível não significa 100% de conformidade. Administrador deve conseguir auditar todos os clientes excluídos do faturamento.

## Etapa 5 — assistência de IA, depois da trava determinística

IA pode interpretar observações, sugerir associação de anexos e motivos, resumir pendências e ordenar tarefas. Sugestões exigem confirmação; IA não decide dispensa, não calcula obrigação contratual faltante e não libera fechamento. Integração Dots fica condicionada a documentação oficial verificável; o processo não depende dela.

## Validação e publicação

Etapa 1: `npm run test:billing-completeness`, lint, testes da Base de Faturamento, permissões, Boleto Cloud, proteções de produção e build. Dados de teste sintéticos. Etapas seguintes exigem testes de novos clientes sem lançamento, saída com última cobrança, mudanças retroativas, respostas duplicadas/conflitantes, sincronização incompleta, cancelamento de boleto, aprovação revogada, concorrência e falha de entrega.

Produção ainda não alterada. Publicação exige o SHA completo autorizado por Paulo conforme AGENTS.md e guard-production.mjs. Na homologação, comparar menus com produção e usar dados sintéticos sem alterar registros financeiros reais. Liberar etapas separadamente, preservando rollback por commit.
