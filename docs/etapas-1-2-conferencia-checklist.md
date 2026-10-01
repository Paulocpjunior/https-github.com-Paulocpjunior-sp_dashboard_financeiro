# Etapas 1 e 2 — conferência e checklist

## Etapa 1: histórico completo

A conferência deixa de ler somente 20.000 documentos. Consulta o histórico paginado com o token do usuário, mantém um único `readTime` e só entrega resultado depois da última página. Projeta os campos necessários aos helpers financeiros, mantém identidade oficial do documento e permite detectar datas inválidas e conflitos de número de cliente no histórico completo. Nenhum lançamento é criado ou atualizado.

Uma falha em qualquer página, mudança de sessão, resposta inválida ou limite de segurança (500 mil documentos / 180 segundos) invalida a consulta inteira. A tela informa quantidade de registros e horário do snapshot. O relatório segue sem autorização para concluir o mês. A leitura continua gerando custo por documento; é manual, não executada a cada alteração do mês na tela.

## Etapa 2: leitura protegida do checklist

Formulário confirmado: Check List Atual 2026, ID 210135417457653. Paulo confirmou que dia de cobrança e última cobrança estão nas observações. Essas informações são preservadas como texto para revisão humana, sem transformar inferências em obrigações ou dispensas.

A rota POST `/api/billing-checklist/review` roda no serviço existente `jotform-webhook`, região southamerica-east1. Usa a credencial JOTFORM_API_KEY já configurada no runtime. Verifica token Firebase e perfil financeiro ativo antes de acessar a fonte; a chave nunca é enviada ao navegador.

Lê perguntas e todas as respostas em duas passagens, confrontando contagem, IDs, versões e conteúdo. Fonte alterada durante a consulta, paginação repetida, esquema incompatível ou contagem não confirmada tornam o resultado indisponível. O total esperado é consultado na fonte, não fixado nos 1.420 informados pelo conector.

Campos mapeados por títulos exatos normalizados: nome, Nosso Número, honorários, entrada, saída, suspensão, status e observações; CPF/CNPJ quando existir. Não junta clientes por nome. Campos duplicados divergentes e respostas repetidas para uma identidade geram pendências; não escolhe automaticamente a resposta mais recente. Status ACTIVE é o estado da resposta no Jotform, não prova de contrato ativo.

Métricas: respostas esperadas/recebidas, respostas ACTIVE e excluídas, registros sem divergência de campos, registros com pendências, observações a revisar e horário da leitura. Todos os contratos permanecem não validados. Uma leitura completa não libera fechamento.

Cache de leitura no backend por dez minutos; atualização manual pode solicitar nova leitura após intervalo mínimo de trinta segundos. Nenhuma resposta Jotform nem transação Firestore é alterada. Esta etapa ainda não mantém histórico persistente de revisões ou sincronização incremental: ambos devem ser adicionados antes da lista de obrigações auditável (etapa 3).

## Validação e implantação

Testes locais cobrem mais de 20 mil transações, falha depois da primeira página, 1.420 respostas sintéticas paginadas, fonte editada entre passagens, leitura incompleta, datas inválidas, datas duplicadas conflitantes, respostas repetidas e bloqueio de acesso anônimo. Regressões do webhook existente, permissões, boletos, relatórios, filtros, concorrência, extrato Itaú, lint e build passaram. Não confundir esses testes com homologação dos valores reais ou de todos os formatos legados do Jotform.

Backup anterior: `/workspace/backups/financeiro-antes-etapas-1-2-20261001T112046Z` (código, não exportação de banco).

O diagnóstico de IAM confirmou `run.services.get`, mas não `run.services.update` ou `cloudbuild.builds.create` para a conta do workflow no projeto. A hospedagem pode ser publicada; a nova rota exige implantação do backend com uma identidade autorizada. Publicar primeiro a etapa 1; publicar a interface da etapa 2 somente depois de a rota protegida estar implantada e a leitura real homologada.

Próxima fase: resolver identidade/vigências, confirmar informações nas observações, cruzar checklist com cobranças e formar obrigações por cliente/competência. Emissão, entrega, aprovação de dispensas e trava no servidor continuam fora destas duas etapas.
