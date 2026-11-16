# Exemplos de canvas

Os cinco exemplos usam só HTML aceito, classes prontas (temas claro e escuro) e `data-canvas-item` nos blocos principais. Adapte o conteúdo; mantenha os ids estáveis entre atualizações. Trechos menores por componente estão em [components.md](components.md).

## 1. Acompanhamento das ações do agente

Título: `Andamento: migração do módulo de pagamentos`

```html
<section data-canvas-item="resumo" class="card">
  <h2>Resumo</h2>
  <p>3 de 5 etapas concluídas. <span class="badge" data-tone="success">Sem falhas</span> Próxima: rodar a suíte de testes.</p>
  <div class="stack" title="3 concluídas, 1 em andamento, 1 pendente">
    <div class="seg" data-tone="success" data-value="3"></div>
    <div class="seg" data-tone="info" data-value="1"></div>
    <div class="seg" data-value="1"></div>
  </div>
</section>
<section>
  <h2>Etapas</h2>
  <ul>
    <li data-canvas-item="etapa-leitura"><span class="badge" data-tone="success">Concluída</span> Ler o código atual</li>
    <li data-canvas-item="etapa-plano"><span class="badge" data-tone="success">Concluída</span> Escrever o plano</li>
    <li data-canvas-item="etapa-refatoracao"><span class="badge" data-tone="success">Concluída</span> Refatorar o serviço</li>
    <li data-canvas-item="etapa-testes"><span class="badge" data-tone="info">Em andamento</span> Rodar os testes</li>
    <li data-canvas-item="etapa-pr"><span class="badge">Pendente</span> Abrir o <a href="https://github.com/wac0013/openchamber-canvas-viewer/pulls">PR</a></li>
  </ul>
</section>
<section data-canvas-item="decisoes" class="card">
  <h3>Decisões tomadas</h3>
  <p class="small muted">Mantive a API pública e movi a validação para o serviço.</p>
</section>
```

## 2. Comparação em tabela

Título: `Comparação: opções de cache`

```html
<p class="muted small">Três opções avaliadas para o catálogo de produtos.</p>
<div class="table">
  <table>
    <caption>Resumo das opções</caption>
    <thead>
      <tr><th>Opção</th><th>Latência</th><th>Custo</th></tr>
    </thead>
    <tbody>
      <tr data-canvas-item="opcao-memoria"><td><strong>Memória</strong></td><td class="ok">~1 ms</td><td>Baixo</td></tr>
      <tr data-canvas-item="opcao-redis"><td><strong>Redis</strong></td><td class="ok">~3 ms</td><td class="warn">Médio</td></tr>
      <tr data-canvas-item="opcao-cdn"><td><strong>CDN</strong></td><td class="warn">~20 ms</td><td class="err">Alto</td></tr>
    </tbody>
  </table>
</div>
<div class="chart">
  <div class="chart-row"><span class="chart-label">Memória</span><div class="bar" data-tone="success" data-value="5"></div><span class="chart-value">1 ms</span></div>
  <div class="chart-row"><span class="chart-label">Redis</span><div class="bar" data-tone="success" data-value="15"></div><span class="chart-value">3 ms</span></div>
  <div class="chart-row"><span class="chart-label">CDN</span><div class="bar" data-tone="warning" data-value="100"></div><span class="chart-value">20 ms</span></div>
</div>
<section data-canvas-item="recomendacao" class="card">
  <h3>Recomendação</h3>
  <p>Começar com <strong>memória</strong> e migrar para Redis se houver mais de uma instância.</p>
</section>
```

## 3. Fluxograma de etapas

Título: `Fluxo: publicação de uma versão`

```html
<div class="flow-col">
  <div class="step" data-tone="success" data-canvas-item="fluxo-build">
    <div class="step-title">1. Build</div>
    <p class="small muted">Gera os pacotes e confere que os bundles batem com a fonte.</p>
  </div>
  <div class="step" data-tone="info" data-canvas-item="fluxo-testes">
    <div class="step-title">2. Testes</div>
    <p class="small muted">Unitários e ponta a ponta. <span class="badge" data-tone="warning">Bloqueia</span> se algum falhar.</p>
  </div>
  <div class="flow">
    <div class="step" data-canvas-item="fluxo-tag"><div class="step-title">3a. Tag</div><span class="small muted">Cria a tag da versão</span></div>
    <div class="step" data-canvas-item="fluxo-changelog"><div class="step-title">3b. Changelog</div><span class="small muted">Atualiza o histórico</span></div>
  </div>
</div>
<details>
  <summary>Legenda</summary>
  <p class="small"><span class="dot" data-tone="success"></span> concluída · <span class="dot" data-tone="info"></span> em andamento · <span class="dot"></span> pendente</p>
</details>
```

