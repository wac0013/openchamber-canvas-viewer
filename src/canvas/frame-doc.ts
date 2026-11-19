// Documento do iframe do canvas e leitura das mensagens que ele devolve. Tudo puro (sem DOM):
// quem hospeda (painel ou página do navegador) só atribui o resultado a `iframe.srcdoc`.
//
// Fronteira de confiança: o HTML do agente roda num iframe `sandbox="allow-scripts"` (origem
// opaca: sem cookies, sem o OpenChamber, sem a casca) e com CSP que proíbe rede, iframes e
// formulários. A única saída é `postMessage`, e só passa o que `readCanvasMessage` reconhece.

import { FILTER_PATTERN, ITEM_ID_PATTERN, LIMITS } from "../shared/contract.ts";
import { canvasRuntime, type RuntimeConfig } from "../runtime/canvas-runtime.ts";
import { KIT_CSS } from "./kit.ts";
import { cleanHref } from "./links.ts";

/** Valor exato do atributo `sandbox` do iframe. Nunca inclui `allow-same-origin`, `allow-popups` nem `allow-forms`. */
export const FRAME_SANDBOX = "allow-scripts";

/** Variáveis de tema repassadas ao iframe; o agente as usa como `var(--oc-fg)` etc. */
export const THEME_VARS = [
  "--oc-bg", "--oc-elevated", "--oc-fg", "--oc-muted", "--oc-subtle", "--oc-border",
  "--oc-primary", "--oc-primary-text", "--oc-success", "--oc-success-text", "--oc-warning", "--oc-warning-text",
  "--oc-error", "--oc-error-text", "--oc-info", "--oc-info-text", "--oc-font", "--oc-mono", "--oc-radius",
] as const;

/** Tema da página do navegador (sem OpenChamber por perto): escuro, com as mesmas variáveis do painel. */
export const BROWSER_THEME: Readonly<Record<string, string>> = {
  "--oc-bg": "#16161a", "--oc-elevated": "#1f1f25", "--oc-fg": "#ececf1", "--oc-muted": "#9a9aa5", "--oc-subtle": "#2a2a31",
  "--oc-border": "#34343c", "--oc-primary": "#8ab4ff", "--oc-primary-text": "#8ab4ff", "--oc-success": "#3fb97a", "--oc-success-text": "#3fb97a",
  "--oc-warning": "#d9a441", "--oc-warning-text": "#d9a441", "--oc-error": "#e5646b", "--oc-error-text": "#e5646b",
  "--oc-info": "#5aa7e8", "--oc-info-text": "#5aa7e8", "--oc-font": "system-ui, sans-serif", "--oc-mono": "ui-monospace, monospace", "--oc-radius": "8px",
};

/** Política do documento: tudo inline e `data:`; nada de rede, frames, formulários nem `<base>`. */
export const FRAME_CSP = [
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
  "body{color:var(--oc-fg);font:13px/1.45 var(--oc-font,system-ui,sans-serif);padding:8px 10px 24px}",
  "a{color:var(--oc-primary-text,var(--oc-primary))}",
  "code,pre{font-family:var(--oc-mono,monospace)}",
  ":root{--chart-1:var(--oc-primary-text,var(--oc-primary));--chart-2:var(--oc-success);--chart-3:var(--oc-warning);--chart-4:var(--oc-error);--chart-5:var(--oc-info);--chart-6:var(--oc-muted)}",
].join("");

/** `<link data-kit ...>` no HTML do agente liga o kit (o iframe não carrega arquivos: o kit entra inline). */
const KIT_LINK = /<link\b[^>]*\sdata-kit(?=[\s=>/])[^>]*>/gi;
const KIT_LINK_TEST = new RegExp(KIT_LINK.source, "i");

export type FrameState = { filters: string[]; removed: string[]; scroll: number };

export type FrameOptions = {
  html: string;
  theme: Readonly<Record<string, string>>;
  colorScheme: "light" | "dark";
  mode: RuntimeConfig["mode"];
  state: FrameState;
};

