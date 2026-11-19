// Estado puro do painel: dado o que o serviço respondeu, o que mostrar. Sem DOM, para ser testável.
// A resposta vem de um processo local mas o HTML dentro dela é de agente: aqui só se confere o
// formato; o conteúdo nunca é inserido no documento do painel (vai num iframe isolado).

import { LIMITS, SERVICE_VERSION, SESSION_ID_PATTERN, type InfoResponse } from "../shared/contract.ts";

export type PanelView =
  | { kind: "no-session" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "empty"; rootId: string; outdatedService: boolean }
  | { kind: "canvas"; rootId: string; title: string; html: string; updatedAt: number; outdatedService: boolean };

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 8.64e15;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Interpreta o corpo de `GET /canvas` do serviço. */
export function viewFromBody(body: string): PanelView {
  const value = parseJson(body);
  if (typeof value !== "object" || value === null) return { kind: "failed", message: "resposta do serviço inválida" };
  const record = value as { ok?: unknown; error?: unknown; rootId?: unknown; canvas?: unknown; version?: unknown };
  if (record.ok !== true) return { kind: "failed", message: typeof record.error === "string" ? record.error.slice(0, 200) : "resposta do serviço inválida" };
  if (typeof record.rootId !== "string" || !SESSION_ID_PATTERN.test(record.rootId)) return { kind: "failed", message: "resposta do serviço inválida" };
  const outdatedService = record.version !== SERVICE_VERSION;
  if (record.canvas === null || record.canvas === undefined) return { kind: "empty", rootId: record.rootId, outdatedService };
  const canvas = record.canvas as { title?: unknown; html?: unknown; updatedAt?: unknown };
  if (typeof canvas.html !== "string" || !isEpoch(canvas.updatedAt)) return { kind: "failed", message: "resposta do serviço inválida" };
  if (canvas.html.length > LIMITS.canvasBytes) return { kind: "failed", message: "canvas maior que o limite" };
  const title = typeof canvas.title === "string" ? canvas.title.slice(0, LIMITS.titleChars) : "";
  return { kind: "canvas", rootId: record.rootId, title, html: canvas.html, updatedAt: canvas.updatedAt, outdatedService };
}

/** Interpreta o corpo de `GET /info`: só um link http/https chega ao `host.openUrl`. */
export function infoFromBody(body: string, clean: (url: string) => string | null): string | null {
  const value = parseJson(body) as InfoResponse | null;
  if (!value || typeof value !== "object" || value.ok !== true || typeof value.url !== "string") return null;
  return clean(value.url);
}

/** O evento `canvas` do serviço só vale se trouxer um `rootId` válido. */
export function rootOfEvent(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const rootId = (data as { rootId?: unknown }).rootId;
  return typeof rootId === "string" && SESSION_ID_PATTERN.test(rootId) ? rootId : null;
}
