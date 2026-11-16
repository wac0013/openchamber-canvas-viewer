// Filtro do painel (busca por texto + grupo). Lógica pura sobre a árvore já sanitizada: o agente só
// declara `data-canvas-item` nas linhas e `data-group` nos grupos; quem filtra é o painel, sem
// nenhum script vindo do agente.

import { LIMITS, type CanvasNode } from "../shared/contract.ts";
import { textOf } from "./sanitize.ts";

export type FilterItem = {
  id: string;
  /** Texto pesquisável em minúsculas (texto visível do item + grupo). */
  haystack: string;
  /** `data-group` do item ou do ancestral mais próximo; `null` se não houver. */
  group: string | null;
};

export type FilterState = { query: string; group: string };

export const NO_FILTER: FilterState = { query: "", group: "" };

const SEARCH_CHARS = 2000;

/** Itens filtráveis (`data-canvas-item`), na ordem do documento, com o grupo herdado do ancestral. */
export function collectFilterItems(tree: readonly CanvasNode[]): FilterItem[] {
  const items: FilterItem[] = [];
  const walk = (list: readonly CanvasNode[], inherited: string | null): void => {
    for (const node of list) {
      if (node.t !== "el") continue;
      const group = node.attrs["data-group"] ?? inherited;
      const id = node.attrs["data-canvas-item"];
      if (id) items.push({ id, haystack: `${textOf(node.c, SEARCH_CHARS)} ${group ?? ""}`.replace(/\s+/g, " ").toLowerCase(), group });
      walk(node.c, group);
    }
  };
  walk(tree, null);
  return items;
}

/** Grupos distintos, em ordem alfabética. */
export function groupsOf(items: readonly FilterItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.group ? [item.group] : [])))].sort((a, b) => a.localeCompare(b));
}

/** O filtro só aparece quando ajuda: itens suficientes ou mais de um grupo. */
export function shouldOfferFilter(items: readonly FilterItem[]): boolean {
  return items.length >= LIMITS.filterMinItems || groupsOf(items).length >= 2;
}

/** Todas as palavras da busca precisam aparecer (sem acento e sem diferenciar maiúsculas). */
export function matchesFilter(item: FilterItem, state: FilterState): boolean {
  if (state.group !== "" && item.group !== state.group) return false;
  const words = fold(state.query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(item.haystack);
  return words.every((word) => haystack.includes(word));
}

export function isFiltering(state: FilterState): boolean {
  return state.query.trim() !== "" || state.group !== "";
}

/** Ids visíveis com o filtro atual. */
export function visibleIds(items: readonly FilterItem[], state: FilterState): Set<string> {
  return new Set(items.filter((item) => matchesFilter(item, state)).map((item) => item.id));
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