/** JSON seguro para dentro de `<script>`: nada de `</script>`, `<!--` ou separadores de linha Unicode. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** `srcdoc` do iframe: CSP primeiro, tema e base, kit (se pedido), runtime e só então o HTML do agente. */
export function buildFrameDocument(options: FrameOptions): string {
  const vars = THEME_VARS.flatMap((name) => {
    const value = (options.theme[name] ?? "").trim();
    return SAFE_VALUE.test(value) ? [`${name}:${value}`] : [];
  });
  const wantsKit = KIT_LINK_TEST.test(options.html);
  const body = options.html.replace(KIT_LINK, "");
  const config: RuntimeConfig = {
    mode: options.mode,
    filters: options.state.filters,
    removed: options.state.removed,
    scroll: Math.max(0, Math.round(options.state.scroll) || 0),
    limits: { items: LIMITS.items, itemText: LIMITS.itemTextChars, canvasText: LIMITS.canvasTextChars, filters: LIMITS.filters },
  };
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`,
    `<meta name="color-scheme" content="${options.colorScheme}">`,
    `<style>:root{${vars.join(";")}}${BASE_CSS}</style>`,
    ...(wantsKit ? [`<style>${KIT_CSS}</style>`] : []),
    `<script>(${canvasRuntime.toString()})(${jsonForScript(config)},window)</script>`,
    "</head><body>",
    body,
  ].join("");
}

// ---------------------------------------------------------------------------------------------
// Mensagens do iframe → quem hospeda

export type FrameItem = { id: string; text: string };
export type FrameLink = { text: string; url: string };
export type FrameRect = { top: number; bottom: number; left: number; right: number };

export type FrameMessage =
  | { kind: "doc"; text: string; items: FrameItem[]; y: number }
  | { kind: "state"; filters: string[]; removed: string[] }
  | { kind: "link"; url: string }
  | { kind: "scroll"; y: number }
  | { kind: "selection-clear" }
  | { kind: "selection"; text: string; itemId: string | null; itemText: string; links: FrameLink[]; rect: FrameRect };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, min = -1e7, max = 1e7): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function readItems(value: unknown): FrameItem[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.items) return null;
  const items: FrameItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.text !== "string") return null;
    if (!ITEM_ID_PATTERN.test(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    items.push({ id: entry.id, text: entry.text.slice(0, LIMITS.itemTextChars) });
  }
  return items;
}

function readList(value: unknown, pattern: RegExp): string[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.filters * 10) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !pattern.test(entry)) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

function readLinks(value: unknown): FrameLink[] {
  if (!Array.isArray(value)) return [];
  const links: FrameLink[] = [];
  for (const entry of value.slice(0, 20)) {
    if (!isRecord(entry) || typeof entry.url !== "string") continue;
    const url = cleanHref(entry.url);
    if (url) links.push({ url, text: typeof entry.text === "string" ? entry.text.slice(0, 200) : "" });
  }
  return links;
}

/** Valida uma mensagem do iframe pelo formato e pelos tamanhos; qualquer outra coisa vira `null`. */
export function readCanvasMessage(data: unknown): FrameMessage | null {
  if (!isRecord(data) || data.cvCanvas !== 1) return null;
  switch (data.k) {
    case "doc": {
      const items = readItems(data.items);
      const y = finite(data.y, 0);
      if (typeof data.text !== "string" || !items || y === null) return null;
      return { kind: "doc", text: data.text.slice(0, LIMITS.canvasTextChars), items, y };
    }
    case "state": {
      const filters = readList(data.filters, FILTER_PATTERN)?.slice(0, LIMITS.filters);
      const removed = readList(data.removed, ITEM_ID_PATTERN)?.slice(0, LIMITS.items);
      return filters && removed ? { kind: "state", filters, removed } : null;
    }
    case "link": {
      const url = typeof data.url === "string" ? cleanHref(data.url) : null;
      return url ? { kind: "link", url } : null;
    }
    case "scroll": {
      const y = finite(data.y, 0);
      return y === null ? null : { kind: "scroll", y };
    }
    case "sel": {
      if (typeof data.text !== "string") return null;
      if (data.text === "") return { kind: "selection-clear" };
      const rect = isRecord(data.rect) ? data.rect : null;
      const top = finite(rect?.top);
      const bottom = finite(rect?.bottom);
      const left = finite(rect?.left);
      const right = finite(rect?.right);
      if (top === null || bottom === null || left === null || right === null) return null;
      const itemId = typeof data.itemId === "string" && ITEM_ID_PATTERN.test(data.itemId) ? data.itemId : null;
      return {
        kind: "selection",
        text: data.text.slice(0, LIMITS.itemTextChars),
        itemId,
        itemText: itemId && typeof data.itemText === "string" ? data.itemText.slice(0, LIMITS.itemTextChars) : "",
        links: readLinks(data.links),
        rect: { top, bottom, left, right },
      };
    }
    default:
      return null;
  }
}

/** Cliques vindos do iframe só abrem links com gesto do usuário (ativação transitória) quando o navegador informa isso. */
export function hasUserGesture(nav: { userActivation?: { isActive: boolean } } | undefined): boolean {
  return nav?.userActivation ? nav.userActivation.isActive : true;
}
