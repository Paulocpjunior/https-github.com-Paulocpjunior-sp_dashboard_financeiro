# Lista mensal de conferência: checklist e lançamentos

Na página Faturamento, usar **Lista mensal — checklist e lançamentos**, escolher competência e base (vencimento ou emissão/lançamento) e clicar em **Gerar lista mensal de conferência**.

A entrega cruza duas leituras completas autenticadas: histórico financeiro e checklist Jotform. Cada fonte informa seu horário. Falha em uma fonte impede apresentar lista parcial. Os painéis anteriores permanecem disponíveis.

## Associação

CPF/CNPJ identifica o cliente. Nosso Número vincula um documento apenas quando não há divergência nas duas fontes. Zeros iniciais de preenchimento numérico são normalizados. Número ligado a documentos diferentes bloqueia associação automática. Nome semelhante não une clientes. Todos os eventos do checklist são preservados; não se escolhe a última resposta como contrato vigente.

## Situações

- **Identificação a conferir:** ausência de identificação ou número associado a documentos diferentes. Resolver cadastro antes de concluir ausência.
- **Possível ausência de lançamento:** identidade estável com referência financeira anterior e sem lançamento com data válida no mês escolhido. Conferir competência, contrato e eventual dispensa.
- **Checklist sem lançamento nos dois meses:** evento presente apenas no checklist. Conferir entradas novas e vigência; eventos históricos não comprovam cobrança devida no mês.
- **Lançamento localizado:** existe lançamento no mês escolhido. Conferir contrato, valores, emissão e envio.

Filtros de situação e busca, paginação de 20 itens, valores anteriores e atuais de referência, IDs financeiros, STATUS e observações ajudam a rastrear cada caso. A métrica de respostas vinculadas mede associação das fontes; não é cobertura contratual. Situações contam itens de conferência, não contratos ativos comprovados.

## Próximas entregas

Valores e vigências nas observações precisam de confirmação humana. Esta lista não persiste confirmações, justificativas ou dispensas; não emite cobranças nem valida o fechamento. Formar obrigações contratuais confirmadas por cliente e competência, registrar responsável/evidência/aprovação, integrar provas de emissão e implementar revalidação no servidor.

Regressões: `npm run test:billing-obligations` verifica inclusão de entradas sem lançamento, zeros numéricos, vínculos por documento, conflitos entre as duas fontes, eventos históricos, fontes excluídas e saídas que não dispensam cobrança. O fluxo oficial também executa as regressões financeiras existentes.
