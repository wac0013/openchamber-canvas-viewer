// Estado da visão do canvas por sessão raiz (filtros ativos e itens removidos pelo usuário).
// Persistido em `host.storage` do painel, para sobreviver à troca de sessão e à recarga do iframe.
// O que volta do disco é entrada não confiável: é revalidado igual às mensagens do iframe.

import { FILTER_PATTERN, ITEM_ID_PATTERN, LIMITS, SESSION_ID_PATTERN } from "../shared/contract.ts";

export type ViewState = { filters: string[]; removed: string[] };

export const EMPTY_VIEW_STATE: ViewState = { filters: [], removed: [] };

/** Chave de armazenamento da visão de uma raiz; `null` se o id não for um id de sessão válido. */
export function viewStateKey(rootId: string): string | null {
  return SESSION_ID_PATTERN.test(rootId) ? `view:${rootId}` : null;
}

function clean(value: unknown, pattern: RegExp, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && pattern.test(entry) && !out.includes(entry)) out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

export function parseViewState(value: unknown): ViewState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { filters: [], removed: [] };
  const record = value as { filters?: unknown; removed?: unknown };
  return { filters: clean(record.filters, FILTER_PATTERN, LIMITS.filters), removed: clean(record.removed, ITEM_ID_PATTERN, LIMITS.items) };
}

export function isEmptyViewState(state: ViewState): boolean {
  return state.filters.length === 0 && state.removed.length === 0;
}
