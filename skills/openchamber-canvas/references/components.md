# Componentes do canvas

Trechos prontos. Todos usam as cores do tema (claro e escuro) e passam pelo sanitizador sem aviso. Combine à vontade; `data-tone` aceita `neutral`, `info`, `success`, `warning` e `error`.

## Métricas (`grid` + `stat`)

```html
<div class="grid">
  <div class="stat"><div class="stat-value">74</div><div class="stat-label">tarefas</div></div>
  <div class="stat" data-tone="success"><div class="stat-value">14</div><div class="stat-label">prontas</div></div>
  <div class="stat" data-tone="error"><div class="stat-value">3</div><div class="stat-label">bloqueadas</div></div>
</div>
```

## Selos, chips e pontos

`badge` é para estado (texto curto); `chip` é mono, para identificadores (`api#1289`, `v1.2`); `dot` é uma bolinha de legenda.

```html
<p>
  <span class="badge" data-tone="success">Aprovado</span>
  <span class="badge" data-tone="warning">Conflitante</span>
  <span class="badge" data-tone="error">Highest</span>
  <span class="badge">Pendente</span>
  <a class="chip" data-tone="info" href="https://github.com/org/repo/pull/12">repo#12</a>
  <span class="dot" data-tone="success"></span> ok
</p>
```

## Aviso (`callout`)

```html
<div class="callout" data-tone="warning">
  <div class="callout-title">Atenção</div>
  <p>15 tarefas têm mais PRs do que os localizados.</p>
</div>
```

## Linhas com informação à direita (`rows` + `split` + `side`)

`split` vira uma coluna sozinho em painéis estreitos. Marque cada linha com `data-canvas-item` (e `data-group`, se quiser o seletor de grupo).

```html
<div class="rows">
  <div class="split" data-canvas-item="linha-a" data-group="Time A">
    <div><a href="https://example.com/browse/ABC-1"><strong>ABC-1</strong></a> Título da tarefa<div class="small muted">Responsável · <span class="badge" data-tone="warning">High</span></div></div>
    <div class="side"><a class="chip" data-tone="success" href="https://github.com/org/repo/pull/1">repo#1</a></div>
  </div>
  <div class="split" data-canvas-item="linha-b" data-group="Time B">
    <div><a href="https://example.com/browse/ABC-2"><strong>ABC-2</strong></a> Outra tarefa</div>
    <div class="side"><a class="chip" data-tone="error" href="https://github.com/org/repo/pull/2">repo#2</a></div>
  </div>
</div>
```

## Gráfico de barras (`chart`)

`data-value` é a porcentagem da largura (0 a 100): normalize pelo maior valor.

```html
<div class="chart">
  <div class="chart-row"><span class="chart-label">Pronto</span><div class="bar" data-tone="success" data-value="100"></div><span class="chart-value">14</span></div>
  <div class="chart-row"><span class="chart-label">Ajustes</span><div class="bar" data-tone="warning" data-value="71"></div><span class="chart-value">10</span></div>
  <div class="chart-row"><span class="chart-label">Bloqueado</span><div class="bar" data-tone="error" data-value="21"></div><span class="chart-value">3</span></div>
</div>
```

## Proporção de um todo (`stack`)

Em `seg`, `data-value` é o **peso** da fatia (as larguras são proporcionais à soma).

```html
<div class="stack">
  <div class="seg" data-tone="success" data-value="14"></div>
  <div class="seg" data-tone="warning" data-value="10"></div>
  <div class="seg" data-tone="error" data-value="3"></div>
</div>
<p class="small muted"><span class="dot" data-tone="success"></span> pronto · <span class="dot" data-tone="warning"></span> ajustes · <span class="dot" data-tone="error"></span> bloqueado</p>
```

## Colunas (`columns`)

`data-value` é a altura em porcentagem (0 a 100). Poucas colunas (até 7) no painel estreito.

```html
<div class="columns">
  <div class="col"><div class="col-track"><div class="col-bar" data-tone="info" data-value="40"></div></div><div class="col-label">seg</div></div>
  <div class="col"><div class="col-track"><div class="col-bar" data-tone="info" data-value="75"></div></div><div class="col-label">ter</div></div>
  <div class="col"><div class="col-track"><div class="col-bar" data-tone="info" data-value="100"></div></div><div class="col-label">qua</div></div>
  <div class="col"><div class="col-track"><div class="col-bar" data-tone="info" data-value="55"></div></div><div class="col-label">qui</div></div>
</div>
```

## Fluxograma horizontal (`flow`)

`data-tone` no `step` marca o estado: `success` feito, `info` atual, `error` bloqueado, sem tom pendente. As setas são automáticas.

```html
<div class="flow">
  <div class="step" data-tone="success"><div class="step-title">Planejar</div></div>
  <div class="step" data-tone="info"><div class="step-title">Implementar</div></div>
  <div class="step"><div class="step-title">Revisar</div></div>
  <div class="step"><div class="step-title">Publicar</div></div>
</div>
```

## Fluxograma vertical com ramificação (`flow-col`)

Um `flow` dentro de `flow-col` mostra etapas em paralelo.

```html
<div class="flow-col">
  <div class="step" data-tone="success"><div class="step-title">Receber pedido</div></div>
  <div class="step" data-tone="info"><div class="step-title">Validar</div><div class="small muted">Decide entre as rotas abaixo</div></div>
  <div class="flow">
    <div class="step"><div class="step-title">Rota A</div><div class="small muted">Pedido simples</div></div>
    <div class="step"><div class="step-title">Rota B</div><div class="small muted">Pedido com revisão</div></div>
  </div>
</div>
```

## Parte colapsável

```html
<details>
  <summary>Detalhes (3)</summary>
  <ul>
    <li>Primeiro</li>
    <li>Segundo</li>
    <li>Terceiro</li>
  </ul>
</details>
```

## Parte incorporada (`data-embed`)

Para SVG, gráfico de linhas, diagramas complexos ou interação. O conteúdo do `div` é a alternativa em texto (vai para o contexto do chat). O HTML da parte vai em `embeds`, fora do `html`:

```html
<div data-embed="grafico-latencia" data-height="220">Latência p95 por hora: 120, 130, 180, 150 ms.</div>
```

```embed
<style>
  .row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .bar { height: 10px; border-radius: 999px; background: var(--chart-1); }
  span { color: var(--oc-muted); font-size: 11px; }
</style>
<div class="row"><span>10h</span><div class="bar" style="width:60%"></div></div>
<div class="row"><span>11h</span><div class="bar" style="width:65%"></div></div>
<div class="row"><span>12h</span><div class="bar" style="width:90%"></div></div>
<div class="row"><span>13h</span><div class="bar" style="width:75%"></div></div>
```
