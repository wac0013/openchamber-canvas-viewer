/** Painel Canvas: mostra o canvas da sessão em foco, o atualiza sozinho e devolve contexto ao chat. */

import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";

import { createActions, FAILURE_MESSAGES, type ActionResult } from "./canvas/actions.ts";
import { normalizeSelection, type SelectionLink } from "./canvas/context.ts";
import { buildEmbedDocument, EMBED_SANDBOX, EMBED_THEME_VARS, hasUserGesture, readEmbedMessage } from "./canvas/embed-frame.ts";
import { collectFilterItems, groupsOf, isFiltering, NO_FILTER, shouldOfferFilter, visibleIds, type FilterItem, type FilterState } from "./canvas/filter.ts";
import { parseCanvasResponse, viewFromResponse, type PanelView } from "./canvas/panel-state.ts";
import { cleanHref, structureSignature } from "./canvas/sanitize.ts";
import { requestCanvasUpdate, UPDATE_MESSAGES, UPDATE_SENT_MESSAGE } from "./canvas/update-request.ts";
import { isInView, placeToolbar } from "./canvas/toolbar-position.ts";
import { buildNodes, formatTime, LINK_ATTRIBUTE } from "./canvas/view.ts";

const POLL_MS = 1500;
/** Altura de uma parte incorporada até ela informar a real (ou quando o agente não fixou `data-height`). */
const EMBED_INITIAL_HEIGHT = 160;

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
/** Há um pedido de atualização em voo: o botão fica desabilitado até a resposta. */
let updating = false;

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

/**
 * Botão Atualizar: pede ao agente que republique o canvas. O ideal é a atualização automática;
 * isto é o pedido formal do usuário. O pedido vai para a sessão dona do canvas exibido (id explícito).
 */
function requestUpdate(): void {
  if (updating || view.kind !== "canvas" || !viewOwner) return;
  const owner = viewOwner;
  updating = true;
  setUpdateButton();
  void requestCanvasUpdate(host, owner).then((result) => {
    updating = false;
    setUpdateButton();
    const shown = result.ok ? { kind: "success" as const, message: UPDATE_SENT_MESSAGE } : UPDATE_MESSAGES[result.reason];
    void host.toast(shown).catch(() => {});
  });
}

function setUpdateButton(): void {
  const node = document.getElementById("btn-update");
  if (node instanceof HTMLButtonElement) node.disabled = updating;
}

/** Barra flutuante da seleção: só existe enquanto há texto do canvas selecionado. */
const toolbar = el("div", "sel-toolbar");
toolbar.hidden = true;
document.body.append(toolbar);
toolbar.addEventListener("mousedown", (event) => event.preventDefault());

type Picked = { text: string; itemId: string | null; links: SelectionLink[] };

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
  const links = [...content.querySelectorAll(`a[${LINK_ATTRIBUTE}]`)]
    .filter((anchor) => range.intersectsNode(anchor))
    .map((anchor) => ({ text: anchor.textContent ?? "", url: anchor.getAttribute(LINK_ATTRIBUTE) ?? "" }));
  const rects = range.getClientRects();
  const rect = rects.length ? rects[rects.length - 1]! : range.getBoundingClientRect();
  return { picked: { text, itemId, links }, rect };
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
  const { text, itemId, links } = found.picked;
  void actions.addToContext({ kind: "selection", text, ...(itemId ? { itemId } : {}), ...(links.length ? { links } : {}) }).then((result) => {
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

/** Abre um link do canvas fora do painel (o iframe não navega). Só http/https; o host ainda confere. */
function openLink(url: string): void {
  const clean = cleanHref(url);
  if (!clean) return;
  void host.openUrl(clean).catch(() => void host.toast({ kind: "error", message: "Não foi possível abrir o link." }).catch(() => {}));
}

function linkOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(`a[${LINK_ATTRIBUTE}]`) : null;
}

scroll.addEventListener("click", (event) => {
  const link = linkOf(event.target);
  if (!link) return;
  event.preventDefault();
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && scroll.contains(selection.anchorNode)) return;
  openLink(link.getAttribute(LINK_ATTRIBUTE) ?? "");
});
scroll.addEventListener("auxclick", (event) => {
  if (linkOf(event.target)) event.preventDefault();
});
scroll.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const link = linkOf(event.target);
  if (!link) return;
  event.preventDefault();
  openLink(link.getAttribute(LINK_ATTRIBUTE) ?? "");
});

/** Partes incorporadas desenhadas agora: iframe → altura fixa pelo agente? */
const embedFrames = new Map<HTMLIFrameElement, boolean>();

function themeVars(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  return Object.fromEntries(EMBED_THEME_VARS.map((name) => [name, computed.getPropertyValue(name)]));
}

function colorScheme(): "light" | "dark" {
  return getComputedStyle(document.documentElement).colorScheme.includes("light") ? "light" : "dark";
}

/** Assinatura do tema: mudou o tema, as partes incorporadas são redesenhadas com as cores novas. */
function themeSignature(): string {
  return `${colorScheme()}|${EMBED_THEME_VARS.map((name) => getComputedStyle(document.documentElement).getPropertyValue(name)).join("|")}`;
}

