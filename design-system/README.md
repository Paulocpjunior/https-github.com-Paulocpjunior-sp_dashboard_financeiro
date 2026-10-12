# SP SaaS — padrão visual compartilhado

Versão 0.1, 12/10/2026. Direção solicitada por Paulo: identidade comum nos apps, independentemente de implementação por Claude Code ou Codex. Esta entrega estabelece a base; não declara os aplicativos existentes migrados. Os valores abaixo são decisões do SP SaaS, não especificações oficiais da Apple.

## Identidade

Referência: clareza e hierarquia das interfaces Apple. Marca, nome e símbolos de identificação continuam próprios do SP SaaS. Preservar o logo homologado de cada produto até a definição de um arquivo mestre de marca para toda a suíte. Não criar uma nova marca diferente a cada módulo nem usar a maçã como logo do SaaS.

## Regras para ambos os agentes

- Ler este documento e `tokens.css` antes de qualquer trabalho visual. AGENTS.md mantém as proteções operacionais; CLAUDE.md aponta para as mesmas fontes.
- Componentes novos usam as variáveis `--sp-*`; evitar cores, fontes, sombras e curvas de movimento independentes por tela.
- Uma mudança compartilhada deve atualizar a versão da especificação e a prévia, com lista dos apps afetados. Uma cópia do arquivo não é sincronização automática entre repositórios.
- Enquanto não existir um pacote central instalado em todos os apps, registrar em cada repositório a versão adotada e conferir diferenças. A extração para pacote compartilhado deve manter os mesmos nomes de variáveis.
- Preservar rotas, permissões, operações, nomes reconhecidos pela equipe, PDFs, exportações e dados. Redesenho não autoriza remover ou esconder funcionalidades.
- Publicação segue as regras locais de cada app; no Financeiro exige autorização do SHA completo. Não reutilizar autorização de uma versão anterior.

## Tipografia

Pilha nativa `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif`. Em dispositivos Apple usa a fonte do sistema quando suportada pelo navegador. Em outros sistemas a fonte substituta muda: não prometer a mesma fonte exata em todas as plataformas. Não empacotar nem carregar arquivos SF Pro/ SF Symbols como recursos web. Se a equipe exigir uma família idêntica em todos os sistemas, escolher uma fonte web licenciada para esse uso em decisão separada.

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

## Situação desta versão

- Especificação, tokens e prévia: preparados no Financeiro.
- Financeiro em produção: navegação e barra de ações publicadas no commit `6225c51de322f64f0b2f4db5efca6623fcfa3c0f`; demais áreas em migração.
- Fiscal, DP, Contábil, Legalização, Connect e demais apps: inventário e adoção pendentes.
- Arquivo mestre de logo da suíte e distribuição por pacote: pendentes de definição/inventário; nenhum logo novo foi inventado.

## Referências

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Fontes e licença da Apple](https://developer.apple.com/fonts/)
- [Orientações de uso de marcas Apple](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html)

## Piloto Financeiro — 12/10/2026

Aplicação inicial em `Layout`, `DashboardToolbar` e `ThemeToggle`: navegação neutra, cores semânticas, tipografia nativa, controles consistentes, foco visível e tema sincronizado entre desktop e celular. Demais telas seguem em migração gradual. Piloto publicado e conferido em produção em 12/10/2026 (commit `6225c51`).

Verificação local com dados fictícios: larguras de 390 e 1440 px, modos claro/escuro, fechamento do menu por Escape e callbacks de cadastro, recorrências, atualização, filtros, impressão, exportação e WhatsApp. A prévia isolada de revisão foi removida antes do commit. Nenhum dado financeiro foi alterado.

## Consulta financeira — segunda etapa

Abas de visão, painel de filtros, alertas e tabela adotam superfícies, bordas e raios compartilhados. Alertas passam a usar botões acessíveis pelo teclado; filtros e paginação recebem nomes acessíveis; tabela usa texto de 14 px e rolagem horizontal própria. As regras de seleção, datas, cálculos, permissões e emissão permanecem as existentes.

Validado localmente com dados fictícios em 390 e 1440 px, nos temas claro e escuro: acionamento de alerta por Enter, expansão dos detalhes, preenchimento de datas e pesquisa, paginação e ausência de transbordamento horizontal da página. A revisão não realizou operações financeiras. Esta etapa ainda depende da publicação por SHA autorizado.
