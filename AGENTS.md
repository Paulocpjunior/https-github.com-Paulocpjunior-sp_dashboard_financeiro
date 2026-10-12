# Preservação obrigatória do Financeiro

- Nunca remover, ocultar ou substituir funcionalidades homologadas sem autorização expressa de Paulo.
- Tesouraria Wix, Base de Faturamento, permissões, PDFs e exportação Boleto Cloud são contratos protegidos.
- Antes de publicar, confirmar o commit remoto, executar os testes e comparar os menus com a produção.
- Push na main valida o código; não é autorização de deploy. Solicitar autorização para o commit a publicar.
- O deploy exige FINANCEIRO_APPROVED_COMMIT igual ao SHA completo autorizado. Não preencher com autorização inferida.
- Não remover ou contornar scripts/guard-production.mjs ou o predeploy para vencer uma falha.
- Não publicar de branches antigas nem alterar dados financeiros para validar interface.
- As travas do repositório não substituem controle IAM: administradores ainda podem contorná-las. Nunca prometer impossibilidade absoluta de regressão.

# Identidade visual compartilhada do SaaS

- Interfaces novas e alterações visuais seguem `design-system/README.md` e `design-system/tokens.css`, também referenciados em `CLAUDE.md`.
- Manter marca própria SP, componentes e variáveis comuns. Não criar padrões diferentes por agente.
- Migrar telas legadas por módulo, preservando todos os contratos acima. O padrão visual não dispensa autorização de publicação por SHA.
