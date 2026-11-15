/** Painel Canvas: mostra o canvas da sessão em foco, o atualiza sozinho e devolve contexto ao chat. */

import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";

import { createActions, FAILURE_MESSAGES, type ActionResult } from "./canvas/actions.ts";
import { normalizeSelection } from "./canvas/context.ts";
import { parseCanvasResponse, viewFromResponse, type PanelView } from "./canvas/panel-state.ts";
import { structureSignature } from "./canvas/sanitize.ts";
import { isInView, placeToolbar } from "./canvas/toolbar-position.ts";
import { buildNodes, formatTime } from "./canvas/view.ts";

const POLL_MS = 1500;

const host = connectHost();

function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Canvas Viewer: elemento #${id} não encontrado no painel`);
  return element;
}

const top = required("top");
const scroll = required("scroll");

let sessionId: string | null = null;
let view: PanelView = { kind: "no-session" };
/** Sessão a que `view` pertence: só nela as ações de contexto são permitidas. */
let viewOwner: string | null = null;
let lastSignature = "";
let lastRendered = "";
let requestSeq = 0;
let inflightFor: string | null = null;
let dirty = false;
let polling: ReturnType<typeof setInterval> | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", "ui-btn", label);
  node.type = "button";
  node.title = title;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

function banner(kind: "error" | "warning", text: string): HTMLElement {
  return el("div", `banner ${kind}`, text);
}

const actions = createActions(host, () => ({
  current: sessionId,
  shown: view.kind === "canvas" && viewOwner ? { owner: viewOwner, title: view.title, updatedAt: view.updatedAt, tree: view.tree } : null,
}));

function report(result: ActionResult, done: string): void {
  if (result.ok) {
    void host.toast({ kind: "success", message: result.truncated ? `${done} (conteúdo truncado)` : done }).catch(() => {});
    return;
  }
  void host.toast({ kind: "error", message: FAILURE_MESSAGES[result.reason] }).catch(() => {});
}

/** Barra flutuante da seleção: só existe enquanto há texto do canvas selecionado. */
const toolbar = el("div", "sel-toolbar");
toolbar.hidden = true;
document.body.append(toolbar);
toolbar.addEventListener("mousedown", (event) => event.preventDefault());

type Picked = { text: string; itemId: string | null };

/** Seleção atual, se estiver inteira dentro do conteúdo do canvas (nunca do cabeçalho ou da barra). */
function pickedSelection(): { picked: Picked; rect: DOMRect } | null {
  const selection = document.getSelection();
  const content = scroll.querySelector(".cv");
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed || !content) return null;
  const range = selection.getRangeAt(0);
  if (!content.contains(range.commonAncestorContainer)) return null;
  const text = normalizeSelection(range.toString());
  if (!text) return null;
  const anchor = range.commonAncestorContainer;
  const element = anchor instanceof Element ? anchor : anchor.parentElement;
  const itemId = element?.closest("[data-canvas-item]")?.getAttribute("data-canvas-item") ?? null;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[rects.length - 1]! : range.getBoundingClientRect();
  return { picked: { text, itemId }, rect };
}

function hideToolbar(): void {
  toolbar.hidden = true;
  toolbar.replaceChildren();
}

function clearSelection(): void {
  document.getSelection()?.removeAllRanges();
  hideToolbar();
}

function commentSelection(): void {
  const found = pickedSelection();
  if (!found) return;
  const { text, itemId } = found.picked;
  void actions.addToContext({ kind: "selection", text, ...(itemId ? { itemId } : {}) }).then((result) => {
    report(result, "Trecho adicionado à caixa de mensagem. Escreva seu comentário e envie.");
    if (result.ok) clearSelection();
  });
}

function addSelectedElement(): void {
  const found = pickedSelection();
  if (!found?.picked.itemId) return;
  const id = found.picked.itemId;
  void actions.addToContext({ kind: "item", id }).then((result) => {
    report(result, "Elemento adicionado ao contexto");
    if (result.ok) clearSelection();
  });
}

