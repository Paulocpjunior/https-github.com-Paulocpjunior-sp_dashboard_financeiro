# Emissão direta Boleto Cloud

Paulo autorizou em 08/10/2026 retirar o CSV e emitir dentro do app. O botão de Contas a Receber abre a seleção de cobrança, endereço e revisão. O endpoint antigo `/api/boleto-cloud-csv` permanece como rota de encerramento (HTTP 410), sem gerar arquivo ou expor o token da conta. A rota é preservada para compatibilidade com versões antigas e com a trava existente; guard-production e predeploy não foram removidos nem contornados.

## Comportamento

- Emissão individual e explícita, com dados e valor relidos de `transactions` pelo servidor. Não marca pagamento, não envia mensagem e não cria lançamentos.
- Nome, CPF/CNPJ, valor e vencimento devem ser corrigidos na origem. Endereço é informado na revisão e persistido com o boleto.
- Somente usuários ativos, não bloqueados/excluídos, administradores ou com `billing.boleto-cloud.issue` podem revisar, emitir, recuperar e obter PDF/registro.
- O servidor exige revisão atual, documento válido, vencimento válido, entrada pendente/agendada/vencida, método Boleto e ausência de exclusão. Bloqueia registros Wix, saídas e pares com CPF/CNPJ, valor e vencimento iguais. Casos legítimos de valores iguais exigem revisão; não são resolvidos automaticamente.
- `boletoIssues` armazena revisão, tentativa, estado, identificador de controle, token do emissor, nosso número e registro. A subcoleção `events` registra ator e resultados. `boletoIssueLocks` impede duplicidade concorrente entre lançamentos. O acesso direto pelo navegador fica negado pelo deny-all existente em firestore.rules; tudo passa pelo backend autenticado.
- Uma chave determinística de até 44 caracteres por ambiente e lançamento é enviada em `boleto.tokenControleUsuario`. A tentativa é reservada por transação Firestore antes da chamada externa; não se chama o emissor dentro de transações que podem repetir.
- HTTP 201 guarda o token. HTTP 409 somente associa o boleto existente se o identificador de controle retornado corresponde. Respostas não comprovadas ficam pendentes. HTTP 400/401 de uma emissão inicial permite nova revisão, sem repetição automática.
- Timeout, erro de rede, resposta inesperada ou queda após chamada não significam falha definitiva. Após um minuto, Recuperar tentativa faz exclusivamente GET por controle. Não reenvia POST, inclusive se o lançamento já foi pago ou alterado. Se o emissor não localizar o boleto, permanece pendente para conferência no painel/suporte; não há desbloqueio automático.
- O PDF é recuperado autenticado do emissor. Criado não equivale a registrado: o usuário consulta o registro bancário separadamente. Registro não equivale a pagamento nem a entrega.
- A seleção também permite consultar lançamentos pagos que continuem visíveis nos filtros de Contas a Receber.

## Configuração no serviço sp-pdf-download

Em 09/10/2026, Paulo confirmou que a conta Boleto Cloud já está homologada e em produção. Esta implantação usará diretamente essa produção; não exige cadastrar credenciais nem repetir homologação de Sandbox. O suporte a Sandbox permanece opcional para desenvolvimento. A homologação existente da conta não substitui a verificação do novo fluxo do app após a publicação autorizada.

Todas as credenciais ficam no Secret Manager e são vinculadas ao Cloud Run; não usar VITE_, código, mensagens ou logs para chaves.

| Variável | Sandbox | Produção |
| --- | --- | --- |
| BOLETO_CLOUD_ENVIRONMENT | sandbox (padrão) | production |
| BOLETO_CLOUD_ISSUANCE_ENABLED | true após configuração | true após configuração e publicação autorizada |
| BOLETO_CLOUD_SANDBOX_API_KEY | API Key do usuário Sandbox | não utilizada |
| BOLETO_CLOUD_SANDBOX_ACCOUNT_TOKEN | token da conta Sandbox | não utilizado |
| BOLETO_CLOUD_API_KEY | não utilizada | API Key do usuário de produção |
| BOLETO_CLOUD_ACCOUNT_TOKEN | não utilizado | token da conta já existente |
| BOLETO_CLOUD_CUTOVER_DATE | não obrigatório | data real de início, YYYY-MM-DD, não futura |

