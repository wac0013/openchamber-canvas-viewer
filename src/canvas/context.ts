/**
 * Contexto que vai para o chat: transforma o canvas (ou um elemento marcável) em texto
 * estruturado e em chip nativo. Tudo aqui é puro e trabalha sobre a árvore já sanitizada:
 * o texto nunca contém marcação do agente, só o texto visível (RN3 / CA8).
 */

import type { AttachIssueRequest } from "@openchamber/sdk";

import { CHIP_PROVIDER_ID, CHIP_URL, LIMITS, TRUNCATED_NOTICE, type CanvasElement, type CanvasNode } from "../shared/contract.ts";

export type ContextTarget = { kind: "canvas" } | { kind: "item"; id: string };

export type ContextCanvas = { title: string; updatedAt: number; tree: readonly CanvasNode[] };

export type ContextChip = { chip: AttachIssueRequest; truncated: boolean };

const BLOCK_TAGS = new Set([
  "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "table", "caption",
  "thead", "tbody", "tfoot", "tr", "blockquote", "pre", "section", "article", "header", "footer",
  "figure", "figcaption", "details", "summary", "hr",
]);

/** Texto legível de um conjunto de nós: blocos em linhas, células separadas por " | ", itens de lista com "- ". */
export function plainText(nodes: readonly CanvasNode[]): string {
  let out = "";
  const lineBreak = (): void => {
    if (out !== "" && !out.endsWith("\n")) out += "\n";
  };
  const walk = (list: readonly CanvasNode[], inPre: boolean): void => {
    for (const node of list) {
      if (node.t === "text") {
        const value = inPre ? node.v : node.v.replace(/\s+/g, " ");
        out += !inPre && (out === "" || /[\n ]$/.test(out)) ? value.replace(/^ /, "") : value;
        continue;
      }
      const block = BLOCK_TAGS.has(node.tag);
      if (block) lineBreak();
      if (node.tag === "br") {
        out += "\n";
        continue;
      }
      if (node.tag === "li") out += "- ";
      const itemId = node.attrs["data-canvas-item"];
      if (itemId) out += `[#${itemId}] `;
      walk(node.c, inPre || node.tag === "pre");
      if ((node.tag === "td" || node.tag === "th") && !out.endsWith("\n")) out += " | ";
      if (block) lineBreak();
    }
  };
  walk(nodes, false);
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/ \|$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Acha o elemento marcável pelo id (ids são únicos por canvas). */
export function findItem(nodes: readonly CanvasNode[], id: string): CanvasElement | null {
  for (const node of nodes) {
    if (node.t !== "el") continue;
    if (node.attrs["data-canvas-item"] === id) return node;
    const inner = findItem(node.c, id);
    if (inner) return inner;
  }
  return null;
}

/** Ids dos elementos marcáveis, na ordem do documento. */
export function itemIds(nodes: readonly CanvasNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly CanvasNode[]): void => {
    for (const node of list) {
      if (node.t !== "el") continue;
      const id = node.attrs["data-canvas-item"];
      if (id) ids.push(id);
      walk(node.c);
    }
  };
  walk(nodes);
  return ids;
}

/** Corta no limite do composer e deixa o aviso no final; o aviso conta dentro do limite. */
export function truncateContext(text: string, max: number = LIMITS.itemTextChars): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max - TRUNCATED_NOTICE.length);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return { text: cut + TRUNCATED_NOTICE, truncated: true };
}

/** Monta o chip nativo; `null` quando o elemento pedido não existe mais no canvas. */
export function buildChip(canvas: ContextCanvas, target: ContextTarget): ContextChip | null {
  const title = canvas.title || "Canvas";
  if (target.kind === "canvas") {
    const body = [`Canvas: ${title}`, `Atualizado: ${new Date(canvas.updatedAt).toISOString()}`, "---", plainText(canvas.tree)].join("\n");
    const { text, truncated } = truncateContext(body);
    return {
      truncated,
      chip: { providerId: CHIP_PROVIDER_ID, id: "canvas", title, url: CHIP_URL, text, data: { v: 1, kind: "canvas" } },
    };
  }
  const item = findItem(canvas.tree, target.id);
  if (!item) return null;
  const body = [`Canvas: ${title}`, `Elemento: ${target.id}`, "---", plainText(item.c)].join("\n");
  const { text, truncated } = truncateContext(body);
  return {
    truncated,
    chip: { providerId: CHIP_PROVIDER_ID, id: `item-${target.id}`, title: `${title} › ${target.id}`, url: CHIP_URL, text, data: { v: 1, kind: "item", itemId: target.id } },
  };
}
