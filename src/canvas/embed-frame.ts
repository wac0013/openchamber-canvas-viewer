// Documento de uma parte incorporada e leitura das mensagens que ela devolve ao painel.
// Tudo puro (sem DOM): o painel só atribui o resultado a `iframe.srcdoc`.
//
// Fronteira de confiança: o HTML do agente roda num iframe `sandbox="allow-scripts"` (origem
// opaca: sem cookies, sem o OpenChamber, sem o painel) e com CSP que proíbe rede, iframes e
// formulários. A única saída é `postMessage`, e o painel só aceita dois formatos, ambos revalidados.

import { LIMITS } from "../shared/contract.ts";
import { cleanHref } from "./sanitize.ts";

/** Valor exato do atributo `sandbox` do iframe. Nunca inclui `allow-same-origin`, `allow-popups` nem `allow-forms`. */
export const EMBED_SANDBOX = "allow-scripts";

/** Variáveis de tema repassadas ao iframe; o agente as usa como `var(--oc-fg)` etc. */
export const EMBED_THEME_VARS = [
  "--oc-bg", "--oc-elevated", "--oc-fg", "--oc-muted", "--oc-subtle", "--oc-border",
  "--oc-primary", "--oc-primary-text", "--oc-success", "--oc-success-text", "--oc-warning", "--oc-warning-text",
  "--oc-error", "--oc-error-text", "--oc-info", "--oc-info-text", "--oc-font", "--oc-mono", "--oc-radius",
] as const;

/** Política do documento: tudo inline e `data:`; nada de rede, frames, formulários nem `<base>`. */
export const EMBED_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Valor de tema que pode entrar num `<style>` sem escapar dele. */
const SAFE_VALUE = /^[^<>{};\u0000-\u001f]{1,200}$/;

const BASE_CSS = [
  "html,body{margin:0;padding:0;background:transparent}",
  "body{display:flow-root;color:var(--oc-fg);font:13px/1.45 var(--oc-font,system-ui,sans-serif)}",
  "a{color:var(--oc-primary-text,var(--oc-primary))}",
  "code,pre{font-family:var(--oc-mono,monospace)}",
  ":root{--chart-1:var(--oc-primary-text,var(--oc-primary));--chart-2:var(--oc-success);--chart-3:var(--oc-warning);--chart-4:var(--oc-error);--chart-5:var(--oc-info);--chart-6:var(--oc-muted)}",
].join("");

/** Pontes do iframe para o painel: altura do conteúdo e cliques em links (o iframe não navega). */
const BRIDGE = `(function(){var P=window.parent;function send(k,v){try{P.postMessage({cvEmbed:1,k:k,v:v},"*")}catch(e){}}
function measure(){var b=document.body;if(b)send("h",Math.ceil(b.getBoundingClientRect().height))}
function start(){measure();if(typeof ResizeObserver==="function"&&document.body)new ResizeObserver(measure).observe(document.body)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
window.addEventListener("load",measure);
document.addEventListener("click",function(e){var t=e.target;var a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;e.preventDefault();send("l",a.href)},true);})();`;

/** `srcdoc` do iframe: CSP primeiro, tema e base, a ponte e só então o HTML do agente. */
export function buildEmbedDocument(html: string, theme: Readonly<Record<string, string>>, colorScheme: "light" | "dark"): string {
  const vars = EMBED_THEME_VARS.flatMap((name) => {
    const value = (theme[name] ?? "").trim();
    return SAFE_VALUE.test(value) ? [`${name}:${value}`] : [];
  });
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="${EMBED_CSP}">`,
    `<meta name="color-scheme" content="${colorScheme}">`,
    `<style>:root{color-scheme:${colorScheme};${vars.join(";")}}${BASE_CSS}</style>`,
    `<script>${BRIDGE}</script>`,
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}

export type EmbedMessage = { kind: "height"; value: number } | { kind: "link"; url: string };

const HEIGHT_MIN = 20;

/** Lê uma mensagem vinda do iframe. Qualquer coisa fora do formato é ignorada (`null`). */
export function readEmbedMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { cvEmbed?: unknown; k?: unknown; v?: unknown };
  if (message.cvEmbed !== 1) return null;
  if (message.k === "h") {
    if (typeof message.v !== "number" || !Number.isFinite(message.v)) return null;
    return { kind: "height", value: Math.min(LIMITS.embedHeightMax, Math.max(HEIGHT_MIN, Math.round(message.v))) };
  }
  if (message.k === "l" && typeof message.v === "string") {
    const url = cleanHref(message.v);
    return url ? { kind: "link", url } : null;
  }
  return null;
}

/** Cliques vindos do iframe só abrem links com gesto do usuário (ativação transitória) quando o navegador informa isso. */
export function hasUserGesture(nav: { userActivation?: { isActive: boolean } } | undefined): boolean {
  return nav?.userActivation ? nav.userActivation.isActive : true;
}
