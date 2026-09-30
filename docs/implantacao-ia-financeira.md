# Implantação de IA — Financeiro, CFI e CCI

Data de início: 30/09/2026. Escopo da primeira entrega: etapas 1 e 2 no Financeiro.

## Acompanhamento

| Etapa | Entrega | Situação | Critério para avançar |
|---|---|---|---|
| 1 | Backup, comparação da base e plano | Concluída | Backup conferido; base remota e versão pública correspondem |
| 2 | Consultor Financeiro no servidor | Implementação e validação local concluídas; publicação pendente | Cálculos e acesso testados; backend configurado e homologação autorizada |
| 3 | Fila de inconsistências | Planejada | Pendências com origem, responsável e resolução rastreável |
| 4 | Conciliação Itaú assistida | Planejada | Associação revisável, sem baixa duplicada; homologação com OFX autorizado |
| 5 | Cobrança pelo SP Connect | Planejada | Títulos conferidos antes do contato; histórico e suspensão por disputa |
| 6 | Faturamento e preparação de contas a pagar | Planejada | Lotes e documentos revisáveis; execução financeira definida separadamente |
| 7 | Assistência ao CFI e CCI | Planejada | Usar resultados oficiais e preservar competência/versão do fechamento |
| 8 | Integração Dots e autonomia delimitada | Dependente de documentação | API, disponibilidade, autenticação e limites confirmados |

Uma etapa operacional por vez. Não interpretar uma etapa planejada como função já implantada.

## Base e backup

- Repositório: `Paulocpjunior/https-github.com-Paulocpjunior-sp_dashboard_financeiro`.
- Base: `a4648553490c600de744dc2840786cc1dd7980e2`.
- Consulta pública a `/version.json`: commit `a464855`, build `20260926T115316Z-a464855`.
- Backup durável no GitHub: branch `codex/backup-financeiro-antes-ia-20260930`, apontando para a base original.
- Backup anterior às alterações: `/workspace/backups/financeiro-antes-ia-20260930T222334Z/financeiro.tar.gz`.
- SHA-256: `2ab797fc4f1de620a6a99e094822c8d961b116fb7eec5ef5d1f33d495c64bbfd`.
- Conferência: conteúdo dos 131 arquivos versionados comparado com o arquivo de backup.
- O backup contém o checkout e o histórico Git disponível; não é exportação do Firestore, de segredos ou de configuração remota.
- Nenhum dado financeiro de produção precisa ser alterado para esta entrega.

Para recuperar o código em uma pasta separada:

```bash
cd /workspace/backups/financeiro-antes-ia-20260930T222334Z
sha256sum -c SHA256SUMS
mkdir -p /workspace/restauracao-financeiro
tar -xzf financeiro.tar.gz -C /workspace/restauracao-financeiro
```

## Comportamento da primeira entrega

- O assistente escolhe explicitamente entre os lançamentos dos filtros atuais e toda a base financeira da SP.
- O navegador envia pergunta, modo e identificadores da seleção; valores oficiais vêm do Firestore no servidor.
- Os cálculos usam as mesmas regras canônicas de valores/status do Dashboard, em `shared/transactionAmounts.mjs`; `utils/transactionAmounts.ts` mantém a API tipada do app.
- A projeção soma todos os títulos abertos dentro de trinta dias, começando no dia de referência de São Paulo. Não corta em cinquenta registros.
- Sem saldo inicial confirmado, apresenta variação prevista, nunca saldo bancário, disponibilidade ou dia de insolvência.
- Atrasados ficam separados; nenhuma nova data de liquidação é inventada.
- Datas inválidas, valores ausentes e direções desconhecidas aparecem como limitações da análise.
- Cálculos usam centavos; classificação/status e tratamento de pagamentos parciais seguem as regras atuais do app. A representação completa de liquidações parciais pertence à etapa de conciliação.
- O ranking mostra no máximo dez clientes, informa a contagem total e não limita os totais financeiros.
- Sem OpenAI, as consultas calculadas funcionam quando o serviço está habilitado. Interpretação de texto e filtros naturais exigem configuração do provedor.
- Nenhuma rota escreve títulos, realiza baixa, emite cobrança ou executa pagamento.

## Backend e configuração

Serviço novo e separado: `sp-financial-ai`, região `us-central1`, projeto financeiro `gen-lang-client-0888019226`.

| Rota | Função |
|---|---|
| `GET /health` | Saúde do processo, sem consulta a dados |
| `GET /api/financial-ai/status` | Disponibilidade, após validar sessão e perfil |
| `POST /api/financial-ai/query` | Consulta ou interpretação de filtros, autenticada |

Variáveis exclusivas do servidor: `FINANCIAL_AI_ENABLED`, `OPENAI_API_KEY` e `OPENAI_MODEL`. Não há segredo no frontend. `FINANCIAL_AI_ENABLED=false` desliga as consultas. A chave deve ser vinculada pelo Secret Manager; o modelo precisa ser confirmado na conta antes da configuração.

