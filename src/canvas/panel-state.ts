// Estado puro do painel: dado o que o serviço respondeu, o que mostrar. Sem DOM,
// para ser testável. O painel revalida a árvore (segunda fronteira de confiança).

import { validateTree } from "./sanitize.ts";
import { SERVICE_VERSION, type CanvasError, type CanvasNode, type CanvasResponse } from "../shared/contract.ts";

export type PanelView =
  | { kind: "no-session" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "empty"; error: CanvasError | null }
  | { kind: "canvas"; title: string; updatedAt: number; tree: CanvasNode[]; blocked: string[]; error: CanvasError | null; outdatedService: boolean };

export function viewFromResponse(response: CanvasResponse | null): PanelView {
  if (!response) return { kind: "failed", message: "resposta do serviço inválida" };
  if (!response.ok) return { kind: "failed", message: response.error };
  if (!response.canvas) return { kind: "empty", error: response.error };
  const tree = validateTree(response.canvas.tree);
  if (!tree) return { kind: "failed", message: "o canvas guardado está corrompido e foi ignorado" };
  return {
    kind: "canvas",
    title: typeof response.canvas.title === "string" ? response.canvas.title : "",
    updatedAt: response.canvas.updatedAt,
    tree,
    blocked: Array.isArray(response.canvas.blocked) ? response.canvas.blocked.filter((note): note is string => typeof note === "string") : [],
    error: response.error,
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
