# Recebíveis e conciliação OFX

O perfil Operacional consulta somente transações com `movement = Entrada` e
`type = Entrada de Caixa / Contas a Receber`. Classificações ausentes ou
contraditórias permanecem restritas à administração, sem corrigir dados na origem.
As regras do Firestore bloqueiam também leitura direta, consultas amplas, contagens
sobre todas as transações e baixa de saídas. Não basta esconder o menu.

O administrador mantém o painel completo. Extrato, OFX, conciliação e Tesouraria
Wix são exclusivos desse perfil, mesmo se um operacional tiver permissões antigas.
O perfil é conferido no servidor antes de montar a tela; mudança de papel recarrega
a sessão e elimina o cache em memória. Relatórios/PDF e Base de Faturamento continuam
acessíveis ao Operacional, usando consultas restritas aos recebíveis.

## Conciliação

- Exclusiva da administração; usa apenas o OFX importado, sem conexão bancária.
- Consulta até 93 dias, sem exibir resultados truncados.
- Busca lançamentos por vencimento e pagamento no período escolhido.
- Sugere valor/natureza compatíveis e data com diferença de até 3 dias. Documento
  correspondente com valor diferente aparece para revisão, sem confirmar diferença.
- Sugestões não provam identidade: conferir documento, conta e comprovante.
- Confirmação explícita com justificativa e vínculo de um lançamento a uma movimentação.
- A transação no servidor impede dois vínculos simultâneos para a mesma origem.
- Alterações de valor, identidade, conta, situação ou data invalidam a conferência.
- Desfazimento preserva histórico; exportações CSV incluem pendências e histórico.
- Não muda situação, valor ou data do lançamento; não dá baixa, paga ou emite cobrança.
- Lotes, valores parciais, tarifas, descontos e registros fora do período exigem
  revisão separada. Nenhum rateio ou identificação é inferido automaticamente.

## Validação

`npm ci` e `npm run lint`; regressões habituais do Financeiro; `npm run test:itau-statements`.
Com Java 21+ e Firebase CLI 15.13.0: `npm run test:receivables-rules`.
O teste de regras usa exclusivamente o projeto fictício `demo-financeiro-receivables`.
O CI valida regras em PRs e mantém a exigência de autorização por SHA para publicação.

Navegador validado com fixtures: operacional sem saídas, saldo bancário e extrato;
URLs administrativas bloqueadas; exportações CSV/PDF somente de recebíveis;
revisão da conciliação administrativa. Homologação de OFX real continua pendente.

## Publicação

A publicação requer autorização explícita do SHA conforme AGENTS.md.
Publicar os índices e aguardar READY, depois o backend e as regras, e por último
Hosting com `VITE_DEPARTAMENTO_GATE_MODO=bloqueio`. Regras/backend são parte
obrigatória da entrega: somente Hosting não impõe a restrição.
Não remover índices remotos alheios a esta alteração ao publicar os novos índices.
Revalidar versão pública, saúde e acesso com perfis reais após a publicação.
Revisar quais colaboradoras ainda têm papel administrativo; não alterar usuários
ou reativar perfis sem identificação/autorização. Não testar com lançamentos reais.
