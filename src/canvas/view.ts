/**
 * Desenho do canvas: constrói DOM só a partir da árvore já sanitizada (createElement /
 * textContent). Nunca usa innerHTML com texto do agente.
 */

import type { CanvasNode } from "../shared/contract.ts";

/** Chamado uma vez para cada elemento marcável criado; só esses elementos recebem ações (RN2). */
export type ItemHook = (element: HTMLElement, id: string) => void;

/**
 * Parte incorporada: recebe o id e a altura fixa pedida (ou `null`) e devolve o nó que a representa
 * (o iframe isolado), ou `null` para cair no texto de reserva do elemento.
 */
export type EmbedHook = (id: string, height: number | null) => HTMLElement | null;

export type BuildHooks = { onItem?: ItemHook; embed?: EmbedHook };

/** Atributo do DOM com o destino do link. Nunca vira `href`: o clique é tratado pelo painel (`host.openUrl`). */
export const LINK_ATTRIBUTE = "data-href";

/**
 * Classes do agente ganham o prefixo `cv-`: não colidem com a interface do painel (`ui-*`).
 * O prefixo `oc-` (vocabulário do render nativo do OpenChamber) vira o mesmo nome: `oc-box` = `box`.
 */
export function mapClass(token: string): string {
  return `cv-${token.startsWith("oc-") && token.length > 3 ? token.slice(3) : token}`;
}

export function buildNodes(nodes: readonly CanvasNode[], doc: Document = document, hooks: BuildHooks = {}): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const node of nodes) {
    if (node.t === "text") {
      fragment.append(doc.createTextNode(node.v));
      continue;
    }

    const embedId = node.attrs["data-embed"];
    if (embedId && hooks.embed) {
      const height = node.attrs["data-height"];
      const frame = hooks.embed(embedId, height ? Number(height) : null);
      if (frame) {
        fragment.append(frame);
        continue;
      }
    }

    const element = doc.createElement(node.tag);
    for (const [name, value] of Object.entries(node.attrs)) {
      if (name === "class") element.className = value.split(" ").map(mapClass).join(" ");
      else if (name === "href") {
        element.setAttribute(LINK_ATTRIBUTE, value);
        element.setAttribute("role", "link");
        element.setAttribute("tabindex", "0");
        if (!node.attrs.title) element.setAttribute("title", value);
      } else if (name === "title" && node.attrs.href) element.setAttribute("title", `${value}\n${node.attrs.href}`);
      else if (name === "data-value") {
        element.setAttribute(name, value);
        element.style.setProperty("--value", `${value}%`);
        element.style.setProperty("--n", value);
      } else element.setAttribute(name, value);
    }
    element.append(buildNodes(node.c, doc, hooks));
    const itemId = node.attrs["data-canvas-item"];
    if (itemId && hooks.onItem) hooks.onItem(element, itemId);
    fragment.append(element);
  }
  return fragment;
}

/** "14:03:22" no fuso do usuário. */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
