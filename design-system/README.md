# SP SaaS — padrão visual compartilhado

Versão 0.2, 12/10/2026 (0.1 na mesma data). Direção solicitada por Paulo: identidade comum nos apps, independentemente de implementação por Claude Code ou Codex. Esta entrega estabelece a base; não declara os aplicativos existentes migrados. Os valores abaixo são decisões do SP SaaS, não especificações oficiais da Apple.

## Identidade

Referência: clareza e hierarquia das interfaces Apple. Marca, nome e símbolos de identificação continuam próprios do SP SaaS. Logo: o arquivo oficial da SP Contábil enviado por Paulo em 12/10/2026 (monograma "SP" com a caneta-tinteiro, `public/logo-sp.png`, com `favicon.png` e `apple-touch-icon.png` gerados dele) é usado sem redesenho no Financeiro e no DP, num quadrado branco de cantos arredondados no modo ícone (`components/Logo.tsx`). Não criar uma nova marca diferente a cada módulo nem usar a maçã como logo do SaaS.

## Regras para ambos os agentes

- Ler este documento e `tokens.css` antes de qualquer trabalho visual. AGENTS.md mantém as proteções operacionais; CLAUDE.md aponta para as mesmas fontes.
- Componentes novos usam as variáveis `--sp-*`; evitar cores, fontes, sombras e curvas de movimento independentes por tela.
- Uma mudança compartilhada deve atualizar a versão da especificação e a prévia, com lista dos apps afetados. Uma cópia do arquivo não é sincronização automática entre repositórios.
- Enquanto não existir um pacote central instalado em todos os apps, registrar em cada repositório a versão adotada e conferir diferenças. A extração para pacote compartilhado deve manter os mesmos nomes de variáveis.
- Preservar rotas, permissões, operações, nomes reconhecidos pela equipe, PDFs, exportações e dados. Redesenho não autoriza remover ou esconder funcionalidades.
- Publicação segue as regras locais de cada app; no Financeiro exige autorização do SHA completo. Não reutilizar autorização de uma versão anterior.

## Tipografia

Pilha nativa `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter Variable', Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`. Em dispositivos Apple usa a fonte do sistema (San Francisco), que já está no aparelho. Nos demais sistemas usa a Inter (licença SIL OFL), embutida no app pelo pacote `@fontsource-variable/inter` e importada no entry JS (não por `@import` no CSS do Tailwind, que perde os caminhos dos `.woff2`); sem Google Fonts. A aparência fica próxima, não idêntica, entre plataformas. Não empacotar nem carregar arquivos SF Pro/ SF Symbols como recursos web.

Texto base 16px/1.5; tabelas 14px no mínimo; legendas 13px; títulos 28–36px; subtítulos 22px. Peso normal 400 e destaque 600. Valores e datas alinhados com numerais tabulares. Zoom de 200% sem perda de controles.

## Cor e movimento

Usar os tokens semânticos do CSS: fundo neutro, superfície, texto, texto secundário, borda, ação, sucesso, alerta e erro. Azul indica ação/seleção; verde/vermelho/amarelo devem sempre acompanhar rótulo ou ícone, nunca comunicar estado sozinhos. Tema escuro usa os mesmos papéis e componentes.

Espaçamento em múltiplos de 4px; controles com alvo de 44px; raios 10/16/20px para controles/cartões/modais. Transições de 140/220ms; respeitar `prefers-reduced-motion`. Evitar animações contínuas e transparência atrás de valores, tabelas ou documentos. Não reproduzir Liquid Glass como decoração indiscriminada.

## Símbolos e navegação

Nos apps web, adotar Lucide, já presente no Financeiro, com ícones 20px e traço 1.75. Uma mesma ação usa o mesmo ícone e rótulo em toda a suíte. Não misturar emojis, SF Symbols exportados e bibliotecas diferentes nos controles. Ícone decorativo: aria-hidden; botão só com ícone: nome acessível.

Estrutura comum: navegação lateral no desktop; cabeçalho com nome do módulo, título e ação principal; conteúdo com largura confortável e filtros próximos da lista. No mobile, navegação recolhível identificada e tabelas com rolagem própria, sem cortar ações. Não eliminar colunas essenciais para caber na tela. Modais com título, descrição, fechamento, foco contido e devolvido ao acionador. Formulários com rótulos persistentes, mensagens de erro locais, estados de carregamento e proteção contra duplo envio.

Todos os apps devem compartilhar os componentes de botão, campo, seleção, cartão, tabela, filtros, abas, modal, confirmação, aviso, vazio e carregamento. A organização operacional pode variar por domínio; não forçar o mesmo formulário no Fiscal e no Financeiro.

## Adoção e conferência

1. Inventariar as telas e contratos homologados de cada app; obter evidência do estado anterior.
2. Usar `preview.html` como referência comum. Os dados nela são fictícios e não há conexão com o banco.
3. Integrar o CSS de forma opt-in em um módulo piloto (`.sp-ui`), sem sobreposição global em telas antigas.
4. Validar tema claro/escuro, teclado, foco, contraste, redução de movimento, 390px/1440px e zoom de 200%; testar o fluxo funcional afetado.
5. Revisar e publicar o commit autorizado, depois conferir a versão e o fluxo real. Marcar o módulo migrado somente após essa verificação.
6. Repetir nos demais apps. A adoção por outro repositório exige instalação dos arquivos/instruções nesse repositório; esta documentação não controla automaticamente outras sessões.

