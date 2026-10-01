# Correção de saldos acumulados — 01/10/2026

Paulo relatou painel zerado na virada do mês. A primeira hipótese de filtro mensal foi insuficiente: contas em aberto e o saldo acumulado precisam continuar visíveis em outubro.

Diagnóstico de leitura do Firestore: 46.417 documentos de transações; 583 com data de lançamento em setembro; zero com essa data em outubro. Essas contagens confirmam disponibilidade e existência de registros, sem confirmar a sessão específica do navegador ou valores devidos. A produção permaneceu no commit a464855; as tentativas de implantação da conferência mensal foram bloqueadas por IAM.

Causa identificada no código: `Layout` exibia `DataService.getGlobalStats()`, mas esse método somava `CACHED_TRANSACTIONS`, atualmente limitado ao período da tabela. Portanto, ao abrir outubro, os cartões globais passavam a usar uma consulta mensal vazia. Além disso, a soma antiga não excluía registros marcados como excluídos.

Correção preparada: apuração independente de todo o histórico, usando os helpers financeiros homologados. Contas em aberto persistem até baixa válida, independentemente da data do filtro mensal. O saldo de lançamentos pagos acumula o histórico recebido menos pago; não é apresentado como saldo bancário conciliado. Movimentos mensais permanecem filtrados, com período sempre visível e rótulos próprios.

A consulta usa REST Firestore com o token Firebase do usuário e mantém as regras de acesso existentes. Projeta somente campos necessários aos helpers, pagina por identidade oficial e fixa a mesma readTime até a conclusão. Reduz o volume transferido e acumula em centavos sem manter toda a base em memória. Nenhum resultado parcial é publicado. Ausência de resposta, falha de permissão, troca de sessão, timeout ou versão inconsistente produzem estado indisponível, não saldo zero.

O cache acumulado é separado do cache mensal e limitado à sessão do usuário, com atualização a cada dez minutos e botão explícito de atualização. Essa leitura ainda gera leitura de todos os documentos e tem custo; um resumo materializado no backend é uma melhoria posterior, com reconciliação e atualização segura. Não usar uma soma simples por campo para substituir os helpers, pois existem fontes e valores legados com prioridades distintas.

Não são criadas transações de transporte nem alterados valores, baixas, exclusões ou competências no banco. O transporte é continuidade da apuração e das obrigações existentes. Ainda é preciso publicar a correção, mantendo as proteções do repositório. A conta usada pelo Hosting continua dependendo da permissão run.services.get para o serviço protegido sp-pdf-download; essa falha é distinta da causa do saldo global.

Teste principal: setembro com recebível aberto de R$ 500, débito aberto anterior de R$ 300 e recebimento já pago de R$ 200; outubro sem lançamentos novos continua mostrando os abertos de R$ 500/R$ 300 e acumulado pago de R$ 200. Testes adicionais: exclusões, Wix, múltiplas páginas, versão consistente, falha após página inicial, sessão alterada e consulta vazia comprovada.

Backup de código antes da correção: /workspace/backups/financeiro-antes-saldos-acumulados-20261001T101508Z. Não inclui backup do banco.
