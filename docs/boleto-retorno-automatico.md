# Retorno automático do Boleto Cloud

## Responsabilidades

O Boleto Cloud mantém a comunicação Itaú API/VAN e o processamento do RET. O aplicativo consulta `GET /api/v1/boletos/{token}/situacao`; não reenvia remessas nem reprocessa o mesmo RET. Referência: https://developers.boleto.cloud/v1/boletos/situacao/ (conferida em 09/10/2026).

O Cloud Run Job `sp-boleto-returns` executa independentemente de sessões do navegador. O Cloud Scheduler chama a API autenticada do Cloud Run a cada 15 minutos. Nenhuma rota pública de baixa foi adicionada. O invocador dedicado recebe `roles/run.invoker` somente nesse job; o worker reutiliza a conta de serviço e referências de segredos do backend homologado. Essa conta de execução já possui permissões amplas: o mecanismo não substitui controles IAM.

Referência de agendamento autenticado: https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule.

## Critérios de baixa

Somente emissões do aplicativo em produção, com vínculo explícito a um recebível `native-finance`. São conferidos token, controle de emissão, nosso número, CPF/CNPJ, conta configurada, emissão, vencimento e valor. A situação deve ser `PAGO`, com `PAGAMENTO_INFORMADO`, origem `BANCO`, `marcadoComoPago=false`, data válida e valor integral sem encargos ou desconto. A origem `BANCO` foi observada também em uma consulta real de título pago desta conta.

Marcação manual, pagamento parcial, encargos, desconto, título cancelado, alteração do lançamento, identidade divergente e registros legados ficam para revisão. A rotina não associa o histórico importado por aproximação. Não modifica contas a pagar, checklist, fechamento ou Wix. A consulta individual do painel continua sem efeito financeiro.

A gravação de pagamento, auditoria imutável e estado da emissão ocorre em transação Firestore. O valor recebido é atribuído, nunca somado em retentativas. Uma reversão posterior no emissor gera revisão sem estorno automático. Auditoria em `boletoSettlementAudit`, resultado por emissão em `boletoIssues.returnSync`, histórico em `boletoHistoryUpdates`, execução em `boletoReturnJobs/production`. Esses documentos continuam bloqueados às escritas de clientes pelas regras existentes. Administradores IAM ainda podem alterar dados.

## Execução e escala

Cada execução percorre até 20 documentos ordenados por ID e salva cursor; documentos fora do escopo também avançam o cursor. Uma concessão de 15 minutos impede concorrência, com verificação do proprietário na transação financeira. Timeout do job: 10 minutos; cada consulta: 20 segundos. Erros são expostos e tentados novamente na próxima volta do cursor. A frequência de consulta de cada boleto aumenta com o volume: mais de 20 emissões exigem mais de uma execução para completar a volta. A rotina segue consultando pagos para detectar divergências posteriores. Revisar capacidade, retenção de consulta e limites do provedor antes de crescer o volume.

O painel exibe última execução sem falhas, execução atrasada (45 minutos sem início) e até 30 pendências com total completo. Não há promessa de confirmação instantânea: depende da chegada do retorno ao emissor. Histórico, campos de crédito e situação podem atualizar antes ou depois da baixa, conforme a confirmação disponível.

## Publicação protegida

1. Executar testes, build, revisão e confirmar origin/main.
2. Obter autorização explícita de Paulo para o SHA completo. Somente então definir `FINANCEIRO_APPROVED_COMMIT`.
3. Publicar backend pelo fluxo existente, com label `financeiro-commit` igual ao SHA, e verificar a revisão pronta. Publicar Hosting e preservar a rota do checklist pelo procedimento homologado.
4. `python3 scripts/deploy-boleto-returns.py` mostra o plano sem mutações. `--apply` executa a mesma trava de produção e exige a imagem imutável da revisão aprovada. Configura job, segredos por referência, invocador dedicado e agendamento. Se uma atualização falhar após pausar o Scheduler, ele permanece pausado até revisão.
5. Verificar configuração e executar uma vez com `gcloud run jobs execute sp-boleto-returns --region us-central1 --project gen-lang-client-0888019226 --wait`. A execução autorizada pode baixar recebíveis elegíveis.
6. Verificar no painel e Firestore: confirmação bancária, auditoria única, valor recebido, data, ausência de duplicidade. O comprovante enviado não substitui a confirmação bancária. Não criar novo boleto para repetir o teste já pago.

Para simulação sem escrita: iniciar `node boleto-return-job.js --dry-run` no diretório do serviço, com credenciais obtidas do cofre em memória. Retorna somente contagens, sem tokens ou dados de pagador. A simulação percorre a primeira página.

Para interromper: pausar `sp-boleto-returns-every-15m` no Cloud Scheduler e verificar se há execução em curso. A pausa não cancela execução iniciada; cancelar também essa execução se necessário. Não desfazer baixas válidas. Para desabilitar apenas novas baixas, atualizar o job com `BOLETO_CLOUD_RETURN_SETTLEMENT_ENABLED=false` pelo fluxo autorizado. O painel só reflete essa mudança após nova execução.