## Tema Tailwind alinhado — v0.2

Pedido de Paulo ("algo parecido com o que a Apple usa: letra, tipografia, símbolos, logo"), aplicado igual ao DP. Nas telas que usam utilitários Tailwind, o bloco `@theme` de `index.css` redefine as escalas sem mudar classes:

- `slate` = neutros Apple (50 #fbfbfd, 100 #f5f5f7, 200 #e8e8ed, 300 #d2d2d7, 400 #a1a1a6, 500 #6e6e73, 600 #515154, 700 #3a3a3c, 800 #2c2c2e, 900 #1c1c1e, 950 #000000);
- `blue`, `indigo` e `royal` (a antiga cor principal do Financeiro) = um só azul de destaque (600 #0071e3 com texto branco; 700 #0066cc = `--sp-accent`);
- verde, vermelho e âmbar continuam os da Tailwind, por serem semânticos (receita/despesa, pago/em atraso, alerta);
- raios xs .25rem, sm .375rem, md .5rem, lg .625rem, xl .875rem, 2xl 1.25rem, 3xl 1.75rem.

Os tokens `--sp-*` já seguiam esses valores; só a pilha de fontes mudou. O recolorido é de matiz, sem remover nem esconder funções. Conferir visualmente cada módulo na publicação.

## Situação desta versão

- Especificação, tokens e prévia: preparados no Financeiro.
- Financeiro em produção: navegação, barra de ações e consulta financeira publicadas até o commit `11b8f174f1775a3ff9460834c4ff1a014d60d8fa`; demais áreas em migração.
- Tema v0.2 (fonte do sistema com Inter de reserva, neutros e azul da Apple, raios) e logo oficial da SP Contábil (12/10/2026): adotados no DP, CFI, Contábil (CCI) e Legalização, cada um no próprio repositório; Financeiro por este PR, sujeito à autorização de publicação por SHA.
- Connect e demais apps: inventário e adoção pendentes. Distribuição do logo por pacote: pendente; nenhum logo novo foi inventado.

## Referências

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Fontes e licença da Apple](https://developer.apple.com/fonts/)
- [Orientações de uso de marcas Apple](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html)

## Piloto Financeiro — 12/10/2026

Aplicação inicial em `Layout`, `DashboardToolbar` e `ThemeToggle`: navegação neutra, cores semânticas, tipografia nativa, controles consistentes, foco visível e tema sincronizado entre desktop e celular. Demais telas seguem em migração gradual. Piloto publicado e conferido em produção em 12/10/2026 (commit `6225c51`).

Verificação local com dados fictícios: larguras de 390 e 1440 px, modos claro/escuro, fechamento do menu por Escape e callbacks de cadastro, recorrências, atualização, filtros, impressão, exportação e WhatsApp. A prévia isolada de revisão foi removida antes do commit. Nenhum dado financeiro foi alterado.

## Consulta financeira — segunda etapa

Abas de visão, painel de filtros, alertas e tabela adotam superfícies, bordas e raios compartilhados. Alertas passam a usar botões acessíveis pelo teclado; filtros e paginação recebem nomes acessíveis; tabela usa texto de 14 px e rolagem horizontal própria. As regras de seleção, datas, cálculos, permissões e emissão permanecem as existentes.

Validado localmente com dados fictícios em 390 e 1440 px, nos temas claro e escuro: acionamento de alerta por Enter, expansão dos detalhes, preenchimento de datas e pesquisa, paginação e ausência de transbordamento horizontal da página. A revisão não realizou operações financeiras. Etapa publicada e conferida em produção em 12/10/2026 (commit `11b8f17`).

## Formulários financeiros — terceira etapa

Nova conta a receber, Nova conta a pagar e gestão de contas/recorrências usam os tokens comuns em campos, botões, cabeçalhos e abas. Os diálogos nativos preservam o fechamento e o foco; revisão, confirmações, anexos, permissões e regras financeiras permanecem existentes.

Verificação local com APIs fictícias: campos obrigatórios, revisão antes da confirmação, Escape, seleção obrigatória dos meses, layouts de 390 e 1440 px e temas claro/escuro. Testes existentes de lançamentos nativos, contas a pagar e permissões, lint, build e guard de publicação passaram. Nenhum dado financeiro real foi alterado. Esta etapa depende de publicação por SHA autorizado.

## Emissão Boleto Cloud — quarta etapa

Pedido de Paulo (24/10/2026): a tela de emissão de boletos usa o layout e as cores da SP, como os demais apps. O diálogo adota `.sp-ui` com superfície, raio de modal, abas "Uma cobrança"/"Em lote" no padrão segmentado, campos `sp-field`, botões `sp-button` (azul só na ação principal de cada etapa: Revisar cobrança, Confirmar emissão, Baixar PDF), selo de ambiente (Produção/Sandbox) e avisos com faixa semântica (alerta/erro). O verde fixo dos botões foi removido. Regras de emissão, travas, envio ao cliente e textos permanecem os existentes. Conferido localmente com APIs fictícias em 1000 e 390 px, nos temas claro e escuro.
