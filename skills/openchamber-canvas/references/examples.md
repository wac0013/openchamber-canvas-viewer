# Exemplos de canvas

Os três exemplos usam só HTML aceito, classes prontas (temas claro e escuro) e `data-canvas-item` nos blocos principais. Adapte o conteúdo; mantenha os ids estáveis entre atualizações.

## 1. Acompanhamento das ações do agente

Título: `Andamento: migração do módulo de pagamentos`

```html
<section data-canvas-item="resumo" class="card">
  <h2>Resumo</h2>
  <p>3 de 5 etapas concluídas. <span class="ok">Sem falhas</span>. Próxima: rodar a suíte de testes.</p>
</section>
<section>
  <h2>Etapas</h2>
  <ul>
    <li data-canvas-item="etapa-leitura"><span class="ok">Concluída</span> · Ler o código atual</li>
    <li data-canvas-item="etapa-plano"><span class="ok">Concluída</span> · Escrever o plano</li>
    <li data-canvas-item="etapa-refatoracao"><span class="ok">Concluída</span> · Refatorar o serviço</li>
    <li data-canvas-item="etapa-testes"><span class="info">Em andamento</span> · Rodar os testes</li>
    <li data-canvas-item="etapa-pr"><span class="muted">Pendente</span> · Abrir o PR</li>
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
<section data-canvas-item="recomendacao" class="card">
  <h3>Recomendação</h3>
  <p>Começar com <strong>memória</strong> e migrar para Redis se houver mais de uma instância.</p>
</section>
```

## 3. Fluxo de etapas

Título: `Fluxo: publicação de uma versão`

```html
<ol>
  <li data-canvas-item="fluxo-build" class="card">
    <h3>1. Build</h3>
    <p class="small muted">Gera os pacotes e confere que os bundles batem com a fonte.</p>
  </li>
  <li data-canvas-item="fluxo-testes" class="card">
    <h3>2. Testes</h3>
    <p class="small muted">Unitários e ponta a ponta. <span class="warn">Bloqueia</span> se algum falhar.</p>
  </li>
  <li data-canvas-item="fluxo-release" class="card">
    <h3>3. Release</h3>
    <details>
      <summary>Detalhes</summary>
      <p class="small">Sobe a versão, atualiza o changelog e cria a tag.</p>
    </details>
  </li>
</ol>
```
