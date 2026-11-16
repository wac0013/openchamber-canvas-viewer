# Partes incorporadas (`embeds`)

Use só quando o HTML normal do canvas não resolver (gráfico de linhas, SVG, diagrama com ramificações, interação). O resto do canvas continua nativo.

Envie `embeds: [{ id, html }]` em `canvas_publish` e posicione cada parte com `<div data-embed="id" data-height="320">texto equivalente</div>`.

- O `html` do embed é **completo**: aceita `<style>`, `<script>` e `<svg>`. Roda num iframe isolado, **sem rede e sem acesso ao painel ou ao OpenChamber**; nada externo carrega (use SVG, CSS e dados embutidos; imagens só `data:`).
- Até 8 partes, 100 000 caracteres cada. O texto dentro do `div data-embed` é a **alternativa em texto**: aparece se a parte falhar e é o que vai para o contexto do chat. Escreva-a sempre.
- Cores do tema chegam como variáveis CSS: `var(--oc-fg)`, `--oc-bg`, `--oc-border`, `--oc-primary`, `--oc-success`, `--oc-warning`, `--oc-error`, `--oc-info`, `--oc-muted` e `--chart-1` a `--chart-6`. Não fixe cores, para funcionar nos temas claro e escuro.
- A altura acompanha o conteúdo (até 1 200 px). Se usar `vh` ou `height:100%`, fixe `data-height` (60 a 1 200).
- Links `<a href>` dentro do embed abrem fora. Texto dentro do embed **não** é selecionável para comentar.

Exemplo completo (gráfico de linhas em SVG): ver o exemplo 5 em [examples.md](examples.md).