O provedor usa `POST https://api.openai.com/v1/responses`, saída estruturada e `store:false`. Esta opção não é uma afirmação de retenção zero pelo provedor. Avaliar a política contratual aplicável antes de habilitar dados reais. Para análise, o sistema envia pergunta e agregados, sem nomes, CPF/CNPJ, descrições ou transações brutas. A pergunta pode conter dados digitados pelo usuário. Para filtros, envia opções de banco/tipo/responsável da seleção, além da pergunta e data de referência.

O texto generativo é um complemento qualitativo; os números oficiais são produzidos pelo motor financeiro. Falhas do provedor preservam os cálculos e são informadas. Não há preço ou ID de modelo presumido.

O serviço valida tokens Firebase com revogação, perfil ativo e papéis atuais. Revalida antes da chamada externa e antes da resposta. O escopo desta etapa é a base interna compartilhada da SP, conforme o acesso atual a `transactions`. Não oferece isolamento multi-tenant novo; expansão para organizações independentes exige desenho próprio de autorização.

Limites explícitos: pergunta de até quatro mil caracteres, corpo de até um MiB, dez mil identificadores por seleção, vinte mil registros na base completa e dez consultas por minuto/usuário/instância, com uma consulta simultânea por usuário/instância. Excesso gera erro, nunca totais parciais. O limite é local à instância e não constitui teto global de custo. Antes da ativação, definir limites de instâncias e orçamento do provedor.

A identidade do serviço precisa de leitura do Firestore e de verificação de usuários Firebase Auth. O acesso ao segredo OpenAI deve ser restrito ao segredo necessário. O projeto Firebase está fixado no backend para evitar o uso acidental de outro projeto.

## Validação e execução local

```bash
npm ci
npm run test:financial-ai
npm run check
```

Instalar e iniciar o serviço, usando credenciais autorizadas do projeto financeiro:

```bash
npm ci --prefix cloud-run/financial-ai-service
npm run test:financial-ai-http
FINANCIAL_AI_ENABLED=true npm start --prefix cloud-run/financial-ai-service
```

Em outro terminal:

```bash
FINANCIAL_AI_DEV_TARGET=http://127.0.0.1:8080 npm run dev
```

Nenhuma chave deve ser colocada nesses comandos ou em arquivos versionados. Sem credenciais Firebase válidas o serviço bloqueia as consultas. Os testes usam dados e credenciais sintéticos, sem conexão financeira real.

Docker usa a raiz do repositório como contexto:

```bash
docker build -f cloud-run/financial-ai-service/Dockerfile -t sp-financial-ai .
```

## Publicação e homologação

Preparar backend e Hosting como uma entrega coordenada. A rota `/api/financial-ai/**` aponta apenas para o serviço novo; rotas de PDF, Boleto Cloud e Itaú são preservadas.

Antes de publicar: executar as proteções do repositório, conferir commit remoto, comparar os menus e obter autorização para o SHA completo conforme `AGENTS.md`. Não preencher `FINANCEIRO_APPROVED_COMMIT` por inferência.

Publicar o backend primeiro, mantendo o serviço desabilitado até sua configuração. Validar saúde, bloqueios 401/403, autenticação, cálculos e falha do provedor. Depois publicar o Hosting do commit aprovado e conferir versão, consultas, seleção dos filtros e projeção. Preservar Tesouraria Wix, Base de Faturamento, permissões, PDFs e exportação Boleto Cloud.

Rollback da funcionalidade: desabilitar o serviço por `FINANCIAL_AI_ENABLED=false`. Para reverter o código, preparar uma reversão revisável e publicá-la pelo mesmo fluxo; não publicar uma branch antiga contornando as proteções.

## Evidências de validação local

- TypeScript e build de produção concluídos.
- Dezessete casos de cálculo, acesso, limites e provedor; um caso HTTP integrado, todos com dados fictícios e sem casos pulados.
- Treze casos existentes do extrato Itaú, mais testes de permissões, faturamento, Boleto Cloud, ordenação/duplicidades, concorrência de carregamento e métodos de pagamento.
- Proteções de publicação e testes de bloqueio por remoção de funcionalidades aprovados.
- Regras compartilhadas comparadas à base original em cinquenta e quatro combinações de status, direção e origem.
- Auditorias npm do frontend e backend sem vulnerabilidades reportadas após correção das dependências. Frontend fixa patches de grpc-js e DOMPurify; backend usa Firebase Admin 14.5.0 e fixa uuid 11.1.1 no gaxios. CI e container usam Node 22.
- Código de menus, Tesouraria Wix, faturamento, PDFs, permissões, regras Firestore e trava comparado byte a byte ao backup, sem alterações.
- Navegador Chromium: seleção por ID oficial, consulta de toda a base, projeção e limpeza ao encerrar sessão conferidas em uma prévia com autenticação e dados fictícios.
- Homologação com Firebase e OpenAI reais, comparação visual autenticada em produção e ativação permanecem pendentes.

## Dots

Referência fornecida: https://openai.com/index/introducing-dots/ . A consulta neste ambiente retornou HTTP 403. API/SDK, capacidades, custo e disponibilidade ainda não foram confirmados. Esta entrega não instala Dots nem cria um agente atribuído à OpenAI com interface presumida. O backend de consultas é a primeira fronteira para uma futura integração autenticada.
