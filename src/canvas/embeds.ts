// Partes incorporadas: HTML completo (com <style> e <script>) que o agente publica ao lado do
// canvas e que SÓ o painel desenha, dentro de um iframe `sandbox="allow-scripts"` (origem opaca,
// sem rede, sem disco, sem o OpenChamber). Aqui só se valida o formato — o conteúdo é entrada
// não confiável e nunca é interpretado fora do iframe.

import { LIMITS } from "../shared/contract.ts";

export type EmbedsResult = { ok: true; embeds: Record<string, string> } | { ok: false; message: string };

const EMBED_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Controles que não fazem sentido em HTML (tab, quebra de linha e retorno são válidos). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function isEmbedId(value: unknown): value is string {
  return typeof value === "string" && EMBED_ID.test(value);
}

/** Valida o que o agente enviou em `embeds` (lista de `{ id, html }`). Recusa por inteiro se algo estiver fora do contrato. */
export function parseEmbedsInput(value: unknown): EmbedsResult {
  if (value === undefined || value === null) return { ok: true, embeds: {} };
  if (!Array.isArray(value)) return { ok: false, message: "embeds deve ser uma lista de { id, html }" };
  if (value.length > LIMITS.embeds) return { ok: false, message: `mais de ${LIMITS.embeds} partes incorporadas` };
  const embeds: Record<string, string> = {};
  let total = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return { ok: false, message: "cada embed deve ser { id, html }" };
    const { id, html } = entry as { id?: unknown; html?: unknown };
    if (!isEmbedId(id)) return { ok: false, message: "id de embed inválido (use [a-z0-9][a-z0-9-], até 40)" };
    if (Object.hasOwn(embeds, id)) return { ok: false, message: `embed repetido: ${id}` };
    if (typeof html !== "string" || html.trim() === "") return { ok: false, message: `o embed ${id} está vazio` };
    if (html.length > LIMITS.embedChars) return { ok: false, message: `o embed ${id} passa de ${LIMITS.embedChars} caracteres` };
    if (CONTROL_CHARS.test(html)) return { ok: false, message: `caractere de controle no embed ${id}` };
    total += html.length;
    if (total > LIMITS.embedsTotalChars) return { ok: false, message: `os embeds passam de ${LIMITS.embedsTotalChars} caracteres no total` };
    embeds[id] = html;
  }
  return { ok: true, embeds };
}

/** Revalida o mapa já guardado (disco ou resposta do serviço); `null` se estiver corrompido. */
export function validateEmbeds(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).map(([id, html]) => ({ id, html }));
  const parsed = parseEmbedsInput(entries);
  return parsed.ok ? parsed.embeds : null;
}
