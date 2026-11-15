/**
 * Monta o snapshot de um canvas a partir do que o agente publicou. Usado pelo plugin
 * (feedback imediato ao agente) e pelo serviço (fronteira de confiança de verdade).
 *
 * O snapshot só é aceito se o mesmo `validateTree` que o painel e o disco usam o aceitar:
 * assim nada que foi gravado pode ser recusado na leitura (o canvas nunca "some").
 */

import { LIMITS, type CanvasSnapshot } from "../shared/contract.ts";
import { parseCanvasHtml, validateTree } from "./sanitize.ts";

export type SnapshotResult = { ok: true; snapshot: CanvasSnapshot } | { ok: false; message: string };

const TITLE_STRIP = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

export function buildSnapshot(title: unknown, html: unknown, now: number): SnapshotResult {
  const cleanTitle = typeof title === "string" ? title.replace(TITLE_STRIP, " ").trim().slice(0, LIMITS.titleChars) : "";
  const parsed = parseCanvasHtml(html);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.tree.length === 0) return { ok: false, message: "o canvas está vazio" };
  const tree = validateTree(parsed.tree);
  if (!tree) return { ok: false, message: "o canvas excede os limites de estrutura" };
  return { ok: true, snapshot: { title: cleanTitle, updatedAt: now, tree, blocked: parsed.blocked } };
}
