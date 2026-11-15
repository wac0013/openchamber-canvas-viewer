# Canvas Viewer for OpenChamber

[![CI](https://github.com/wac0013/openchamber-canvas-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/wac0013/openchamber-canvas-viewer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Painel lateral do [OpenChamber](https://github.com/openchamber/openchamber) que mostra um **Canvas por sessão de chat**, criado e atualizado pelo próprio agente em tempo real. O usuário acompanha a visualização sem pedi-la de novo nem procurá-la no histórico.

## Como funciona

```
agente ──canvas_publish(html)──▶ plugin (no OpenCode) ──arquivo──▶ serviço (no host) ──HTTP──▶ painel
                                  sabe a sessão exata              sanitiza, guarda        árvore sanitizada
                                                                   1 canvas por sessão     (sem innerHTML)
```

- A extensão traz um **plugin do OpenCode** que registra a ferramenta `canvas_publish`. O OpenChamber o carrega sozinho enquanto a extensão está ativa e aprovada.
- O plugin conhece a sessão que chamou (`context.sessionID`), então o canvas nunca vai para a sessão errada.
- O **serviço** da extensão valida de novo, guarda só a última versão por sessão e avisa o painel. O painel mostra o canvas da sessão em foco e atualiza em até ~1,5 s.

## Instalação

1. Em *Settings → Extensions → Add*, informe o diretório (ou o repositório) desta extensão e aprove as permissões. O pedido inclui *serviço local* e *plugin do OpenCode* (código que roda dentro do OpenCode com os seus direitos).
2. Abra o painel **Canvas** na barra lateral.
3. Peça ao agente algo como: "mostre um resumo do status no canvas". Ele usará `canvas_publish`.

Requer OpenChamber ≥ 2.6.1.

## O que o agente pode publicar

`canvas_publish({ html, title? })` — cada chamada **substitui** o canvas da conversa (envie o HTML completo).

| Permitido | |
| --- | --- |
| Tags | `div span p h1–h6 ul ol li dl dt dd table caption thead tbody tfoot tr th td blockquote pre code strong b em i u s mark small sub sup kbd br hr section article header footer figure figcaption details summary` |
| Atributos | `class` (nomes `[a-z][a-z0-9-]`), `title`, `colspan`, `rowspan`, `data-canvas-item="<id>"` |
| Classes prontas | `card row grid grid-2 grid-3 muted ok warn err info badge mono small big center right` |

Tudo o que é executável, remoto ou de navegação é **removido** (o resto do canvas continua) e o painel e o agente são avisados do que saiu: `script`, `style`, `iframe`, `svg`, `img`, `a`/`href`, formulários, `on*`, `src`, `style=…`. HTML malformado (tag sem fechar, aninhamento > 32, > 5 000 nós, > 200 000 caracteres…) é **recusado por inteiro**: o canvas anterior permanece e o painel mostra o motivo.

## Segurança

- O conteúdo do canvas é entrada não confiável. Ele passa por um leitor estrito que produz uma árvore de dados — nunca HTML cru — validada no plugin, no serviço (ao receber e ao ler do disco) e no painel.
- O painel só constrói DOM com `createElement`/`textContent`. Um teste falha se qualquer código-fonte usar `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` ou `eval`.
- O painel roda em iframe sandboxado: sem rede, sem disco, sem acesso ao OpenChamber. Rede e disco só existem no serviço.
- O serviço escuta apenas em `127.0.0.1` e exige o token do host. Ids de sessão são validados antes de virar nome de arquivo.
- Mensagens de erro e logs nunca reproduzem o conteúdo do canvas.
- Excluir uma sessão apaga o canvas dela (evento `session-deleted`).

## Desenvolvimento

```bash
npm install
npm run build      # panel/main.js, service/main.js e plugin/index.js
npm run typecheck
npm test
```

Node 24+. Veja [AGENTS.md](AGENTS.md) para as regras do projeto (TypeScript estrito; os `.js` são artefatos de build).

### Limitações conhecidas (v0.1)

- A reconciliação de canvases órfãos (sessão excluída com a extensão desligada) não existe; o evento de exclusão só é entregue com a extensão ativa.
- Sessões dentro de espaços isolados (containers) não carregam plugins do host; nelas `canvas_publish` não existe.
- Se o OpenCode não foi iniciado pelo OpenChamber, o plugin só carrega pelo botão *Add to global config* da extensão (comportamento do host).

## Changelog

### 0.1.0
- Painel Canvas com um canvas por sessão, atualizado em tempo real.
- Ferramenta `canvas_publish` (plugin do OpenCode), serviço com persistência por sessão e sanitização em três camadas.
- Estados vazio, recusado (mantém o canvas anterior) e conteúdo bloqueado.

## Licença

Apache-2.0 — ver [LICENSE](LICENSE).
