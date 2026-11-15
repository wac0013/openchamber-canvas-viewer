/** Painel Canvas: mostra o canvas da sessão em foco, o atualiza sozinho e devolve contexto ao chat. */

import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";

import { createActions, FAILURE_MESSAGES, type ActionResult } from "./canvas/actions.ts";
import { createDraftController } from "./canvas/comment-draft.ts";
import { findItem } from "./canvas/context.ts";
import { parseCanvasResponse, viewFromResponse, type PanelView } from "./canvas/panel-state.ts";
import { structureSignature } from "./canvas/sanitize.ts";
import { buildNodes, formatTime } from "./canvas/view.ts";
import { LIMITS } from "./shared/contract.ts";

const POLL_MS = 1500;

const host = connectHost();

function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Canvas Viewer: elemento #${id} não encontrado no painel`);
  return element;
}

const top = required("top");
const scroll = required("scroll");
const commentBar = required("comment-bar");

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
  const extra = result.attached ? " O chip já estava na caixa; o texto não foi escrito." : "";
  void host.toast({ kind: "error", message: `${FAILURE_MESSAGES[result.reason]}${extra}` }).catch(() => {});
}

/** Última origem de foco antes de abrir o campo: devolvido ao elemento ao cancelar. */
let focusBeforeComment: HTMLElement | null = null;
let barFor: object | null = null;

const draftController = createDraftController(
  (itemId, text) => actions.comment(itemId, text),
  () => renderCommentBar(),
);

function renderCommentBar(): void {
  const draft = draftController.current();
  if (!draft) {
    barFor = null;
    commentBar.hidden = true;
    commentBar.replaceChildren();
    focusBeforeComment?.focus();
    focusBeforeComment = null;
    return;
  }
  if (barFor === draft) {
    for (const control of commentBar.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>("button, textarea")) control.disabled = draft.busy;
    return;
  }
  barFor = draft;
  const input = el("textarea", "ui-input");
  input.maxLength = LIMITS.itemTextChars;
  input.rows = 3;
  input.placeholder = "Escreva o comentário para o agente";
  input.addEventListener("input", () => draftController.setText(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") draftController.cancel();
  });
  const confirm = button("Adicionar à mensagem", "Escreve o comentário na caixa de mensagem, sem enviar", () => {
    void draftController.confirm().then((result) => {
      if (result) report(result, "Comentário adicionado à caixa de mensagem");
    });
  });
  confirm.classList.add("primary");
  const row = el("div", "ui-row");
  row.append(confirm, button("Cancelar", "Descarta o comentário", () => draftController.cancel()));
  commentBar.replaceChildren(el("div", "ui-label", `Comentando o elemento ${draft.itemId}`), input, row);
  commentBar.hidden = false;
  input.focus();
}

function openComment(itemId: string, origin: HTMLElement | null): void {
  if (view.kind !== "canvas" || !viewOwner || viewOwner !== sessionId || !findItem(view.tree, itemId)) return;
  focusBeforeComment = origin;
  draftController.open(viewOwner, itemId);
}

function decorateItem(element: HTMLElement, id: string): void {
  element.tabIndex = 0;
  const box = el("span", "ui-actions");
  box.append(
    button("+ Contexto", "Adicionar este elemento ao contexto do chat", () => void actions.addToContext({ kind: "item", id }).then((r) => report(r, "Elemento adicionado ao contexto"))),
    button("Comentar", "Comentar este elemento", () => openComment(id, element)),
  );
  element.append(box);
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
      content.append(buildNodes(view.tree, document, decorateItem));
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
  draftController.sessionChanged(next);
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

polling = setInterval(() => {
  if (!document.hidden) void refresh();
}, POLL_MS);
window.addEventListener("pagehide", () => {
  if (polling) clearInterval(polling);
});

render();
