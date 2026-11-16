// Estado puro do painel: dado o que o serviço respondeu, o que mostrar. Sem DOM,
// para ser testável. O painel revalida a árvore (segunda fronteira de confiança).

import { validateEmbeds } from "./embeds.ts";
import { validateTree } from "./sanitize.ts";
import { BLOCKED_NOTES_MAX, LIMITS, SERVICE_VERSION, type CanvasError, type CanvasNode, type CanvasResponse } from "../shared/contract.ts";

export type PanelView =
  | { kind: "no-session" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "empty"; error: CanvasError | null }
  | { kind: "canvas"; title: string; updatedAt: number; tree: CanvasNode[]; embeds: Record<string, string>; blocked: string[]; error: CanvasError | null; outdatedService: boolean };

export function viewFromResponse(response: CanvasResponse | null): PanelView {
  if (!response) return { kind: "failed", message: "resposta do serviço inválida" };
  if (!response.ok) return { kind: "failed", message: response.error };
  if (!response.canvas) return { kind: "empty", error: cleanError(response.error) };
  const tree = validateTree(response.canvas.tree);
  const updatedAt = response.canvas.updatedAt;
  const embeds = validateEmbeds(response.canvas.embeds);
  if (!tree || !embeds || !isEpoch(updatedAt)) return { kind: "failed", message: "o canvas guardado está corrompido e foi ignorado" };
  return {
    kind: "canvas",
    title: typeof response.canvas.title === "string" ? response.canvas.title.slice(0, LIMITS.titleChars) : "",
    updatedAt,
    tree,
    embeds,
    blocked: Array.isArray(response.canvas.blocked)
      ? response.canvas.blocked.filter((note): note is string => typeof note === "string").slice(0, BLOCKED_NOTES_MAX).map((note) => note.slice(0, 120))
      : [],
    error: cleanError(response.error),
    outdatedService: response.version !== SERVICE_VERSION,
  };
}

export function parseCanvasResponse(body: string): CanvasResponse | null {
  try {
    const value = JSON.parse(body) as CanvasResponse;
    return typeof value === "object" && value !== null && typeof value.ok === "boolean" ? value : null;
  } catch {
    return null;
  }
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 8.64e15;
}

function cleanError(value: unknown): CanvasError | null {
  if (typeof value !== "object" || value === null) return null;
  const error = value as { at?: unknown; message?: unknown };
  return isEpoch(error.at) && typeof error.message === "string" ? { at: error.at, message: error.message.slice(0, 300) } : null;
}
