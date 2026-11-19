/**
 * Painel Canvas: mostra o canvas da conversa em foco (HTML livre do agente, num iframe isolado),
 * o recarrega na hora em que o arquivo muda e devolve contexto ao chat.
 *
 * O painel só costura: a regra está em panel-state (resposta do serviço), frame-doc (srcdoc e
 * mensagens do iframe), view-state (filtros e removidos), context/actions (chips do chat).
 */

import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";

import { createActions, FAILURE_MESSAGES, type ActionResult } from "./canvas/actions.ts";
import type { ContextCanvas } from "./canvas/context.ts";
import { buildFrameDocument, FRAME_SANDBOX, hasUserGesture, readCanvasMessage, THEME_VARS, type FrameItem, type FrameMessage } from "./canvas/frame-doc.ts";
import { cleanHref } from "./canvas/links.ts";
import { infoFromBody, rootOfEvent, viewFromBody, type PanelView } from "./canvas/panel-state.ts";
import { isInView, placeToolbar } from "./canvas/toolbar-position.ts";
import { requestCanvasUpdate, UPDATE_MESSAGES, UPDATE_SENT_MESSAGE } from "./canvas/update-request.ts";
import { EMPTY_VIEW_STATE, isEmptyViewState, parseViewState, viewStateKey, type ViewState } from "./canvas/view-state.ts";

/** Rede de segurança: o normal é o evento do servidor; isto cobre uma ponte caída. */
const POLL_MS = 5000;

const host = connectHost();

function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Canvas Viewer: elemento #${id} não encontrado no painel`);
  return element;
}

const top = required("top");
const stage = required("stage");

/** Sessão em foco agora. */
let sessionId: string | null = null;
let view: PanelView = { kind: "no-session" };
/** Sessão em foco quando o canvas exibido foi pedido: só nela as ações de contexto são permitidas. */
let viewOwner: string | null = null;
let viewState: ViewState = EMPTY_VIEW_STATE;
let stateRoot: string | null = null;
let scrollY = 0;
let requestSeq = 0;
let shownKey = "";
let shownTheme = "";
/** Texto e itens do canvas exibido, devolvidos pelo runtime do iframe. */
let shownText: { text: string; items: FrameItem[] } = { text: "", items: [] };
let updating = false;