O domínio é fixado pelo servidor: sandbox.boletocloud.com ou app.boletocloud.com. Não há URL arbitrária configurável. Credenciais de produção nunca são usadas como fallback de Sandbox. O token da conta e a API Key do usuário são diferentes; não regenerar nenhum token existente. A revisão é invalidada se mudar a conta.

A data de virada é requisito de ativação, não prova de ausência de emissões antigas. Antes de cada emissão, o operador deve conferir no painel que a cobrança não foi emitida via CSV ou manualmente. O legado não gravava identificadores de emissão por lançamento: a aplicação não consegue certificar automaticamente os CSVs já importados. A declaração fica auditada e os arquivos antigos devem sair do fluxo operacional na virada.

## Integração à produção homologada e publicação

1. Cadastrar somente a API Key do usuário de produção no Secret Manager (`sp-dashboard-boleto-cloud-api-key`). Preservar o token Itaú existente (`sp-dashboard-boleto-cloud-itau-3145-99791-6-token`). Não criar ou exigir credenciais de Sandbox para esta ativação. Validar permissões, duplicidade e falhas com testes sintéticos locais.
2. Usar a conta de produção homologada, conforme confirmação de Paulo em 09/10/2026. O guia informa registro online e VAN; o resultado de cada novo boleto emitido pelo app ainda deve ser consultado no emissor.
3. Revisar PR, testes, menus e commit remoto. Publicação somente a partir da main atual e com FINANCEIRO_APPROVED_COMMIT igual ao SHA completo autorizado por Paulo.
4. Publicar primeiro o backend sp-pdf-download em us-central1, preservando identidade, configurações e segredos existentes; depois Hosting pelo fluxo protegido. A rotina atual de Hosting não publica este backend automaticamente.
5. Definir explicitamente BOLETO_CLOUD_ENVIRONMENT=production e vincular BOLETO_CLOUD_API_KEY e BOLETO_CLOUD_ACCOUNT_TOKEN aos segredos de produção. Confirmar data da virada, revisar cobranças que já passaram pelo CSV e emitir poucos títulos reais escolhidos pelo operador, após a autorização de publicação. Conferir no painel o registro antes de ampliar o volume.
6. Validar versão pública, saúde, rotas, menus, permissões e fluxo real. A reversão operacional deve desabilitar BOLETO_CLOUD_ISSUANCE_ENABLED; não restaurar o CSV durante resultado incerto nem apagar histórico/chaves de controle.

Verificação em 08/10/2026: o serviço publicado tinha somente BOLETO_CLOUD_ACCOUNT_TOKEN. A listagem de nomes dos segredos Boleto encontrou apenas o token da conta; valores não foram exibidos. Não houve emissão real, homologação com credencial Sandbox nem deploy nesta preparação.

Referências: guia-sandbox-para-producao.pdf fornecido por Paulo; https://developers.boleto.cloud/v1/boletos/criar/ ; https://developers.boleto.cloud/v1/boletos/situacao/ ; https://developers.boleto.cloud/v1/boletos/status-registro/ . Há divergência entre guias antigos sobre retorno 200 e referência de criação sobre 409: respostas sem evidência suficiente ficam em revisão, nunca provocam nova emissão automática.

Atualização em 09/10/2026: a API Key de produção ainda não aparece na listagem de nomes do cofre. A tela local de cadastro solicita somente essa API Key. A vinculação ao Cloud Run e a habilitação de emissão ficam para a publicação do commit autorizado.