function makeEmbed(id: string, height: number | null): HTMLElement | null {
  if (view.kind !== "canvas") return null;
  const html = view.embeds[id];
  if (html === undefined) return null;
  const frame = document.createElement("iframe");
  frame.className = "ui-embed";
  frame.setAttribute("sandbox", EMBED_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = `Visualização incorporada: ${id}`;
  frame.style.height = `${height ?? EMBED_INITIAL_HEIGHT}px`;
  frame.srcdoc = buildEmbedDocument(html, themeVars(), colorScheme());
  embedFrames.set(frame, height !== null);
  return frame;
}

window.addEventListener("message", (event) => {
  const message = readEmbedMessage(event.data);
  if (!message) return;
  for (const [frame, fixed] of embedFrames) {
    if (frame.contentWindow !== event.source) continue;
    if (message.kind === "height") {
      if (!fixed) frame.style.height = `${message.value}px`;
    } else if (hasUserGesture(navigator)) {
      openLink(message.url);
    }
    return;
  }
});

/** Filtro de texto e de grupo: lógica em canvas/filter.ts; aqui só os controles e o DOM. */
const filterInput = el("input", "ui-input");
filterInput.type = "search";
filterInput.placeholder = "Filtrar…";
filterInput.setAttribute("aria-label", "Filtrar itens do canvas");
const filterSelect = el("select", "ui-input ui-select");
filterSelect.setAttribute("aria-label", "Filtrar por grupo");
const filterCount = el("span", "ui-count");
const filterBar = el("div", "ui-filter");
filterBar.append(filterInput, filterSelect, filterCount);

let filterState: FilterState = NO_FILTER;
let filterItems: FilterItem[] = [];

function option(value: string, label: string): HTMLOptionElement {
  const node = el("option", undefined, label);
  node.value = value;
  return node;
}

function applyFilter(): void {
  const content = scroll.querySelector(".cv");
  if (!content) return;
  const filtering = isFiltering(filterState);
  const visible = visibleIds(filterItems, filterState);
  for (const section of content.querySelectorAll("section:not([data-canvas-item])")) {
    const inner = [...section.querySelectorAll("[data-canvas-item]")];
    section.classList.toggle("ui-hidden", filtering && inner.length > 0 && !inner.some((node) => visible.has(node.getAttribute("data-canvas-item") ?? "")));
  }
  for (const node of content.querySelectorAll("[data-canvas-item]")) {
    node.classList.toggle("ui-hidden", filtering && !visible.has(node.getAttribute("data-canvas-item") ?? ""));
  }
  filterCount.textContent = !filtering ? `${filterItems.length} itens` : visible.size === 0 ? "Nenhum resultado" : `${visible.size} de ${filterItems.length}`;
}

filterInput.addEventListener("input", () => {
  filterState = { ...filterState, query: filterInput.value };
  applyFilter();
});
filterSelect.addEventListener("change", () => {
  filterState = { ...filterState, group: filterSelect.value };
  applyFilter();
});

/** Prepara a barra para o canvas atual; devolve `true` se ela deve aparecer. */
function syncFilter(tree: Extract<PanelView, { kind: "canvas" }>["tree"]): boolean {
  filterItems = collectFilterItems(tree);
  if (!shouldOfferFilter(filterItems)) {
    filterState = NO_FILTER;
    return false;
  }
  const groups = groupsOf(filterItems);
  if (filterState.group !== "" && !groups.includes(filterState.group)) filterState = { ...filterState, group: "" };
  filterSelect.replaceChildren(option("", "Todos os grupos"), ...groups.map((group) => option(group, group)));
  filterSelect.value = filterState.group;
  filterSelect.hidden = groups.length < 2;
  if (filterInput.value !== filterState.query) filterInput.value = filterState.query;
  return true;
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
  const key = view.kind === "canvas" && Object.keys(view.embeds).length ? `${JSON.stringify(view)}${themeSignature()}` : JSON.stringify(view);
  if (key === lastRendered) return;
  lastRendered = key;

  const head: HTMLElement[] = [];
  const body: HTMLElement[] = [];
  const hadFilterFocus = filterBar.contains(document.activeElement);
  embedFrames.clear();

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
      const update = button("Atualizar", "Pede ao agente para atualizar o canvas. O ideal é a atualização automática; use quando ela não acontecer.", requestUpdate);
      update.id = "btn-update";
      update.disabled = updating;
      const tools = el("div", "header-tools");
      tools.append(
        el("time", undefined, `Atualizado às ${formatTime(view.updatedAt)}`),
        update,
        button("+ Contexto", "Adicionar o canvas inteiro ao contexto do chat", () => void actions.addToContext({ kind: "canvas" }).then((r) => report(r, "Canvas adicionado ao contexto"))),
      );
      header.append(el("h1", undefined, view.title || "Canvas"), tools);
      head.push(header);
      if (view.outdatedService) head.push(banner("warning", "O serviço da extensão está desatualizado: pause e retome a extensão em Settings → Extensions."));
      if (view.error) head.push(banner("error", `Última publicação recusada (${formatTime(view.error.at)}): ${view.error.message}. O canvas anterior foi mantido.`));
      if (view.blocked.length) head.push(banner("warning", `Avisos do canvas: ${view.blocked.join(", ")}.`));
      if (syncFilter(view.tree)) head.push(filterBar);
      const content = el("div", "cv");
      content.append(buildNodes(view.tree, document, { onItem: makeItemKeyboardReachable, embed: makeEmbed }));
      body.push(content);
      break;
    }
  }
  top.replaceChildren(...head);
  scroll.replaceChildren(...body);
  if (view.kind === "canvas") applyFilter();
  if (hadFilterFocus && head.includes(filterBar)) filterInput.focus({ preventScroll: true });

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
  filterState = NO_FILTER;
  filterInput.value = "";
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
