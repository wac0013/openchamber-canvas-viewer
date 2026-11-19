# Exemplos de canvas

Adapte o conteúdo; mantenha os ids estáveis entre atualizações.

## 1. Andamento de uma tarefa

Título: `Andamento: migração do módulo de pagamentos`

```html
<link data-kit>
<div class="ck-card" data-canvas-item="resumo">
  <h2>Resumo</h2>
  <p>3 de 5 etapas concluídas. <span class="ck-badge" data-tone="success">Sem falhas</span> Próxima: rodar a suíte de testes.</p>
  <div class="ck-bar" data-tone="success" style="--value:60%"><span></span></div>
</div>
<ol class="ck-steps">
  <li class="ck-step" data-tone="success" data-canvas-item="etapa-leitura">Ler o código atual</li>
  <li class="ck-step" data-tone="success" data-canvas-item="etapa-plano">Escrever o plano</li>
  <li class="ck-step" data-tone="success" data-canvas-item="etapa-refatoracao">Refatorar o serviço</li>
  <li class="ck-step" data-tone="info" data-canvas-item="etapa-testes">Rodar os testes</li>
  <li class="ck-step" data-canvas-item="etapa-pr">Abrir o <a href="https://github.com/wac0013/openchamber-canvas-viewer/pulls">PR</a></li>
</ol>
```

## 2. Comparação em tabela

Título: `Opções de cache`

```html
<link data-kit>
<table class="ck-table" data-canvas-item="comparacao">
  <tr><th>Opção</th><th>Custo</th><th>Risco</th></tr>
  <tr><td>Redis</td><td>médio</td><td><span class="ck-badge" data-tone="success">baixo</span></td></tr>
  <tr><td>Memória local</td><td>baixo</td><td><span class="ck-badge" data-tone="warning">médio</span></td></tr>
</table>
<div class="ck-card" data-canvas-item="recomendacao"><h3>Recomendação</h3><p>Redis: sobrevive a reinícios e é compartilhado entre instâncias.</p></div>
```

## 3. Fluxograma e filtro

Título: `Pipeline de deploy`

```html
<link data-kit>
<div class="ck-row"><span class="ck-chip" data-filter="fase:build">build</span><span class="ck-chip" data-filter="fase:deploy">deploy</span></div>
<ol class="ck-steps">
  <li class="ck-step" data-tone="success" data-canvas-item="build" data-tags="fase:build">Compilar</li>
  <li class="ck-step" data-tone="success" data-canvas-item="testes" data-tags="fase:build">Testar</li>
  <li class="ck-step" data-tone="warning" data-canvas-item="deploy" data-tags="fase:deploy">Publicar na stage</li>
</ol>
```
