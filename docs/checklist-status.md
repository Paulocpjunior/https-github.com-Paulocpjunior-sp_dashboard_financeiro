# Interpretação do checklist pelo STATUS

O STATUS da resposta define seu evento. Normalização aceita acentos, caixa e espaços, sem inferir eventos pelo nome do cliente, datas ou observações.

| STATUS do formulário | Evento e conferência |
| --- | --- |
| CLIENTE NOVO | Entrada; cadastro, início da responsabilidade, honorários e primeira cobrança |
| CLIENTE SAIDA / ENCERRAMENTO CNPJ | Saída; término, motivo, evidência e última cobrança devida |
| CLIENTE ALTERAÇÃO | Alteração; condições alteradas e vigência, preservando obrigações anteriores |
| CLIENTE SUSPENSO | Suspensão; motivo, vigência e condição contratual |
| Ausente ou outro valor | Pendente de identificação do evento |

A tabela mostra as datas compatíveis com o STATUS. As demais continuam acessíveis em **Conferência dos campos originais**; elas não definem saída ou suspensão. Data de cadastro não é início da responsabilidade contratual. Observações são exibidas como texto legível, sem executar HTML.

Os contadores por STATUS contam respostas/eventos, não contratos ativos únicos. Respostas históricas não são substituídas automaticamente. Honorários ausentes no campo estruturado recebem indicação de conferência nas observações; nenhum valor é deduzido ou gravado automaticamente.

Esta entrega publica a interpretação na interface, usando a consulta protegida existente. Não muda registros Jotform, transações, regras de autenticação, cobranças ou fechamento mensal. Atualização de acompanhamento em 03/10/2026: propostas a partir das observações e conferências com histórico foram entregues posteriormente, conforme `confirmacoes-mensais.md`. Certificação de contratos, aprovação de dispensas e trava de fechamento no servidor permanecem pendentes; consultar a fila consolidada em `pendencias-financeiro.md`.

Validação: `npm run lint`, `npm run test:checklist-status`, regressões do fluxo oficial e confirmação online da versão e da rota autenticada após deploy.
