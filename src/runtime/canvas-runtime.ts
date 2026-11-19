// Runtime que roda DENTRO do iframe do canvas (painel e navegador), antes do HTML do agente.
//
// Esta função é serializada com `toString()` e injetada num <script>: precisa ser 100%
// autocontida (nada de imports, constantes de módulo ou helpers de fora). Os dados entram só
// por `config`. Tudo que sai passa por `postMessage` e é revalidado por `readCanvasMessage`
// (src/canvas/frame-doc.ts) do lado de quem hospeda o iframe.
//
// Faz: filtro por clique (`data-filter` ↔ `data-tags`), remover/restaurar itens (`data-canvas-item`),
// links (o iframe não navega), rolagem preservada entre recargas e, no painel, a seleção de texto.

export type RuntimeConfig = {
  mode: "panel" | "browser";
  /** Filtros ativos (`<chave>:<valor>`). */
  filters: string[];
  /** Ids de itens removidos pelo usuário. */
  removed: string[];
  /** Rolagem a restaurar ao carregar. */
  scroll: number;
  limits: { items: number; itemText: number; canvasText: number; filters: number };
};

export function canvasRuntime(config: RuntimeConfig, win: Window): void {
  const doc = win.document;
  const HIDDEN = "data-cv-hidden";
  const filters = config.filters.slice(0, config.limits.filters);
  const removed = new Set<string>(config.removed);

  const post = (message: Record<string, unknown>): void => {
    try {
      win.parent.postMessage({ cvCanvas: 1, ...message }, "*");
    } catch {
      // sem pai (aberto solto): nada a avisar
    }
  };

  const style = doc.createElement("style");
  style.textContent =
    "[" + HIDDEN + "]{display:none!important}" +
    ".cv-bar{position:sticky;top:0;z-index:2147483646;display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px;background:var(--oc-elevated,#222);border-bottom:1px solid var(--oc-border,#444);font:12px system-ui,sans-serif;color:var(--oc-fg,#eee)}" +
    ".cv-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 8px;border:1px solid var(--oc-border,#444);border-radius:999px}" +
    ".cv-chip button,.cv-x{font:inherit;color:inherit;background:transparent;border:0;cursor:pointer;padding:0 4px}" +
    ".cv-x{position:absolute;z-index:2147483647;width:20px;height:20px;line-height:18px;text-align:center;border:1px solid var(--oc-border,#444);border-radius:50%;background:var(--oc-elevated,#222);padding:0}" +
    "[data-filter]{cursor:pointer}";
  (doc.head || doc.documentElement).appendChild(style);

  const remove = doc.createElement("button");
  remove.className = "cv-x";
  remove.setAttribute("data-cv-ui", "");
  remove.type = "button";
  remove.title = "Remover do canvas";
  remove.textContent = "\u00d7";
  let bar: HTMLElement | null = null;

  const itemId = (element: Element | null): string => {
    const found = element ? element.closest("[data-canvas-item]") : null;
    return found ? found.getAttribute("data-canvas-item") || "" : "";
  };

  /** Esconde o que foi removido ou não bate com os filtros ativos. */
  const hideMatching = (): void => {
    for (const element of Array.from(doc.querySelectorAll("[data-canvas-item],[data-tags]"))) {
      const id = element.getAttribute("data-canvas-item") || "";
      const tokens = (element.getAttribute("data-tags") || "").split(/\s+/);
      const hide = (id !== "" && removed.has(id)) || (element.hasAttribute("data-tags") && filters.some((filter) => tokens.indexOf(filter) < 0));
      if (hide) element.setAttribute(HIDDEN, "");
      else element.removeAttribute(HIDDEN);
    }
  };

  // Antes da primeira pintura `innerText` cai em `textContent` e traz o código de <script>/<style>: nesse caso tira-os de uma cópia.
  const textOf = (element: Element): string => {
    if (element.getClientRects().length > 0) return ((element as HTMLElement).innerText || "").trim();
    const copy = element.cloneNode(true) as Element;
    for (const skip of Array.from(copy.querySelectorAll("script,style,noscript,[data-cv-ui]"))) skip.remove();
    return (copy.textContent || "").trim();
  };

  const renderBar = (): void => {
    if (bar) bar.remove();
    bar = null;
    if (filters.length === 0 || !doc.body) return;
    const next = doc.createElement("div");
    next.className = "cv-bar";
    next.setAttribute("data-cv-ui", "");
    for (const filter of filters) {
      const chip = doc.createElement("span");
      chip.className = "cv-chip";
      chip.appendChild(doc.createTextNode(filter));
      const close = doc.createElement("button");
      close.type = "button";
      close.title = "Tirar o filtro";
      close.textContent = "\u00d7";
      close.addEventListener("click", () => toggleFilter(filter));
      chip.appendChild(close);
      next.appendChild(chip);
    }
    doc.body.insertBefore(next, doc.body.firstChild);
    bar = next;
  };

  /** Texto do canvas e dos itens visíveis, para o painel montar o contexto do chat. */
  const sendDoc = (): void => {
    remove.remove();
    if (bar) bar.remove();
    bar = null;
    const items: Array<{ id: string; text: string }> = [];
    const seen = new Set<string>();
    for (const element of Array.from(doc.querySelectorAll("[data-canvas-item]"))) {
      const id = element.getAttribute("data-canvas-item") || "";
      if (id === "" || seen.has(id) || element.hasAttribute(HIDDEN) || items.length >= config.limits.items) continue;
      seen.add(id);
      items.push({ id, text: textOf(element).slice(0, config.limits.itemText) });
    }
    const text = (doc.body ? textOf(doc.body) : "").slice(0, config.limits.canvasText);
    renderBar();
    post({ k: "doc", text, items, y: win.scrollY });
  };

  const apply = (): void => {
    hideMatching();
    sendDoc();
  };

  const sendState = (): void => post({ k: "state", filters: filters.slice(), removed: Array.from(removed) });

  function toggleFilter(filter: string): void {
    const at = filters.indexOf(filter);
    if (at >= 0) filters.splice(at, 1);
    else if (filters.length < config.limits.filters) filters.push(filter);
    sendState();
    apply();
  }

  doc.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const link = target.closest("a[href]");
      if (link) {
        const raw = link.getAttribute("href") || "";
        // âncora na própria página: deixa o navegador rolar
        if (raw.charAt(0) !== "#") {
          event.preventDefault();
          post({ k: "link", url: (link as HTMLAnchorElement).href });
          return;
        }
      }
      const toggle = target.closest("[data-filter]");
      if (toggle && !target.closest("[data-cv-ui]")) {
        const value = toggle.getAttribute("data-filter") || "";
        if (value !== "") {
          event.preventDefault();
          toggleFilter(value);
        }
      }
    },
    true,
  );

  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = remove.getAttribute("data-id") || "";
    if (id === "") return;
    removed.add(id);
    sendState();
    apply();
  });

  doc.addEventListener("mouseover", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target === remove) return;
    const item = target.closest("[data-canvas-item]");
    if (!item || !doc.body) {
      remove.remove();
      return;
    }
    const box = item.getBoundingClientRect();
    remove.setAttribute("data-id", item.getAttribute("data-canvas-item") || "");
    remove.style.top = box.top + win.scrollY + 4 + "px";
    remove.style.left = box.right + win.scrollX - 24 + "px";
    doc.body.appendChild(remove);
  });

  // Rolagem: o painel guarda a posição para devolvê-la quando recarrega o canvas.
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let hadSelection = false;

  const sendSelection = (): void => {
    if (config.mode !== "panel") return;
    const selection = win.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
      if (hadSelection) post({ k: "sel", text: "" });
      hadSelection = false;
      return;
    }
    const range = selection.getRangeAt(0);
    const text = range.toString().slice(0, config.limits.itemText);
    const anchor = range.commonAncestorContainer;
    const element = anchor instanceof Element ? anchor : anchor.parentElement;
    if (text.trim() === "" || (element && element.closest("[data-cv-ui]"))) return;
    const found = element ? element.closest("[data-canvas-item]") : null;
    const links: Array<{ text: string; url: string }> = [];
    for (const link of Array.from(doc.querySelectorAll("a[href]"))) {
      if (links.length >= 20) break;
      if (range.intersectsNode(link)) links.push({ text: (link.textContent || "").slice(0, 200), url: (link as HTMLAnchorElement).href });
    }
    const box = range.getBoundingClientRect();
    hadSelection = true;
    post({
      k: "sel",
      text,
      itemId: found ? found.getAttribute("data-canvas-item") || "" : "",
      itemText: found ? textOf(found).slice(0, config.limits.itemText) : "",
      links,
      rect: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
    });
  };

  let selectionFrame = 0;
  const scheduleSelection = (): void => {
    if (selectionFrame) return;
    selectionFrame = win.requestAnimationFrame(() => {
      selectionFrame = 0;
      sendSelection();
    });
  };

  doc.addEventListener("selectionchange", scheduleSelection);
  win.addEventListener(
    "scroll",
    () => {
      if (hadSelection) scheduleSelection();
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => post({ k: "scroll", y: win.scrollY }), 150);
    },
    { passive: true },
  );

  const start = (): void => {
    apply();
    if (config.scroll > 0) win.scrollTo(0, config.scroll);
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
  // O JS do agente pode montar o conteúdo depois: reaplica e reenvia o texto quando tudo carregou.
  win.addEventListener("load", () => {
    apply();
    if (config.scroll > 0 && win.scrollY === 0) win.scrollTo(0, config.scroll);
  });
}
