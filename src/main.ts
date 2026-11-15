/** Painel Canvas: mostra o canvas da sessão em foco e o atualiza sozinho. */

import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";

import { parseCanvasResponse, viewFromResponse, type PanelView } from "./canvas/panel-state.ts";
import { structureSignature } from "./canvas/sanitize.ts";
import { buildNodes, formatTime } from "./canvas/view.ts";

const POLL_MS = 1500;

const host = connectHost();
function rootElement(): HTMLElement {
  const element = document.getElementById("app");
  if (!element) throw new Error("Canvas Viewer: elemento #app não encontrado no painel");
  return element;
}

const app = rootElement();

let sessionId: string | null = null;
let view: PanelView = { kind: "no-session" };
let lastSignature = "";
let lastRendered = "";
let requestSeq = 0;
let inflightFor: string | null = null;
let polling: ReturnType<typeof setInterval> | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function banner(kind: "error" | "warning", text: string): HTMLElement {
  return el("div", `banner ${kind}`, text);
}

function emptyMessage(text: string): HTMLElement {
  return el("div", "empty", text);
}

/** Só redesenha quando o que está na tela mudou (preserva seleção e rolagem). */
function render(): void {
  const key = JSON.stringify(view);
  if (key === lastRendered) return;
  lastRendered = key;

  const previousScroll = document.getElementById("scroll");
  const scrollTop = previousScroll?.scrollTop ?? 0;
  const root = el("div");
  root.id = "app-inner";
  root.style.cssText = "display:flex;flex-direction:column;height:100%";

  const body = el("div");
  body.id = "scroll";

  switch (view.kind) {
    case "no-session":
      body.append(emptyMessage("Abra uma sessão para ver o canvas dela."));
      break;
    case "loading":
      body.append(emptyMessage("Carregando…"));
      break;
    case "failed":
      root.append(banner("error", `Não foi possível mostrar o canvas: ${view.message}`));
      break;
    case "empty":
      if (view.error) root.append(banner("error", `Publicação recusada: ${view.error.message}`));
      body.append(emptyMessage("Nenhum canvas foi criado nesta sessão."));
      break;
    case "canvas": {
      const header = el("header");
      header.append(el("h1", undefined, view.title || "Canvas"), el("time", undefined, `Atualizado às ${formatTime(view.updatedAt)}`));
      root.append(header);
      if (view.outdatedService) root.append(banner("warning", "O serviço da extensão está desatualizado: pause e retome a extensão em Settings → Extensions."));
      if (view.error) root.append(banner("error", `Última publicação recusada (${formatTime(view.error.at)}): ${view.error.message}. O canvas anterior foi mantido.`));
      if (view.blocked.length) root.append(banner("warning", `Conteúdo bloqueado e removido: ${view.blocked.join(", ")}.`));
      const content = el("div", "cv");
      content.append(buildNodes(view.tree));
      body.append(content);
      break;
    }
  }
  root.append(body);
  app.replaceChildren(root);

  if (view.kind === "canvas") {
    const signature = structureSignature(view.tree);
    body.scrollTop = signature === lastSignature ? scrollTop : 0;
    lastSignature = signature;
  } else {
    lastSignature = "";
  }
}

/**
 * Lê o canvas da sessão em foco. Uma leitura por vez por sessão; resposta atrasada de outra
 * sessão ou de uma chamada antiga nunca sobrescreve a atual. Falha passageira com um canvas
 * na tela mantém o canvas (e a rolagem) em vez de trocá-lo por um erro.
 */
async function refresh(): Promise<void> {
  if (!sessionId || inflightFor === sessionId) return;
  const asked = sessionId;
  const seq = ++requestSeq;
  inflightFor = asked;
  let next: PanelView;
  try {
    const result = await host.serviceRequest({ method: "GET", path: "/canvas", query: { sessionId: asked } });
    next = result.status === 200 ? viewFromResponse(parseCanvasResponse(result.body)) : { kind: "failed", message: `serviço respondeu ${result.status}` };
  } catch {
    next = { kind: "failed", message: "serviço indisponível" };
  } finally {
    if (inflightFor === asked) inflightFor = null;
  }
  if (seq !== requestSeq || asked !== sessionId) return;
  if (next.kind === "failed" && view.kind === "canvas") return;
  view = next;
  render();
}

function setSession(next: string | null): void {
  if (next === sessionId) return;
  sessionId = next;
  requestSeq += 1;
  inflightFor = null;
  view = next ? { kind: "loading" } : { kind: "no-session" };
  render();
  void refresh();
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  setSession(ctx.session?.id ?? null);
});
host.onSession((session) => setSession(session?.id ?? null));
host.onServiceEvent((event) => {
  const data = event.data;
  if (event.topic === "canvas" && typeof data === "object" && data !== null && !Array.isArray(data) && data.sessionId === sessionId) void refresh();
});

polling = setInterval(() => {
  if (!document.hidden) void refresh();
}, POLL_MS);
window.addEventListener("pagehide", () => {
  if (polling) clearInterval(polling);
});

render();
