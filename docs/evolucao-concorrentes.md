# Evolução funcional — 11/10/2026

Comparação de capacidades, não equivalência comercial ou homologação dos concorrentes. Fontes oficiais consultadas em 11/10/2026.

| Prioridade | Referência | Situação do Financeiro | Entrega necessária e aceite |
|---|---|---|---|
| 1 | Nibo: conciliação inteligente e importação bancária | OFX importado; sugestões apenas para baixas nativas, sem confirmação de conciliação | Triagem e candidatos legados publicados. Vínculo legado auditável e desfazimento preparados nesta branch, sem segunda baixa. Depois: ampliar para baixas nativas e agrupamentos. Não inferir favorecido por valor. |
| 2 | Conta Azul: cobranças recorrentes e automáticas | Recorrências a pagar e emissão de boleto disponíveis; INVITE prepara arquivo | Régua com destinatário validado, PDF/demonstrativo, registro de envio, retentativa idempotente e interrupção após liquidação. Não chamar geração de EML de entrega. |
| 3 | Assistência operacional integrada | FiA autenticada publicada e habilitada (PR #72) | Primeira versão somente consulta entregue; filtro validado em produção. Ampliar a homologação das análises e das referências aos registros. |
| 4 | Conexão bancária automática | API direta Itaú ainda não habilitada; OFX intermediário | Sincronização incremental, cobertura e idempotência, observabilidade e cruzamento com Boleto Cloud sem duplicar baixas. |

## Ordem de engenharia

1. Resolver cobertura de conciliação antes de automatizar decisões. Legado sem banco informado exige revisão; SISPAG pode exigir comprovante individual. Tarifas exigem plano de contas confirmado.
2. Separar obrigação, pagamento e movimento bancário. Confirmação de vínculo deve ter responsável, evidência e histórico; desfazer vínculo não estorna pagamento automaticamente.
3. Integrar comunicação ao gateway autorizado do Financeiro, sem reaproveitar credenciais/escopo de outro departamento. Homologar entrega com destinatário autorizado.
4. FiA ativada com autenticação no servidor. Continuar homologação das análises; chave nunca no frontend.
5. Substituir transporte OFX pela API Itaú quando habilitada, preservando conciliação e trilha de auditoria.

UNAS permanece para configuração posterior do usuário. Alçadas continuam desativadas, conforme decisão expressa. Nenhuma dessas pendências autoriza recriação de lançamentos.

## Fontes

- Nibo: https://www.nibo.com.br/empresa/funcionalidades/conciliacao-inteligente
- Conta Azul: https://contaazul.com/funcionalidades/contratos-recorrentes/

As fontes comprovam capacidades anunciadas, não disponibilidade no contrato de cada cliente. Não há evidência suficiente para afirmar superioridade geral do Financeiro.