let currentFrame: HTMLIFrameElement | null = null;
let pendingFrame: HTMLIFrameElement | null = null;
let message: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, title: string, onClick: () => void, id?: string): HTMLButtonElement {
  const node = el("button", "ui-btn", label);
  node.type = "button";
  node.title = title;
  if (id) node.id = id;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

function toast(kind: "success" | "error" | "info", text: string): void {
  void host.toast({ kind, message: text }).catch(() => {});
}

const actions = createActions(host, () => ({
  current: sessionId,
  shown: view.kind === "canvas" && viewOwner ? { owner: viewOwner, title: view.title, updatedAt: view.updatedAt, text: shownText.text, items: shownText.items } satisfies ContextCanvas & { owner: string } : null,
}));

function report(result: ActionResult, done: string): void {
  if (result.ok) toast("success", result.truncated ? `${done} (conteúdo truncado)` : done);
  else toast("error", FAILURE_MESSAGES[result.reason]);
}

// --- Atualizar ----------------------------------------------------------------------------

/** Pede ao agente que republique o canvas: vai para a sessão RAIZ dona do canvas exibido (id explícito). */
function requestUpdate(): void {
  if (updating || view.kind !== "canvas") return;
  const root = view.rootId;
  updating = true;
  setUpdateButton();
  void requestCanvasUpdate(host, root).then((result) => {
    updating = false;
    setUpdateButton();
    if (result.ok) toast("success", UPDATE_SENT_MESSAGE);
    else void host.toast(UPDATE_MESSAGES[result.reason]).catch(() => {});
  });
}

function setUpdateButton(): void {
  const node = document.getElementById("btn-update");
  if (node instanceof HTMLButtonElement) node.disabled = updating;
}

// --- Abrir links e o navegador ------------------------------------------------------------

function openLink(url: string): void {
  const clean = cleanHref(url);
  if (!clean) return;
  void host.openUrl(clean).catch(() => toast("error", "Não foi possível abrir o link."));
}

function openInBrowser(): void {
  if (view.kind !== "canvas" && view.kind !== "empty") return;
  const target = sessionId;
  if (!target) return;
  void host
    .serviceRequest({ method: "GET", path: "/info", query: { sessionId: target } })
    .then((result) => {
      const url = result.status === 200 ? infoFromBody(result.body, cleanHref) : null;
      if (url) openLink(url);
      else toast("error", "Não foi possível obter o endereço do canvas.");
    })
    .catch(() => toast("error", "Não foi possível obter o endereço do canvas."));
}

// --- Barra flutuante da seleção -----------------------------------------------------------

const toolbar = el("div", "sel-toolbar");
toolbar.hidden = true;
document.body.append(toolbar);
toolbar.addEventListener("mousedown", (event) => event.preventDefault());

type Picked = Extract<FrameMessage, { kind: "selection" }>;
let picked: Picked | null = null;

function hideToolbar(): void {
  picked = null;
  toolbar.hidden = true;
  toolbar.replaceChildren();
}

function commentSelection(): void {
  const found = picked;
  if (!found) return;
  void actions
    .addToContext({ kind: "selection", text: found.text, ...(found.itemId ? { itemId: found.itemId } : {}), ...(found.links.length ? { links: found.links } : {}) })
    .then((result) => {
      report(result, "Trecho adicionado à caixa de mensagem. Escreva seu comentário e envie.");
      if (result.ok) hideToolbar();
    });
}

function addSelectedElement(): void {
  const id = picked?.itemId;
  if (!id) return;
  void actions.addToContext({ kind: "item", id }).then((result) => {
    report(result, "Elemento adicionado à caixa de mensagem.");
    if (result.ok) hideToolbar();
  });
}

/** `rect` vem em coordenadas do iframe: soma o deslocamento dele para posicionar a barra na janela. */
function showToolbar(found: Picked): void {
  const frame = currentFrame;
  if (!frame) return;
  const origin = frame.getBoundingClientRect();
  const rect = { top: found.rect.top + origin.top, bottom: found.rect.bottom + origin.top, left: found.rect.left + origin.left, right: found.rect.right + origin.left };
  if (!isInView(rect, origin)) {
    hideToolbar();
    return;
  }
  if (!picked || picked.text !== found.text || picked.itemId !== found.itemId || toolbar.hidden) {
    const buttons = [button("Comentar", "Adiciona o trecho à caixa de mensagem para você comentar", commentSelection)];
    if (found.itemId) buttons.push(button("+ Elemento", "Adiciona o elemento inteiro ao contexto do chat", addSelectedElement));
    toolbar.replaceChildren(...buttons);
    toolbar.hidden = false;
  }
  picked = found;
  const place = placeToolbar(rect, { width: window.innerWidth, height: window.innerHeight }, { width: toolbar.offsetWidth, height: toolbar.offsetHeight });
  toolbar.style.top = `${place.top}px`;
  toolbar.style.left = `${place.left}px`;
}

// --- Cabeçalho ----------------------------------------------------------------------------

function banner(kind: "error" | "warning", text: string): HTMLElement {
  return el("div", `banner ${kind}`, text);
}

function renderTop(): void {
  const nodes: HTMLElement[] = [];
  if (view.kind === "canvas" || view.kind === "empty") {
    const head = el("header");
    head.append(el("h1", undefined, view.kind === "canvas" ? view.title || "Canvas" : "Canvas"));
    const tools = el("div", "header-tools");
    if (view.kind === "canvas") {
      tools.append(el("time", undefined, new Date(view.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })));
      tools.append(button("+ Contexto", "Adiciona o canvas inteiro à caixa de mensagem", addWholeCanvas));
      tools.append(button("Atualizar", "Pede ao agente que republique o canvas", requestUpdate, "btn-update"));
      if (!isEmptyViewState(viewState)) tools.append(button("Restaurar", "Mostra de novo os itens removidos e tira os filtros", restoreView));
    }
    tools.append(button("Navegador", "Abre este canvas no navegador", openInBrowser));
    head.append(tools);
    nodes.push(head);
    if (view.outdatedService) nodes.push(banner("warning", "O serviço da extensão está desatualizado. Reinicie o OpenChamber para carregar a versão nova."));
  }
  top.replaceChildren(...nodes);
  setUpdateButton();
}