function updateToolbar(): void {
  const found = view.kind === "canvas" && viewOwner !== null && viewOwner === sessionId ? pickedSelection() : null;
  if (!found) {
    if (!toolbar.hidden) hideToolbar();
    return;
  }
  if (!isInView(found.rect, scroll.getBoundingClientRect())) {
    if (!toolbar.hidden) hideToolbar();
    return;
  }
  const wanted = found.picked.itemId ? "item" : "plain";
  if (toolbar.hidden || toolbar.dataset.mode !== wanted) {
    toolbar.dataset.mode = wanted;
    const buttons = [button("Comentar", "Adiciona o trecho selecionado à caixa de mensagem; escreva o comentário lá", commentSelection)];
    if (found.picked.itemId) buttons.push(button("+ Elemento", "Adiciona o elemento inteiro ao contexto do chat", addSelectedElement));
    toolbar.replaceChildren(...buttons);
    toolbar.hidden = false;
  }
  const size = { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
  const place = placeToolbar(found.rect, { width: window.innerWidth, height: window.innerHeight }, size);
  toolbar.style.top = `${place.top}px`;
  toolbar.style.left = `${place.left}px`;
}

let toolbarFrame = 0;
function scheduleToolbar(): void {
  if (toolbarFrame) return;
  toolbarFrame = requestAnimationFrame(() => {
    toolbarFrame = 0;
    updateToolbar();
  });
}

/** Teclado: um elemento marcado ganha foco e, com Enter, vai inteiro para o contexto do chat. */
function makeItemKeyboardReachable(element: HTMLElement, id: string): void {
  element.tabIndex = 0;
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", `Elemento ${id}. Enter adiciona ao contexto do chat.`);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.target !== element) return;
    event.preventDefault();
    void actions.addToContext({ kind: "item", id }).then((result) => report(result, "Elemento adicionado ao contexto"));
  });
}

/** Só redesenha quando o que está na tela mudou (preserva seleção; a rolagem vive em #scroll). */
function render(): void {
  const key = JSON.stringify(view);
  if (key === lastRendered) return;
  lastRendered = key;

  const head: HTMLElement[] = [];
  const body: HTMLElement[] = [];

  switch (view.kind) {
    case "no-session":
      body.push(el("div", "empty", "Abra uma sessão para ver o canvas dela."));
      break;
    case "loading":
      body.push(el("div", "empty", "Carregando…"));
      break;
    case "failed":
      head.push(banner("error", `Não foi possível mostrar o canvas: ${view.message}`));
      break;
    case "empty":
      if (view.error) head.push(banner("error", `Publicação recusada: ${view.error.message}`));
      body.push(el("div", "empty", "Nenhum canvas foi criado nesta sessão."));
      break;
    case "canvas": {
      const header = el("header");
      header.append(
        el("h1", undefined, view.title || "Canvas"),
        el("time", undefined, `Atualizado às ${formatTime(view.updatedAt)}`),
        button("+ Contexto", "Adicionar o canvas inteiro ao contexto do chat", () => void actions.addToContext({ kind: "canvas" }).then((r) => report(r, "Canvas adicionado ao contexto"))),
      );
      head.push(header);
      if (view.outdatedService) head.push(banner("warning", "O serviço da extensão está desatualizado: pause e retome a extensão em Settings → Extensions."));
      if (view.error) head.push(banner("error", `Última publicação recusada (${formatTime(view.error.at)}): ${view.error.message}. O canvas anterior foi mantido.`));
      if (view.blocked.length) head.push(banner("warning", `Conteúdo bloqueado e removido: ${view.blocked.join(", ")}.`));
      const content = el("div", "cv");
      content.append(buildNodes(view.tree, document, makeItemKeyboardReachable));
      body.push(content);
      break;
    }
  }
  top.replaceChildren(...head);
  scroll.replaceChildren(...body);

  if (view.kind === "canvas") {
    const signature = structureSignature(view.tree);
    if (signature !== lastSignature) scroll.scrollTop = 0;
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
  if (!sessionId) return;
  if (inflightFor === sessionId) {
    dirty = true;
    return;
  }
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
  const again = dirty;
  dirty = false;
  if (seq === requestSeq && asked === sessionId) {
    if (!(next.kind === "failed" && view.kind === "canvas")) {
      view = next;
      viewOwner = asked;
      render();
    }
    if (again) void refresh();
  }
}

/** Trocar de sessão descarta o comentário em edição: ele pertence ao canvas da sessão anterior. */
function setSession(next: string | null): void {
  if (next === sessionId) return;
  sessionId = next;
  requestSeq += 1;
  inflightFor = null;
  dirty = false;
  hideToolbar();
  view = next ? { kind: "loading" } : { kind: "no-session" };
  viewOwner = next;
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

document.addEventListener("selectionchange", scheduleToolbar);
scroll.addEventListener("scroll", scheduleToolbar, { passive: true });
window.addEventListener("resize", scheduleToolbar);

polling = setInterval(() => {
  if (!document.hidden) void refresh();
}, POLL_MS);
window.addEventListener("pagehide", () => {
  if (polling) clearInterval(polling);
});

render();
