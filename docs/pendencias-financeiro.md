# Pendências do SP Dashboard Financeiro

## Status verificado em 03/10/2026

- Interface pública: commit `9de2299`, build `20261003T133108Z-9de2299`; endpoint de versão respondeu HTTP 200. CI desse commit aprovado (execução `37124782209`).
- Integração Jotform: endpoint de saúde respondeu HTTP 200, versão `6.15-identity-conflict-guard`. Saúde do serviço não comprova que todos os lançamentos estão conciliados.
- Publicados: filtro de conferência, revalidação por mudanças nas fontes, proteção contra leitura incompleta, controles de salvamento e sessão, histórico paginado em blocos de 50 revisões.
- Menus protegidos e regras existentes foram preservados nas últimas entregas. Testes automatizados usam cenários sintéticos; esta verificação de status não realizou gravação financeira nem substitui homologação do fluxo pela equipe.
- Não foi executada nova auditoria financeira nesta atualização. Os números abaixo pertencem à auditoria identificada de 03/10/2026, não a uma consulta atualizada.

## Próximas entregas, na ordem de dependência

1. **Fila operacional de conferências:** acrescentar responsável e prazo definidos pelo usuário, histórico das alterações e filtros de acompanhamento. O filtro de situação já existe; atribuição e prazos ainda não. Não inventar vencimentos contratuais nem notificar colaboradores automaticamente.
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

A auditoria de 03/10/2026 também registra 64 divergências históricas, 92 ausentes, 31 correspondências ambíguas e 21 ativos no Jotform marcados como excluídos no Firestore. Esses grupos continuam em investigação; a similaridade financeira não autoriza recriação, restauração ou associação automática.

Não há lembrete agendado para estes itens. Este documento é o registro de acompanhamento no repositório, sem alteração dos dados financeiros.
