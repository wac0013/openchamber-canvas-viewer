// Desenho do canvas: constrói DOM só a partir da árvore já sanitizada (createElement /
// textContent). Nunca usa innerHTML com texto do agente.

import type { CanvasNode } from "../shared/contract.ts";

export function buildNodes(nodes: readonly CanvasNode[], doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const node of nodes) {
    if (node.t === "text") {
      fragment.append(doc.createTextNode(node.v));
      continue;
    }
    const element = doc.createElement(node.tag);
    for (const [name, value] of Object.entries(node.attrs)) {
      // Classes do agente ganham prefixo: não colidem com a interface do painel.
      if (name === "class") element.className = value.split(" ").map((token) => `cv-${token}`).join(" ");
      else element.setAttribute(name, value);
    }
    element.append(buildNodes(node.c, doc));
    fragment.append(element);
  }
  return fragment;
}

/** "14:03:22" no fuso do usuário. */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
