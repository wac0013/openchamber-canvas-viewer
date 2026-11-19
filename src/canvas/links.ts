// Único validador de links do projeto. O canvas é HTML livre de agente: todo link que sai dele
// (clique, trecho selecionado, abrir no navegador) passa por aqui antes de virar `host.openUrl`.

import { LIMITS } from "../shared/contract.ts";

const HREF_FORBIDDEN = /[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

/**
 * Link aceito: só `http:`/`https:`, sem credenciais, sem espaço/controle/bidi e até `hrefChars`.
 * Devolve a forma normalizada (host em punycode, escapes) ou `null`. Idempotente.
 */
export function cleanHref(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || value.length > LIMITS.hrefChars || HREF_FORBIDDEN.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.hostname === "") return null;
  return url.href.length <= LIMITS.hrefChars ? url.href : null;
}
