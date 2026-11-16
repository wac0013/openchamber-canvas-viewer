# AGENTS.md — openchamber-canvas-viewer

Extensão do OpenChamber **Canvas Viewer**: painel lateral com um canvas por sessão, atualizado pelo agente. Mesmo padrão da extensão de referência `openchamber-omniroute-quota-monitoring` (repo irmão).

## Regra de ouro: TypeScript em todo o código-fonte

- Todo código-fonte é TypeScript: `src/**/*.ts`, `service/**/*.ts`, `tests/**/*.test.ts`, `build.ts`.
- Os `.js` do repositório são **artefatos de build**, nunca editados à mão:

| Arquivo | O que é | Como nasce |
| --- | --- | --- |
| `panel/main.js` | bundle IIFE do painel (iframe sandboxado) | `esbuild` a partir de `src/main.ts` |
| `service/main.js` | bundle ESM do serviço (Node no host) | `esbuild` a partir de `service/main.ts` |
| `plugin/index.js` | plugin do OpenCode (carregado com `import()` puro, sem node_modules) | `esbuild` a partir de `plugin/index.ts` |

- Mudou qualquer `.ts` → `npm run build` antes de testar no OpenChamber. O CI confere que os bundles commitados batem com a fonte.

## Comandos

```bash
npm run build        # esbuild → panel/main.js + service/main.js + plugin/index.js
npm run typecheck    # tsc --noEmit
npm test             # node --test "tests/**/*.test.ts"
```

- Node 24+. O glob de testes precisa das aspas.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`.
  - import sempre com extensão `.ts`; tipos com `import type`; sem `enum` nem parameter properties.

## Estrutura

```
src/shared/    contrato (payload, limites, versões)
src/canvas/    sanitize.ts (leitor estrito → árvore), snapshot.ts, panel-state.ts, view.ts,
               context.ts (texto + chip: canvas, elemento, trecho selecionado), actions.ts (adicionar ao contexto, fail-closed de sessão),
               toolbar-position.ts (barra flutuante da seleção, sem DOM)
src/main.ts    painel (casca)
service/       main.ts (casca HTTP), inbox.ts (caixa de entrada), store.ts (persistência por sessão), paths.ts
plugin/        index.ts — ferramenta canvas_publish no OpenCode (conhece context.sessionID)
skills/        <nome>/SKILL.md instaláveis por `npx skills add` (name = pasta); references/ junto
tests/         node:test; service.e2e.test.ts sobe o serviço real
```

Fluxo: agente → `canvas_publish` (plugin) → arquivo na caixa de entrada → serviço (revalida, guarda 1 por sessão) → painel (revalida a árvore, só `createElement`/`textContent`).

## Regras de módulo

- Regra de negócio no módulo, não na casca: `src/main.ts` e `service/main.ts` só costuram.
- O painel roda em iframe sandboxado, sem rede nem disco. Rede, disco e segredos só no serviço (`host.serviceRequest`).
- `src/shared/contract.ts` é a fonte da verdade do contrato painel↔serviço e do payload de canvas. Mudou o formato → subir `SERVICE_VERSION`, a versão no `package.json` e o changelog do `README.md` (semver).
- Conteúdo de canvas é gerado por agente: **entrada não confiável** em todo ponto de entrada. Nunca remover validação/sanitização nos limites de confiança.
- Painel: nunca `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval` (há teste que falha se aparecer).
- Links: um só validador (`cleanHref` em `sanitize.ts`, http/https sem credenciais). No DOM o destino vai em `data-href`, nunca em `href`; só o painel abre (`host.openUrl`).
- Partes incorporadas (`embeds`): o único HTML cru do projeto, sempre em iframe com `sandbox` exatamente `allow-scripts` (`EMBED_SANDBOX`; nunca `allow-same-origin`, `allow-popups`, `allow-forms` nem `allow-top-navigation`, há teste) e CSP de `embed-frame.ts`. Mensagens do iframe só passam por `readEmbedMessage`; link só com gesto do usuário.
- O plugin do OpenCode não pode importar pacotes externos: o build embute tudo (só `node:*` fica de fora).
- Ações que escrevem no chat (`host.attach`) passam por `src/canvas/actions.ts`, que confere a sessão em foco imediatamente antes de cada chamada. Nunca chamar o host direto da casca do painel.
- Skills: `name` igual à pasta, `description` sem `: ` nem ` #` (YAML sem aspas); as tags listadas na skill são exatamente as do sanitizador; as classes da skill e da descrição da ferramenta são exatamente as estilizadas no painel (o prefixo `oc-` é só alias, tratado em `view.ts`); os trechos de `references/` passam pelo sanitizador real; o formato do chip na skill vem de `context.ts` (há testes). Exemplos da skill passam pelo sanitizador real.
- Segredos nunca no repositório.

## Convenções

- Commits: Conventional Commits; branches `feat|fix|chore|docs|test|refactor/<TAREFA>-<descricao>`; base `main`.
- Nada do fluxo interno (agentes, `.ia/`, handoffs) em código, commit ou PR.
