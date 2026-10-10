# Contas a pagar: baixas parciais e ajustes

Implementação de 10/10/2026. Campos comparados com o formulário Jotform 210020525580845 (Controle de Caixa), sem alteração no checklist.

- Banco, forma, pago por, autorizado por, favorecido PF/PJ, observação e comprovante seguem os parâmetros efetivos da Manutenção.
- Valor original (`valuePaid`/`valorOriginal`) é preservado. `valorPago` é a soma efetivamente paga; `payableBalance` contém totais em centavos.
- Saldo novo = saldo anterior + juros + multa - desconto - pagamento. Ajustes exigem justificativa. Valores negativos, excesso de pagamento e data anterior à última baixa são recusados.
- Parcial exige saldo positivo e mantém status Pendente (a tabela exibe Parcial). Quitação exige saldo zero e muda para Pago.
- `payablePayments` preserva cada baixa, responsáveis, data, ajustes, comprovantes e saldo. `payableAudit` registra antes/depois. O webhook existente protege contas com `payableSettlement` contra sobrescrita.
- Confirmação exige revisão/versionamento, permissão revalidada e chave idempotente. Clique repetido não duplica pagamento. O modal fecha somente após resposta de sucesso.
- Resumos de títulos, acumulados, gráfico por vencimento, aging, alertas e exportação de valor pago/saldo usam valores efetivos. Filtro por data de baixa continua sendo por **última baixa do título**, não um extrato de parcelas por período. Cada parcela fica no histórico do modal.
- Nenhum pagamento bancário é executado. INVITE da conta parcialmente paga informa o saldo restante. Recorrência conserva a provisão original, sem copiar pagamentos.

Validação: testes de backend sintéticos, idempotência/concorrência, cálculo e leitura REST dos acumulados, lint/build e simulação local de parcial seguida de quitação com desconto. Não houve escrita em dados financeiros reais.

Publicação exige aprovação do SHA completo conforme AGENTS.md; publicar backend e frontend compatíveis. Abas antigas devem ser recarregadas para preencher os novos campos obrigatórios.

## Autorizador padrão

Na nova baixa, Autorizado por inicia com o nome do perfil autenticado, obtido em users pelo UID validado pelo servidor. O nome atual é incluído apenas nas opções da resposta, sem modificar o catálogo global. A seleção manual existente permanece disponível; authorizedByUid é gravado somente quando o autorizador corresponde ao usuário conectado. Campos históricos não são reescritos. O hash de revisão inclui a identidade atual, exigindo nova revisão se o cadastro mudar. Nenhuma permissão é concedida por selecionar um nome: a baixa continua restrita aos administradores ativos autorizados pela regra existente.

## Extrato por data efetiva (em desenvolvimento, ainda não publicado)

Relatórios oferece uma consulta adicional, somente leitura, com uma linha por evento auditado de pagamento nativo. Soma apenas o valor efetivamente desembolsado no período, sem repetir o valor nominal nem os ajustes do título. O filtro de última baixa dos relatórios existentes permanece disponível.

A consulta exige a mesma autorização administrativa dos lançamentos nativos. Percorre o histórico auditado paginado, pois a data de registro não substitui a data efetiva. Não inclui pagamentos legados sem eventos de baixa; esta cobertura aparece na interface. Registros inconsistentes, duplicidade e volume acima de 20 mil eventos interrompem o relatório, sem apresentar totais parciais. A evolução para processamento indexado é necessária antes de ampliar esse volume.

Validação sintética: parcelas em meses distintos, registro retroativo, período inválido, duplicidade, histórico incompleto e paginação. Nenhum dado real alterado. Estorno e exportação deste novo extrato ainda não implementados.

## Recorrência mensal — em desenvolvimento, não publicada

O modal apresenta os 12 meses. Regras novas exigem modalidade explícita: contínua (`continuous`, sem fim, todos os meses) ou meses específicos (`months`, seleção obrigatória e vigência inicial/final). O servidor valida a seleção e a competência, e regras antigas sem modalidade conservam sua vigência original. Desativar a regra impede novas provisões; não altera lançamentos já existentes.

O modo contínuo renova a elegibilidade mensal após a virada do ano. Conforme decisão de Paulo, o trabalhador mensal cria pendências com valor nulo em payableMonthlyDrafts, fora dos saldos. Todas as competências contínuas exigem novo valor, mesmo se a origem era fixa. Nenhum valor anterior é preenchido. Revisão e confirmação criam o título e encerram a pendência na mesma transação. Regras contínuas anteriores precisam ser salvas novamente para ativar monthlyDrafts explicitamente. Testes cobrem virada do ano, calendário de fevereiro, seleção inválida, mês não selecionado, compatibilidade de regras antigas e bloqueio de competência duplicada.


O job payable-provision-job.js recupera competências desde o início da regra até o mês atual, ignora a competência de origem e títulos já gerados. Chave estável por regra/mês evita duplicação sob repetição e concorrência. Máximo 240 meses por regra e 500 regras; excesso gera falha para revisão. Configuração preparada em scripts/deploy-payable-provisions.py: execução diária às 06h de São Paulo, imagem imutável do serviço aprovado e guarda de SHA obrigatório. Ainda não implantado nem executado em produção. A geração automática depende da implantação deste job e do Scheduler; salvar regra sozinho não ativa infraestrutura.
