# AGENTS.md — openchamber-canvas-viewer

Extensão do OpenChamber **Canvas Viewer**: painel lateral com um canvas por sessão, atualizado pelo agente. Mesmo padrão da extensão de referência `openchamber-omniroute-quota-monitoring` (repo irmão).

## Regra de ouro: TypeScript em todo o código-fonte

- Todo código-fonte é TypeScript: `src/**/*.ts`, `service/**/*.ts`, `tests/**/*.test.ts`, `build.ts`.
- Os `.js` do repositório são **artefatos de build**, nunca editados à mão:

| Arquivo | O que é | Como nasce |
| --- | --- | --- |
| `panel/main.js` | bundle IIFE do painel (iframe sandboxado) | `esbuild` a partir de `src/main.ts` |
| `service/main.js` | bundle ESM do serviço (Node no host) | `esbuild` a partir de `service/main.ts` |

- Mudou qualquer `.ts` → `npm run build` antes de testar no OpenChamber. O CI confere que os bundles commitados batem com a fonte.

## Comandos

```bash
npm run build        # esbuild → panel/main.js + service/main.js
npm run typecheck    # tsc --noEmit
npm test             # node --test "tests/**/*.test.ts"
```

- Node 24+. O glob de testes precisa das aspas.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`.
  - import sempre com extensão `.ts`; tipos com `import type`; sem `enum` nem parameter properties.

## Regras de módulo

- Regra de negócio no módulo, não na casca: `src/main.ts` e `service/main.ts` só costuram.
- O painel roda em iframe sandboxado, sem rede nem disco. Rede, disco e segredos só no serviço (`host.serviceRequest`).
- `src/shared/contract.ts` é a fonte da verdade do contrato painel↔serviço e do payload de canvas. Mudou o formato → subir `SERVICE_VERSION`, a versão no `package.json` e o changelog do `README.md` (semver).
- Conteúdo de canvas é gerado por agente: **entrada não confiável** em todo ponto de entrada. Nunca remover validação/sanitização nos limites de confiança.
- Segredos nunca no repositório.

## Convenções

- Commits: Conventional Commits; branches `feat|fix|chore|docs|test|refactor/<TAREFA>-<descricao>`; base `main`.
- Nada do fluxo interno (agentes, `.ia/`, handoffs) em código, commit ou PR.
