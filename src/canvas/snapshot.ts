// Monta o snapshot de um canvas a partir do que o agente publicou. Usado pelo plugin
// (feedback imediato ao agente) e pelo serviço (fronteira de confiança de verdade).

import { LIMITS, type CanvasSnapshot } from "../shared/contract.ts";
import { parseCanvasHtml } from "./sanitize.ts";

export type SnapshotResult = { ok: true; snapshot: CanvasSnapshot } | { ok: false; message: string };

export function buildSnapshot(title: unknown, html: unknown, now: number): SnapshotResult {
  const cleanTitle = typeof title === "string" ? title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, LIMITS.titleChars) : "";
  const parsed = parseCanvasHtml(html);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.tree.length === 0) return { ok: false, message: "o canvas está vazio" };
  return { ok: true, snapshot: { title: cleanTitle, updatedAt: now, tree: parsed.tree, blocked: parsed.blocked } };
}