function addWholeCanvas(): void {
  void actions.addToContext({ kind: "canvas" }).then((result) => report(result, "Canvas adicionado à caixa de mensagem."));
}

// --- Iframes ------------------------------------------------------------------------------

function computed(): CSSStyleDeclaration {
  return getComputedStyle(document.documentElement);
}

function colorScheme(): "light" | "dark" {
  return computed().colorScheme.includes("light") ? "light" : "dark";
}

function themeVars(): Record<string, string> {
  const style = computed();
  return Object.fromEntries(THEME_VARS.map((name) => [name, style.getPropertyValue(name)]));
}

/** Assinatura do tema: mudou o tema, o canvas é redesenhado com as cores novas. */
function themeSignature(): string {
  const style = computed();
  return `${colorScheme()}|${THEME_VARS.map((name) => style.getPropertyValue(name)).join("|")}`;
}

function setMessage(text: string | null, kind: "info" | "error" = "info"): void {
  message?.remove();
  message = null;
  if (text === null) return;
  message = el("div", kind === "error" ? "empty banner error" : "empty", text);
  stage.append(message);
}

function dropFrame(frame: HTMLIFrameElement | null): void {
  frame?.remove();
}

function clearFrames(): void {
  dropFrame(pendingFrame);
  dropFrame(currentFrame);
  pendingFrame = null;
  currentFrame = null;
  shownText = { text: "", items: [] };
  hideToolbar();
}

/** Carrega o HTML num iframe novo escondido; ele só substitui o atual quando avisa que terminou (sem piscar). */
function mountFrame(canvas: Extract<PanelView, { kind: "canvas" }>): void {
  dropFrame(pendingFrame);
  const frame = document.createElement("iframe");
  frame.className = "loading";
  frame.title = canvas.title || "Canvas";
  frame.setAttribute("sandbox", FRAME_SANDBOX);
  frame.srcdoc = buildFrameDocument({ html: canvas.html, theme: themeVars(), colorScheme: colorScheme(), mode: "panel", state: { ...viewState, scroll: scrollY } });
  pendingFrame = frame;
  stage.append(frame);
}

function swapFrames(): void {
  const next = pendingFrame;
  if (!next) return;
  next.classList.remove("loading");
  dropFrame(currentFrame);
  currentFrame = next;
  pendingFrame = null;
  setMessage(null);
}

function persistViewState(): void {
  const key = stateRoot ? viewStateKey(stateRoot) : null;
  if (!key) return;
  const write = isEmptyViewState(viewState) ? host.storage.delete(key) : host.storage.set(key, { filters: viewState.filters, removed: viewState.removed });
  void write.catch(() => {});
}

function restoreView(): void {
  viewState = EMPTY_VIEW_STATE;
  persistViewState();
  if (view.kind === "canvas") mountFrame(view);
  renderTop();
}

