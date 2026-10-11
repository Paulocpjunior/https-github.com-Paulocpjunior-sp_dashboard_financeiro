# Pendências do SP Dashboard Financeiro

## Status do projeto — 11/10/2026

Produção verificada: commit `267c28707dd430fff4c2aa997c37fd0f9b7c7f0b` (PR #73). FiA publicada, autenticação e consulta de filtro verificadas no app. A aprovação independente permanece **desativada por decisão de Paulo**, sem alçada ou aprovadores a configurar agora.

A investigação de 11/10 leu 46.459 documentos de transações em snapshot consistente, sem gravações financeiras. Três dos seis débitos têm candidatos legados por valor/data; não são vínculos confirmados. A conta bancária ausente nos candidatos impede assumir sua origem. Diferença entre último saldo disponível e saldo contábil: R$ 2.157,03, ainda sem causa comprovada.

A triagem de baixas nativas e orientações para tarifas/SISPAG foi publicada no PR #70. A revisão separada de pagamentos antigos foi publicada no PR #73 e encontrou três débitos com candidatos na consulta real. A confirmação administrativa e o desfazimento auditado de vínculos legados estão preparados nesta branch, ainda sem publicação. Não alteram lançamentos nem registram baixas.

### Entregas recentes

- Emissão Boleto Cloud por API, demonstrativo de honorários/extras e anexos do INVITE entregues. A descrição antiga de emissão somente por CSV abaixo é histórica, não representa a versão atual.
- Baixas nativas integrais/parciais, ajustes, histórico, estorno auditado e permissões separadas publicados.
- Aprovação por outro responsável e limite global disponíveis, mas desativados. Nenhuma ativação está pendente de autorização neste momento: a decisão é continuar sem essa exigência.
- Manutenção de cadastros e plano de contas, recorrências e provisões mensais fazem parte da plataforma. UNAS `Backup_Fin` continua para configuração posterior do usuário.

### Duas frentes bancárias — decisão de Paulo

A conta operacional é única: Itaú 3145 / 99791-6. O retorno de boletos pelo Boleto Cloud continua responsável pela baixa dos recebíveis vinculados. A futura API direta do Itaú alimentará a conciliação de entradas e saídas, incluindo contas a receber e a pagar. OFX é a fonte intermediária do extrato, não substitui o retorno dos boletos. A mesma liquidação não pode gerar duas baixas.

Arquitetura e critérios de entrega: [Integrações bancárias](arquitetura-integracoes-bancarias.md). A API Itaú não está implementada/habilitada nesta etapa; conciliação automática e vínculos entre fontes permanecem pendentes.

### Próxima sequência

1. Comparação bancária: nesta etapa, sugestões entre débitos OFX e baixas nativas a pagar. Mesmo valor, mesma conta e até três dias corridos; estornos excluídos. Não registra conciliação nem baixa. Pagamentos legados, pendentes, recebimentos e agrupamentos permanecem fora do escopo inicial.
2. Vínculos legados documentados preparados: prévia, confirmação administrativa, referência de comprovante, justificativa, exclusividade, histórico e desfazimento. Publicação e homologação real pendentes. Vínculos de baixas nativas e agrupamentos permanecem como etapa posterior.
3. Régua de comunicação: o INVITE atual gera arquivos ICS/EML e anexos, sem envio automático pelo servidor. Implementar envio agendado e comprovação de entrega; validação dos destinatários e interrupção de lembretes após pagamento confirmado.
4. FiA financeira: publicada e habilitada; relê o recorte no Firestore e consulta Vertex AI sem chave no navegador. Consulta de filtro homologada em produção; análises financeiras ainda exigem validação pela equipe. Detalhes em [MiA financeira](mia-financeira.md).
5. Alçadas por usuário e fila consolidada de aprovações ficam adiadas enquanto a política estiver desativada.

O bloco seguinte preserva o levantamento de 03/10. Contagens de inconsistências e dados faltantes são históricos; não houve nova auditoria dos lançamentos nesta atualização. Publicar novos commits continua exigindo autorização do SHA completo.

## Levantamento histórico — 03/10/2026

- Interface pública: commit `9de2299`, build `20261003T133108Z-9de2299`; endpoint de versão respondeu HTTP 200. CI desse commit aprovado (execução `37124782209`).
- Integração Jotform: endpoint de saúde respondeu HTTP 200, versão `6.15-identity-conflict-guard`. Saúde do serviço não comprova que todos os lançamentos estão conciliados.
- Publicados: filtro de conferência, revalidação por mudanças nas fontes, proteção contra leitura incompleta, controles de salvamento e sessão, histórico paginado em blocos de 50 revisões.
- Menus protegidos e regras existentes foram preservados nas últimas entregas. Testes automatizados usam cenários sintéticos; esta verificação de status não realizou gravação financeira nem substitui homologação do fluxo pela equipe.
- Não foi executada nova auditoria financeira nesta atualização. Os números abaixo pertencem à auditoria identificada de 03/10/2026, não a uma consulta atualizada.

## Próximas entregas, na ordem de dependência

1. **Fila operacional de conferências:** implementação preparada, ainda não publicada: responsável ativo e prazo definidos pelo administrador, motivo/resultado obrigatório, conclusão/reabertura do acompanhamento, filtros de responsável/situação e histórico imutável. Usuários ativos consultam; somente administrador altera. Armazenamento em `billingFollowUps`, separado dos lançamentos, com revisões incluídas no backup. Concluir tarefa não baixa cobrança nem libera fechamento. Implantação exige testes de regras, backup das regras vigentes e autorização específica do commit. Não inventar vencimentos contratuais nem notificar colaboradores automaticamente.
2. **Evidências de emissão e envio:** registrar referência do boleto/fatura e comprovação de envio, separadas do lançamento e da obrigação. Localizar um lançamento ou exportar CSV não comprova emissão, registro bancário ou entrega.
3. **Dispensas documentadas:** definir motivos, evidência, vigência e aprovação administrativa antes de implementar. Saída/suspensão de cliente não elimina automaticamente cobrança ou saldo.
4. **Fechamento mensal no servidor:** revalidar fontes, obrigações, evidências e dispensas; bloquear fechamento incompleto. Hoje a lista é preparatória e retorna `canCloseMonth: false`; não existe liberação de fechamento nesta entrega.
5. **Sincronização incremental:** otimizar leituras sem perder a verificação de cobertura, mudanças e exclusões. Não trocar uma leitura completa por uma parcial apresentada como concluída.
6. **Integrações bancárias:** a implementação examinada de Boleto Cloud gera CSV para importação, não emissão direta por API. A homologação CNAB relatada anteriormente não foi revalidada nesta atualização. Itaú possui fluxo OFX; API bancária automática depende de habilitação e conciliação com contas a pagar/receber permanece futura. Não enviar remessas, emitir boletos ou baixar títulos para testar.

Publicar cada conjunto somente após testes, comparação com produção e autorização de Paulo para o SHA completo, conforme `AGENTS.md`. Os itens financeiros adiados abaixo não são autorização para correção automática.

## Dados do Jotform para resolver mais tarde

Em 3 de outubro de 2026, Paulo solicitou adiar os seis casos abaixo para que as demais correções possam continuar. Estão pendentes, não resolvidos. Não alterar valores, vencimentos ou status por suposição e não recriar esses lançamentos.

| Identificação | Submission ID | Lançamento | Informação necessária | Situação |
|---|---|---|---|---|
| SP-CX47446 | 6660654066414830357 | Vale-transporte, R$ 50,00 | Vencimento | Aguardando informação |
| SP-CX47445 | 6660590756412227287 | Certificado digital, R$ 209,00 | Vencimento | Aguardando informação |
| SP-CX47238 | 6654746205323248006 | Salário Magali, vencimento 06/10/2026 | Valor | Aguardando informação |
| SP-CX47212 | 6654655485321544590 | eSocial Sr. Paulo, vencimento 20/10/2026 | Valor | Aguardando informação |
| SP-CX47194 | 6654642915324766208 | Boleto Cloud, vencimento 09/10/2026 | Valor | Aguardando informação |
| SP-CX47189 | 6654633355321717565 | Magali Praia, vencimento 06/10/2026 | Valor | Aguardando informação |

Paulo ou a equipe precisam confirmar os dados faltantes. Para encerrar cada item: conferir a submissão atual no Jotform, preservar o registro anterior, atualizar apenas o caso identificado com evidência e autorização, e verificar a sincronização no Financeiro. Os dois salários não devem ser agrupados apenas pela semelhança do nome.

Evidência local: `migration-backups/payables-reviewed-post-repair-20261003T111222Z.json`. Os dados representam a auditoria de 03/10/2026; conferir novamente antes de qualquer correção futura.

## Demais itens em revisão

### Dependências — análise de segurança pendente

Em 03/10/2026, `npm audit` identificou 6 alertas (5 high e 1 low), incluindo propagação pela cadeia Firebase de avisos em `@grpc/grpc-js` e um aviso em `dompurify`. A contagem não representa seis falhas independentes. O impacto nos caminhos utilizados em produção ainda precisa ser avaliado. A sugestão automática inclui downgrade incompatível do Firebase; não foi aplicada. Próximo passo: identificar versões corrigidas compatíveis e validar autenticação, Firestore, PDFs e testes antes de propor publicação. Nenhuma dependência foi alterada nesta entrega da fila operacional.

A auditoria de 03/10/2026 também registra 64 divergências históricas, 92 ausentes, 31 correspondências ambíguas e 21 ativos no Jotform marcados como excluídos no Firestore. Esses grupos continuam em investigação; a similaridade financeira não autoriza recriação, restauração ou associação automática.

Não há lembrete agendado para estes itens. Este documento é o registro de acompanhamento no repositório, sem alteração dos dados financeiros.