## 4. Painel com métricas, links, selos e filtro

Título: `Revisão da sprint`

```html
<div class="grid">
  <div class="stat"><div class="stat-value">6</div><div class="stat-label">tarefas</div></div>
  <div class="stat" data-tone="success"><div class="stat-value">2</div><div class="stat-label">prontas</div></div>
  <div class="stat" data-tone="warning"><div class="stat-value">3</div><div class="stat-label">com ajustes</div></div>
  <div class="stat" data-tone="error"><div class="stat-value">1</div><div class="stat-label">bloqueada</div></div>
</div>
<div class="callout" data-tone="warning">
  <div class="callout-title">Avisos de dados</div>
  <p class="small">PRs localizados pela chave da tarefa no título ou na branch.</p>
</div>
<section>
  <h3>Precisa de ajustes <span class="badge">3</span></h3>
  <div class="rows">
    <div class="split" data-canvas-item="tarefa-1154" data-group="Heitor">
      <div><a href="https://example.com/browse/PROJ-1154"><strong>PROJ-1154</strong></a> Bilhetes como prêmios instantâneos<div class="small muted">Heitor · <span class="badge" data-tone="error">Highest</span></div></div>
      <div class="side">
        <a class="chip" data-tone="warning" href="https://github.com/org/api/pull/1289">api#1289</a>
        <a class="chip" data-tone="warning" href="https://github.com/org/web/pull/827">web#827</a>
      </div>
    </div>
    <div class="split" data-canvas-item="tarefa-2408" data-group="Victor">
      <div><a href="https://example.com/browse/PROJ-2408"><strong>PROJ-2408</strong></a> Remodelar o resumo de compra<div class="small muted">Victor · <span class="badge" data-tone="warning">High</span></div></div>
      <div class="side">
        <a class="chip" data-tone="error" href="https://github.com/org/web/pull/676">web#676</a>
        <a class="chip" data-tone="success" href="https://github.com/org/api/pull/898">api#898</a>
      </div>
    </div>
    <div class="split" data-canvas-item="tarefa-3314" data-group="Leopoldo">
      <div><a href="https://example.com/browse/PROJ-3314"><strong>PROJ-3314</strong></a> Filtros de exclusão de logs<div class="small muted">Leopoldo · <span class="badge">Medium</span></div></div>
      <div class="side"><a class="chip" data-tone="warning" href="https://github.com/org/web/pull/807">web#807</a></div>
    </div>
  </div>
</section>
```

## 5. Parte incorporada: gráfico de linhas em SVG

Título: `Falhas de build por dia`

```html
<section data-canvas-item="tendencia" class="card">
  <h3>Falhas por dia</h3>
  <div data-embed="falhas" data-height="200">Falhas por dia nos últimos 7 dias: 5, 4, 6, 3, 2, 2, 1. Tendência de queda.</div>
</section>
<section data-canvas-item="leitura" class="card">
  <p class="small muted">A linha usa as cores do tema (variáveis CSS), então vale nos temas claro e escuro.</p>
</section>
```

O `embeds` correspondente (HTML completo, enviado em `embeds: [{ id: "falhas", html: … }]`):

```embed
<style>
  svg { width: 100%; height: 180px; display: block; }
  .grid { stroke: var(--oc-border); stroke-width: 1; }
  .line { fill: none; stroke: var(--chart-4); stroke-width: 2.5; stroke-linejoin: round; }
  .dot { fill: var(--chart-4); }
  text { fill: var(--oc-muted); font: 11px var(--oc-font); }
</style>
<svg viewBox="0 0 320 180" role="img" aria-label="Falhas de build por dia, em queda de 5 para 1">
  <line class="grid" x1="30" y1="150" x2="310" y2="150" />
  <line class="grid" x1="30" y1="90" x2="310" y2="90" />
  <line class="grid" x1="30" y1="30" x2="310" y2="30" />
  <text x="4" y="154">0</text><text x="4" y="94">3</text><text x="4" y="34">6</text>
  <polyline class="line" points="40,60 90,75 140,30 190,90 240,120 290,120" />
  <circle class="dot" cx="40" cy="60" r="3.5" /><circle class="dot" cx="140" cy="30" r="3.5" /><circle class="dot" cx="290" cy="120" r="3.5" />
  <text x="30" y="170">seg</text><text x="120" y="170">qua</text><text x="270" y="170">sex</text>
</svg>
```