window.addEventListener("message", (event) => {
  const fromCurrent = currentFrame !== null && event.source === currentFrame.contentWindow;
  const fromPending = pendingFrame !== null && event.source === pendingFrame.contentWindow;
  if (!fromCurrent && !fromPending) return;
  const received = readCanvasMessage(event.data);
  if (!received) return;
  switch (received.kind) {
    case "doc":
      if (fromPending) swapFrames();
      shownText = { text: received.text, items: received.items };
      return;
    case "state":
      if (!fromCurrent) return;
      viewState = { filters: received.filters, removed: received.removed };
      persistViewState();
      renderTop();
      return;
    case "scroll":
      if (fromCurrent) scrollY = received.y;
      return;
    case "link":
      if (fromCurrent && hasUserGesture(navigator)) openLink(received.url);
      return;
    case "selection-clear":
      if (fromCurrent) hideToolbar();
      return;
    case "selection":
      if (fromCurrent) showToolbar(received);
  }
});

// --- Carga --------------------------------------------------------------------------------

async function loadViewState(root: string): Promise<void> {
  const key = viewStateKey(root);
  let stored: unknown;
  try {
    stored = key ? await host.storage.get(key) : undefined;
  } catch {
    stored = undefined;
  }
  viewState = parseViewState(stored);
  stateRoot = root;
}

async function refresh(): Promise<void> {
  const asked = sessionId;
  if (!asked) return;
  const seq = ++requestSeq;
  let next: PanelView;
  try {
    const result = await host.serviceRequest({ method: "GET", path: "/canvas", query: { sessionId: asked } });
    next = result.status === 404 ? { kind: "failed", message: "O serviço da extensão está desatualizado. Reinicie o OpenChamber." } : viewFromBody(result.body);
  } catch {
    next = { kind: "failed", message: "Não foi possível falar com o serviço da extensão." };
  }
  if (seq !== requestSeq || asked !== sessionId) return;

  if (next.kind === "canvas" || next.kind === "empty") {
    if (stateRoot !== next.rootId) {
      await loadViewState(next.rootId);
      if (seq !== requestSeq || asked !== sessionId) return;
      scrollY = 0;
    }
  }
  const signature = themeSignature();
  const key = next.kind === "canvas" ? `${next.rootId}:${next.updatedAt}` : "";
  const unchanged = next.kind === "canvas" && view.kind === "canvas" && key === shownKey && signature === shownTheme;
  view = next;
  viewOwner = asked;
  if (unchanged) return;

  renderTop();
  if (next.kind === "canvas") {
    shownKey = key;
    shownTheme = signature;
    setMessage(null);
    mountFrame(next);
    return;
  }
  shownKey = "";
  clearFrames();
  setMessage(next.kind === "failed" ? next.message : next.kind === "empty" ? "Nenhum canvas ainda nesta conversa. Peça ao agente para publicar um." : "Abra uma sessão para ver o canvas.", next.kind === "failed" ? "error" : "info");
}

function setSession(next: string | null): void {
  if (next === sessionId) return;
  sessionId = next;
  requestSeq += 1;
  shownKey = "";
  stateRoot = null;
  viewState = EMPTY_VIEW_STATE;
  scrollY = 0;
  clearFrames();
  if (!next) {
    view = { kind: "no-session" };
    viewOwner = null;
    renderTop();
    setMessage("Abra uma sessão para ver o canvas.");
    return;
  }
  view = { kind: "loading" };
  viewOwner = next;
  renderTop();
  setMessage("Carregando…");
  void refresh();
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  setSession(ctx.session?.id ?? null);
});
host.onSession((session) => setSession(session?.id ?? null));
host.onServiceEvent((event) => {
  if (event.topic !== "canvas") return;
  const root = rootOfEvent(event.data);
  // Só interessa o canvas que está na tela (ou, sem canvas ainda, qualquer um: pode ser o desta sessão).
  if (view.kind === "canvas" && root !== view.rootId) return;
  void refresh();
});

window.addEventListener("resize", () => {
  if (picked) hideToolbar();
});

const polling = setInterval(() => {
  if (!document.hidden) void refresh();
}, POLL_MS);
window.addEventListener("pagehide", () => clearInterval(polling));

renderTop();
setMessage("Abra uma sessão para ver o canvas.");
