# Kit de componentes

Inclua `<link data-kit>` no HTML do canvas. Cada trecho abaixo é um canvas válido (kit + tema).

## Card, grade e métrica

```html
<link data-kit>
<div class="ck-grid">
  <div class="ck-card" data-canvas-item="m-testes"><div class="ck-stat"><span class="ck-stat-value">128</span><span class="ck-stat-label">testes passando</span></div></div>
  <div class="ck-card" data-canvas-item="m-falhas"><div class="ck-stat"><span class="ck-stat-value">0</span><span class="ck-stat-label">falhas</span></div></div>
</div>
```

## Etapas (fluxo)

```html
<link data-kit>
<ol class="ck-steps">
  <li class="ck-step" data-tone="success">Ler o código</li>
  <li class="ck-step" data-tone="info">Rodar os testes</li>
  <li class="ck-step">Abrir o PR</li>
</ol>
```

## Tabela e selos

```html
<link data-kit>
<table class="ck-table">
  <tr><th>Item</th><th>Estado</th></tr>
  <tr><td>Servidor</td><td><span class="ck-badge" data-tone="success">ok</span></td></tr>
  <tr><td>Painel</td><td><span class="ck-badge" data-tone="warning">em revisão</span></td></tr>
</table>
```

## Barras e linha do tempo

```html
<link data-kit>
<div class="ck-bar" data-tone="success" style="--value:70%"><span></span></div>
<div class="ck-chart-bars">
  <div><span>Back</span><div class="ck-bar"><span style="width:80%"></span></div><b>80%</b></div>
  <div><span>Front</span><div class="ck-bar"><span style="width:45%"></span></div><b>45%</b></div>
</div>
<ul class="ck-timeline"><li>09:00 Início</li><li>09:40 Primeira entrega</li></ul>
```

## Filtro por clique

```html
<link data-kit>
<div class="ck-row"><span class="ck-chip" data-filter="status:aberto">aberto</span><span class="ck-chip" data-filter="status:feito">feito</span></div>
<div class="ck-card" data-canvas-item="t-1" data-tags="status:aberto">Revisar o PR</div>
<div class="ck-card" data-canvas-item="t-2" data-tags="status:feito">Escrever o plano</div>
```

## SVG (linhas, mapas, diagramas)

```html
<svg viewBox="0 0 200 60" width="100%" role="img" aria-label="Evolução">
  <polyline fill="none" stroke="var(--oc-primary)" stroke-width="2" points="0,50 40,35 80,40 120,15 160,20 200,5"/>
</svg>
```
