# Desligamento do Jotform no Financeiro

Solicitado por Paulo em 12/10/2026. Preparado no código; ainda não aplicado em produção.

## Escopo

- Bloquear webhook, reconciliação, alteração de respostas e consulta do checklist antes de chamadas externas ou gravações.
- Preservar transações, clientes e eventos históricos no Firestore, os dados na conta Jotform e as funcionalidades nativas do Financeiro.
- Manter a Base de Faturamento e informar que a consulta contratual externa está desativada. Não substituir ausência de dados por checklist vazio ou mensalidade conferida.
- Pausar o Scheduler `jotform-reconcile-missed-webhooks`, remover as credenciais do runtime atual e redirecionar todas as tags antigas para a revisão desativada.
- Não revogar a chave global da conta Jotform: sua utilização por outros apps não foi inventariada. Revisões antigas podem reter configurações, mas deixam de receber tráfego pelas URLs normais e tags. IAM administrativo continua podendo alterar isso.

## Publicação protegida

Após aprovação de Paulo para o SHA completo atual da main:

1. Conferir menus/contratos da produção, executar testes, gerar build e informar `FINANCEIRO_APPROVED_COMMIT` com o SHA expressamente aprovado.
2. Executar `python3 scripts/retire-jotform.py`. O script exige o guard original, implanta revisão sem tráfego, verifica o bloqueio, pausa o agendamento e promove o corte para todas as tags. Guarda somente metadados de roteamento, sem segredos.
3. Executar o deploy oficial do Hosting para o mesmo SHA. A etapa existente de fixação do checklist passa a exigir a revisão desativada.
4. Conferir saúde com `jotformEnabled: false`, HTTP 410 nas rotas legadas, Scheduler PAUSED, ausência das duas credenciais no runtime atual e mensagem do checklist na interface. Registrar as evidências sem chaves.

Em caso de falha, manter o corte já aplicado e corrigir a etapa restante; não reativar automaticamente credenciais, Scheduler ou revisões antigas. Uma reversão precisa de decisão explícita de Paulo.

## Pendência funcional

O checklist contratual dependia de leitura ao vivo do Jotform, não de um histórico completo persistido no Financeiro. Sua retomada requer fonte substituta validada. Os cadastros e boletos do Boleto Cloud não demonstram, sozinhos, entrada, saída, suspensão e vigência contratual.
