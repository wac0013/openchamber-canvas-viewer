# AGENTS.md — openchamber-canvas-viewer

Extensão do OpenChamber **Canvas Viewer**: painel lateral com um canvas HTML livre por sessão raiz, atualizado pelo agente, com hot reload por arquivo e um servidor único (porta 57130) compartilhado por todas as instâncias do OpenChamber. Mesmo padrão da extensão de referência `openchamber-omniroute-quota-monitoring` (repo irmão).

## Regra de ouro: TypeScript em todo o código-fonte

- Todo código-fonte é TypeScript: `src/**/*.ts`, `server/**/*.ts`, `service/**/*.ts`, `tests/**/*.test.ts`, `build.ts`.
- Os `.js` do repositório são **artefatos de build**, nunca editados à mão:

| Arquivo | O que é | Como nasce |
| --- | --- | --- |
| `panel/main.js` | bundle IIFE do painel (iframe sandboxado) | `esbuild` a partir de `src/main.ts` |
| `service/main.js` | bundle ESM do serviço (Node no host) | `esbuild` a partir de `service/main.ts` |
| `server/main.js` | bundle ESM do servidor único (processo próprio, porta 57130) | `esbuild` a partir de `server/main.ts` |
| `plugin/index.js` | plugin do OpenCode (carregado com `import()` puro, sem node_modules) | `esbuild` a partir de `plugin/index.ts` |

- Mudou qualquer `.ts` → `npm run build` antes de testar no OpenChamber. O CI confere que os bundles commitados batem com a fonte.

## Comandos

```bash
npm run build        # esbuild → panel/main.js + service/main.js + server/main.js + plugin/index.js
npm run typecheck    # tsc --noEmit
npm test             # node --test "tests/**/*.test.ts"
```

- Node 24+. O glob de testes precisa das aspas.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`.
  - import sempre com extensão `.ts`; tipos com `import type`; sem `enum` nem parameter properties.

## Estrutura

```
src/shared/    contract.ts (contrato, limites, versões), paths.ts, token.ts, canvas-files.ts (escrita atômica, sessão raiz)
src/canvas/    frame-doc.ts (srcdoc do iframe, CSP, readCanvasMessage), kit.ts (KIT_CSS, classes ck-*), links.ts (cleanHref),
               view-state.ts, panel-state.ts, context.ts (texto + chip: canvas, elemento, trecho), actions.ts (adicionar ao contexto,
               fail-closed de sessão), toolbar-position.ts, update-request.ts (botão Atualizar, lado do painel)
src/runtime/   canvas-runtime.ts — função serializada com toString() e injetada no iframe (filtros, remoção, seleção, links, rolagem)
src/main.ts    painel (casca)
server/        main.ts (casca HTTP), routes.ts, page.ts (casca do navegador), watch.ts (fs.watch + SSE)
service/       main.ts (casca HTTP), ensure-server.ts (sobe/troca o servidor), bridge.ts (SSE → host.emit), update-request.ts
plugin/        index.ts — ferramentas canvas_publish e canvas_edit no OpenCode (gravam o alias subagente → raiz)
skills/        <nome>/SKILL.md instaláveis por `npx skills add` (name = pasta); references/ junto
tests/         node:test; service.e2e.test.ts sobe o servidor e 3 serviços reais
```

Fluxo: agente → `canvas_publish`/`canvas_edit` (ou Write/Edit no arquivo) → `sessions/<raiz>/index.html` → servidor (`fs.watch`, SSE) → serviços → painel (iframe) e navegador (`/s/<id>`).

## Regras de módulo

- Regra de negócio no módulo, não na casca: `src/main.ts` e `service/main.ts` só costuram.
- O painel roda em iframe sandboxado, sem rede nem disco. Rede, disco e segredos só no serviço (`host.serviceRequest`).
- `src/shared/contract.ts` é a fonte da verdade do contrato painel↔serviço e do payload de canvas. Mudou o formato → subir `SERVICE_VERSION`, a versão no `package.json` e o changelog do `README.md` (semver).
- Conteúdo de canvas é gerado por agente e **roda de verdade** (HTML/CSS/JS livres): a fronteira é o isolamento, não a sanitização. Entrada não confiável em todo ponto de entrada: ids de sessão validados antes de virar caminho, limites de tamanho, token no servidor.
- Painel e `/frame`: nunca `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval` no documento do painel e da casca (há teste); o HTML do agente só entra no `srcdoc` do iframe montado por `buildFrameDocument` (CSP → tema/kit → runtime → HTML).
- Iframe com `sandbox` exatamente `allow-scripts` (`FRAME_SANDBOX`; nunca `allow-same-origin`, `allow-popups`, `allow-forms` nem `allow-top-navigation`, há teste) e CSP sem rede (`connect-src`, `frame-src`, `form-action`, `base-uri` = `'none'`). Mensagens do iframe só passam por `readCanvasMessage`; link só com gesto do usuário, via `host.openUrl`, validado por um só `cleanHref` (`links.ts`, http/https sem credenciais).
- Kit CSS opt-in: `<link data-kit>` no HTML do agente vira `KIT_CSS` inline; classes `ck-*` ficam só em `kit.ts`.
- Servidor: um por máquina, token em `canvasHome/token` (0600), `/health` é a única rota sem token; `DELETE` por sessão nunca apaga a raiz a partir de um subagente. Mudou rota/contrato → subir `SERVICE_VERSION`.
- O plugin do OpenCode não pode importar pacotes externos: o build embute tudo (só `node:*` fica de fora).
- Ações que escrevem no chat (`host.attach`) passam por `src/canvas/actions.ts`, que confere a sessão em foco imediatamente antes de cada chamada. Nunca chamar o host direto da casca do painel.
- Skills: `name` igual à pasta, `description` sem `: ` nem ` #` (YAML sem aspas); as classes `ck-*` citadas na skill existem em `KIT_CSS`; os blocos `html` de `references/` montam documento válido por `buildFrameDocument`; o formato do chip na skill vem de `context.ts` e o marcador do Atualizar de `contract.ts` (há testes).
- Mensagens que iniciam um turno do agente (botão Atualizar) saem pelo **serviço** com `sessions.send(sessionId, …)` e a sessão explícita, após `sessions.status`; nunca `host.prompt({ send: true })` do painel (o host envia para a sessão "atual" dele, que pode mudar no instante do clique). O texto é fixo (`UPDATE_REQUEST_TEXT`) e nunca leva conteúdo de canvas.
- Segredos nunca no repositório.

## Convenções

- Releases: automáticos (`.github/workflows/release.yml`) quando a versão do `package.json` muda na `main`; não crie tag nem release à mão. Subiu a versão → escreva a seção `### <versão>` no changelog do `README.md` (vira o texto do release; sem ela o workflow falha).
- Commits: Conventional Commits; branches `feat|fix|chore|docs|test|refactor/<TAREFA>-<descricao>`; base `main`.
- Nada do fluxo interno (agentes, `.ia/`, handoffs) em código, commit ou PR.
