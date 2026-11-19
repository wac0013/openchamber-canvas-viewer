// server/main.ts
import http from "node:http";
import { readFile as readFile3, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";

// src/shared/contract.ts
var SERVICE_VERSION = 4;
var SERVER_PORT = 57130;
var LIMITS = {
  titleChars: 120,
  /** Tamanho máximo do arquivo de canvas livre, em bytes (1 MB). */
  canvasBytes: 1e6,
  /** Quantidade de itens marcáveis (`data-canvas-item`) lidos do canvas. */
  items: 200,
  /** Texto máximo de um item marcável (limite do `host.attach`). */
  itemTextChars: 16e3,
  /** Texto máximo do canvas inteiro que o runtime devolve ao painel. */
  canvasTextChars: 2e5,
  /** Tamanho máximo de um link (`href`). */
  hrefChars: 2048,
  /** Filtros ativos e itens removidos guardados por canvas. */
  filters: 20
};
var SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
var ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
var FILTER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}:[A-Za-z0-9_.-]{1,40}$/;
var UPDATE_REQUEST_MARKER = "[Painel Canvas \xB7 Atualizar]";
var UPDATE_REQUEST_TEXT = `${UPDATE_REQUEST_MARKER} Atualize agora o canvas desta conversa: publique de novo com canvas_publish, refletindo o estado atual do trabalho e mantendo os mesmos ids de elemento. N\xE3o repita a visualiza\xE7\xE3o no chat; responda s\xF3 com um resumo curto do que mudou.`;

// src/shared/paths.ts
import os from "node:os";
import path from "node:path";
function canvasHome(env = process.env) {
  if (env.OPENCHAMBER_CANVAS_HOME) return env.OPENCHAMBER_CANVAS_HOME;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "openchamber-canvas");
}
function safeId(id) {
  if (!SESSION_ID_PATTERN.test(id)) throw new Error("id de sess\xE3o inv\xE1lido");
  return id;
}
function sessionsDir(env = process.env) {
  return path.join(canvasHome(env), "sessions");
}
function aliasesDir(env = process.env) {
  return path.join(canvasHome(env), "aliases");
}
function sessionDir(rootId, env = process.env) {
  return path.join(sessionsDir(env), safeId(rootId));
}
function canvasFile(rootId, env = process.env) {
  return path.join(sessionDir(rootId, env), "index.html");
}
function metaFile(rootId, env = process.env) {
  return path.join(sessionDir(rootId, env), "meta.json");
}
function aliasFile(sessionId, env = process.env) {
  return path.join(aliasesDir(env), safeId(sessionId));
}
function serverFile(env = process.env) {
  return path.join(canvasHome(env), "server.json");
}
function tokenFile(env = process.env) {
  return path.join(canvasHome(env), "token");
}

// src/shared/token.ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
var TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
function isValidToken(value) {
  return TOKEN_PATTERN.test(value);
}
async function readToken(env = process.env) {
  try {
    const value = (await readFile(tokenFile(env), "utf8")).trim();
    return isValidToken(value) ? value : null;
  } catch {
    return null;
  }
}
async function ensureToken(env = process.env) {
  const existing = await readToken(env);
  if (existing) return existing;
  await mkdir(canvasHome(env), { recursive: true, mode: 448 });
  const fresh = randomBytes(32).toString("base64url");
  const temp = `${tokenFile(env)}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await writeFile(temp, `${fresh}
`, { encoding: "utf8", mode: 384 });
  try {
    await link(temp, tokenFile(env));
    return fresh;
  } catch {
    const winner = await readToken(env);
    if (winner) return winner;
    await rename(temp, tokenFile(env));
    return fresh;
  } finally {
    await unlink(temp).catch(() => {
    });
  }
}
function sameToken(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// server/routes.ts
import { mkdir as mkdir2, readdir, readFile as readFile2, rm, stat } from "node:fs/promises";

// src/runtime/canvas-runtime.ts
function canvasRuntime(config, win) {
  const doc = win.document;
  const HIDDEN = "data-cv-hidden";
  const filters = config.filters.slice(0, config.limits.filters);
  const removed = new Set(config.removed);
  const post = (message) => {
    try {
      win.parent.postMessage({ cvCanvas: 1, ...message }, "*");
    } catch {
    }
  };
  const style = doc.createElement("style");
  style.textContent = "[" + HIDDEN + "]{display:none!important}.cv-bar{position:sticky;top:0;z-index:2147483646;display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px;background:var(--oc-elevated,#222);border-bottom:1px solid var(--oc-border,#444);font:12px system-ui,sans-serif;color:var(--oc-fg,#eee)}.cv-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 8px;border:1px solid var(--oc-border,#444);border-radius:999px}.cv-chip button,.cv-x{font:inherit;color:inherit;background:transparent;border:0;cursor:pointer;padding:0 4px}.cv-x{position:absolute;z-index:2147483647;width:20px;height:20px;line-height:18px;text-align:center;border:1px solid var(--oc-border,#444);border-radius:50%;background:var(--oc-elevated,#222);padding:0}[data-filter]{cursor:pointer}";
  (doc.head || doc.documentElement).appendChild(style);
  const remove = doc.createElement("button");
  remove.className = "cv-x";
  remove.setAttribute("data-cv-ui", "");
  remove.type = "button";
  remove.title = "Remover do canvas";
  remove.textContent = "\xD7";
  let bar = null;
  const itemId = (element) => {
    const found = element ? element.closest("[data-canvas-item]") : null;
    return found ? found.getAttribute("data-canvas-item") || "" : "";
  };
  const hideMatching = () => {
    for (const element of Array.from(doc.querySelectorAll("[data-canvas-item],[data-tags]"))) {
      const id = element.getAttribute("data-canvas-item") || "";
      const tokens = (element.getAttribute("data-tags") || "").split(/\s+/);
      const hide = id !== "" && removed.has(id) || element.hasAttribute("data-tags") && filters.some((filter) => tokens.indexOf(filter) < 0);
      if (hide) element.setAttribute(HIDDEN, "");
      else element.removeAttribute(HIDDEN);
    }
  };
  const textOf = (element) => {
    if (element.getClientRects().length > 0) return (element.innerText || "").trim();
    const copy = element.cloneNode(true);
    for (const skip of Array.from(copy.querySelectorAll("script,style,noscript,[data-cv-ui]"))) skip.remove();
    return (copy.textContent || "").trim();
  };
  const renderBar = () => {
    if (bar) bar.remove();
    bar = null;
    if (filters.length === 0 || !doc.body) return;
    const next = doc.createElement("div");
    next.className = "cv-bar";
    next.setAttribute("data-cv-ui", "");
    for (const filter of filters) {
      const chip = doc.createElement("span");
      chip.className = "cv-chip";
      chip.appendChild(doc.createTextNode(filter));
      const close = doc.createElement("button");
      close.type = "button";
      close.title = "Tirar o filtro";
      close.textContent = "\xD7";
      close.addEventListener("click", () => toggleFilter(filter));
      chip.appendChild(close);
      next.appendChild(chip);
    }
    doc.body.insertBefore(next, doc.body.firstChild);
    bar = next;
  };
  const sendDoc = () => {
    remove.remove();
    if (bar) bar.remove();
    bar = null;
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    for (const element of Array.from(doc.querySelectorAll("[data-canvas-item]"))) {
      const id = element.getAttribute("data-canvas-item") || "";
      if (id === "" || seen.has(id) || element.hasAttribute(HIDDEN) || items.length >= config.limits.items) continue;
      seen.add(id);
      items.push({ id, text: textOf(element).slice(0, config.limits.itemText) });
    }
    const text = (doc.body ? textOf(doc.body) : "").slice(0, config.limits.canvasText);
    renderBar();
    post({ k: "doc", text, items, y: win.scrollY });
  };
  const apply = () => {
    hideMatching();
    sendDoc();
  };
  const sendState = () => post({ k: "state", filters: filters.slice(), removed: Array.from(removed) });
  function toggleFilter(filter) {
    const at = filters.indexOf(filter);
    if (at >= 0) filters.splice(at, 1);
    else if (filters.length < config.limits.filters) filters.push(filter);
    sendState();
    apply();
  }
  doc.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const link2 = target.closest("a[href]");
      if (link2) {
        const raw = link2.getAttribute("href") || "";
        if (raw.charAt(0) !== "#") {
          event.preventDefault();
          post({ k: "link", url: link2.href });
          return;
        }
      }
      const toggle = target.closest("[data-filter]");
      if (toggle && !target.closest("[data-cv-ui]")) {
        const value = toggle.getAttribute("data-filter") || "";
        if (value !== "") {
          event.preventDefault();
          toggleFilter(value);
        }
      }
    },
    true
  );
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = remove.getAttribute("data-id") || "";
    if (id === "") return;
    removed.add(id);
    sendState();
    apply();
  });
  doc.addEventListener("mouseover", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target === remove) return;
    const item = target.closest("[data-canvas-item]");
    if (!item || !doc.body) {
      remove.remove();
      return;
    }
    const box = item.getBoundingClientRect();
    remove.setAttribute("data-id", item.getAttribute("data-canvas-item") || "");
    remove.style.top = box.top + win.scrollY + 4 + "px";
    remove.style.left = box.right + win.scrollX - 24 + "px";
    doc.body.appendChild(remove);
  });
  let scrollTimer;
  let hadSelection = false;
  const sendSelection = () => {
    if (config.mode !== "panel") return;
    const selection = win.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
      if (hadSelection) post({ k: "sel", text: "" });
      hadSelection = false;
      return;
    }
    const range = selection.getRangeAt(0);
    const text = range.toString().slice(0, config.limits.itemText);
    const anchor = range.commonAncestorContainer;
    const element = anchor instanceof Element ? anchor : anchor.parentElement;
    if (text.trim() === "" || element && element.closest("[data-cv-ui]")) return;
    const found = element ? element.closest("[data-canvas-item]") : null;
    const links = [];
    for (const link2 of Array.from(doc.querySelectorAll("a[href]"))) {
      if (links.length >= 20) break;
      if (range.intersectsNode(link2)) links.push({ text: (link2.textContent || "").slice(0, 200), url: link2.href });
    }
    const box = range.getBoundingClientRect();
    hadSelection = true;
    post({
      k: "sel",
      text,
      itemId: found ? found.getAttribute("data-canvas-item") || "" : "",
      itemText: found ? textOf(found).slice(0, config.limits.itemText) : "",
      links,
      rect: { top: box.top, bottom: box.bottom, left: box.left, right: box.right }
    });
  };
  let selectionFrame = 0;
  const scheduleSelection = () => {
    if (selectionFrame) return;
    selectionFrame = win.requestAnimationFrame(() => {
      selectionFrame = 0;
      sendSelection();
    });
  };
  doc.addEventListener("selectionchange", scheduleSelection);
  win.addEventListener(
    "scroll",
    () => {
      if (hadSelection) scheduleSelection();
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => post({ k: "scroll", y: win.scrollY }), 150);
    },
    { passive: true }
  );
  const start = () => {
    apply();
    if (config.scroll > 0) win.scrollTo(0, config.scroll);
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
  win.addEventListener("load", () => {
    apply();
    if (config.scroll > 0 && win.scrollY === 0) win.scrollTo(0, config.scroll);
  });
}

// src/canvas/kit.ts
var KIT_CSS = `
:root{--ck-bg:var(--oc-bg,#16161a);--ck-elevated:var(--oc-elevated,#1f1f25);--ck-fg:var(--oc-fg,#ececf1);--ck-muted:var(--oc-muted,#9a9aa5);--ck-border:var(--oc-border,#34343c);--ck-primary:var(--oc-primary-text,var(--oc-primary,#8ab4ff));--ck-success:var(--oc-success,#3fb97a);--ck-warning:var(--oc-warning,#d9a441);--ck-error:var(--oc-error,#e5646b);--ck-info:var(--oc-info,#5aa7e8);--ck-radius:var(--oc-radius,8px);--ck-gap:10px}
.ck-card{background:var(--ck-elevated);border:1px solid var(--ck-border);border-radius:var(--ck-radius);padding:10px 12px;margin:0 0 var(--ck-gap)}
.ck-card>h1,.ck-card>h2,.ck-card>h3{margin:0 0 6px;font-size:13px}
.ck-grid{display:grid;gap:var(--ck-gap);grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin:0 0 var(--ck-gap)}
.ck-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ck-muted{color:var(--ck-muted)}
.ck-mono{font-family:var(--oc-mono,monospace)}
.ck-table{width:100%;border-collapse:collapse;margin:0 0 var(--ck-gap)}
.ck-table th,.ck-table td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--ck-border);vertical-align:top}
.ck-table th{color:var(--ck-muted);font-weight:600;font-size:12px}
.ck-badge{display:inline-block;padding:0 8px;border:1px solid var(--ck-border);border-radius:999px;font-size:11px;line-height:18px;color:var(--ck-muted)}
.ck-badge[data-tone=success]{color:var(--ck-success);border-color:var(--ck-success)}
.ck-badge[data-tone=warning]{color:var(--ck-warning);border-color:var(--ck-warning)}
.ck-badge[data-tone=error]{color:var(--ck-error);border-color:var(--ck-error)}
.ck-badge[data-tone=info]{color:var(--ck-info);border-color:var(--ck-info)}
.ck-stat{display:flex;flex-direction:column;gap:2px}
.ck-stat-value{font-size:22px;font-weight:600;line-height:1.1}
.ck-stat-label{font-size:11px;color:var(--ck-muted)}
.ck-steps{list-style:none;margin:0 0 var(--ck-gap);padding:0;display:flex;flex-direction:column;gap:6px}
.ck-step{display:flex;gap:8px;align-items:flex-start;padding:6px 10px;border:1px solid var(--ck-border);border-left:3px solid var(--ck-border);border-radius:var(--ck-radius);background:var(--ck-elevated)}
.ck-step[data-tone=success]{border-left-color:var(--ck-success)}
.ck-step[data-tone=warning]{border-left-color:var(--ck-warning)}
.ck-step[data-tone=error]{border-left-color:var(--ck-error)}
.ck-step[data-tone=info]{border-left-color:var(--ck-info)}
.ck-bar{height:8px;background:var(--ck-border);border-radius:999px;overflow:hidden}
.ck-bar>span{display:block;height:100%;width:var(--value,0%);background:var(--ck-primary)}
.ck-bar[data-tone=success]>span{background:var(--ck-success)}
.ck-bar[data-tone=warning]>span{background:var(--ck-warning)}
.ck-bar[data-tone=error]>span{background:var(--ck-error)}
.ck-chart-bars{display:flex;flex-direction:column;gap:6px;margin:0 0 var(--ck-gap)}
.ck-chart-bars>div{display:grid;grid-template-columns:minmax(80px,25%) 1fr auto;gap:8px;align-items:center}
.ck-timeline{list-style:none;margin:0 0 var(--ck-gap);padding:0 0 0 14px;border-left:2px solid var(--ck-border)}
.ck-timeline>li{position:relative;padding:0 0 10px 10px}
.ck-timeline>li::before{content:"";position:absolute;left:-20px;top:5px;width:8px;height:8px;border-radius:50%;background:var(--ck-primary)}
.ck-chip{display:inline-block;padding:1px 10px;border:1px solid var(--ck-border);border-radius:999px;font-size:12px}
[data-filter].ck-chip:hover{border-color:var(--ck-primary)}
`.trim();

// src/canvas/frame-doc.ts
var THEME_VARS = [
  "--oc-bg",
  "--oc-elevated",
  "--oc-fg",
  "--oc-muted",
  "--oc-subtle",
  "--oc-border",
  "--oc-primary",
  "--oc-primary-text",
  "--oc-success",
  "--oc-success-text",
  "--oc-warning",
  "--oc-warning-text",
  "--oc-error",
  "--oc-error-text",
  "--oc-info",
  "--oc-info-text",
  "--oc-font",
  "--oc-mono",
  "--oc-radius"
];
var BROWSER_THEME = {
  "--oc-bg": "#16161a",
  "--oc-elevated": "#1f1f25",
  "--oc-fg": "#ececf1",
  "--oc-muted": "#9a9aa5",
  "--oc-subtle": "#2a2a31",
  "--oc-border": "#34343c",
  "--oc-primary": "#8ab4ff",
  "--oc-primary-text": "#8ab4ff",
  "--oc-success": "#3fb97a",
  "--oc-success-text": "#3fb97a",
  "--oc-warning": "#d9a441",
  "--oc-warning-text": "#d9a441",
  "--oc-error": "#e5646b",
  "--oc-error-text": "#e5646b",
  "--oc-info": "#5aa7e8",
  "--oc-info-text": "#5aa7e8",
  "--oc-font": "system-ui, sans-serif",
  "--oc-mono": "ui-monospace, monospace",
  "--oc-radius": "8px"
};
var FRAME_CSP = [
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
  "base-uri 'none'"
].join("; ");
var SAFE_VALUE = /^[^<>{};\u0000-\u001f]{1,200}$/;
var BASE_CSS = [
  "html,body{margin:0;padding:0;background:transparent}",
  "body{color:var(--oc-fg);font:13px/1.45 var(--oc-font,system-ui,sans-serif);padding:8px 10px 24px}",
  "a{color:var(--oc-primary-text,var(--oc-primary))}",
  "code,pre{font-family:var(--oc-mono,monospace)}",
  ":root{--chart-1:var(--oc-primary-text,var(--oc-primary));--chart-2:var(--oc-success);--chart-3:var(--oc-warning);--chart-4:var(--oc-error);--chart-5:var(--oc-info);--chart-6:var(--oc-muted)}"
].join("");
var KIT_LINK = /<link\b[^>]*\sdata-kit(?=[\s=>/])[^>]*>/gi;
var KIT_LINK_TEST = new RegExp(KIT_LINK.source, "i");
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function buildFrameDocument(options) {
  const vars = THEME_VARS.flatMap((name) => {
    const value = (options.theme[name] ?? "").trim();
    return SAFE_VALUE.test(value) ? [`${name}:${value}`] : [];
  });
  const wantsKit = KIT_LINK_TEST.test(options.html);
  const body = options.html.replace(KIT_LINK, "");
  const config = {
    mode: options.mode,
    filters: options.state.filters,
    removed: options.state.removed,
    scroll: Math.max(0, Math.round(options.state.scroll) || 0),
    limits: { items: LIMITS.items, itemText: LIMITS.itemTextChars, canvasText: LIMITS.canvasTextChars, filters: LIMITS.filters }
  };
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`,
    `<meta name="color-scheme" content="${options.colorScheme}">`,
    `<style>:root{${vars.join(";")}}${BASE_CSS}</style>`,
    ...wantsKit ? [`<style>${KIT_CSS}</style>`] : [],
    `<script>(${canvasRuntime.toString()})(${jsonForScript(config)},window)</script>`,
    "</head><body>",
    body
  ].join("");
}

// src/canvas/view-state.ts
function clean(value, pattern, max) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry === "string" && pattern.test(entry) && !out.includes(entry)) out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}
function parseViewState(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { filters: [], removed: [] };
  const record = value;
  return { filters: clean(record.filters, FILTER_PATTERN, LIMITS.filters), removed: clean(record.removed, ITEM_ID_PATTERN, LIMITS.items) };
}

// server/page.ts
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var BASE_STYLE = "body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#111;color:#eee}a{color:#8ab4ff}main{max-width:720px;margin:0 auto;padding:24px}li{margin:6px 0}small{color:#999}";
function indexPage(items) {
  const rows = items.map((item) => `<li><a href="/s/${encodeURIComponent(item.rootId)}">${escapeHtml(item.title || item.rootId)}</a> <small>${escapeHtml(new Date(item.updatedAt).toISOString())}</small></li>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas</title><style>${BASE_STYLE}</style><main><h1>Canvas</h1><ul>${rows || "<li><small>Nenhum canvas ainda.</small></li>"}</ul></main>`;
}
function shellPage(rootId) {
  const id = JSON.stringify(rootId).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas</title>
<style>html,body{margin:0;height:100%;background:#16161a;color:#ececf1;font:13px system-ui,sans-serif}
#bar{display:flex;gap:10px;align-items:center;padding:6px 12px;border-bottom:1px solid #34343c;height:20px}
#bar h1{font-size:13px;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bar a,#bar button{color:#8ab4ff;background:none;border:0;font:inherit;cursor:pointer;text-decoration:none;padding:0}
#bar time{color:#9a9aa5}
#stage{position:relative;height:calc(100% - 33px)}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}
iframe.loading{visibility:hidden}
#empty{position:absolute;inset:0;padding:40px 12px;text-align:center;color:#9a9aa5}</style>
<div id="bar"><a href="/">Canvases</a><h1 id="t">Canvas</h1><time id="u"></time><button id="r" hidden>Restaurar</button></div>
<div id="stage"><div id="empty">Carregando\u2026</div></div>
<script>
const id=${id};
const KEY="cv:"+id;
const stage=document.getElementById("stage");
const empty=document.getElementById("empty");
const restore=document.getElementById("r");
let state={filters:[],removed:[]};
try{const v=JSON.parse(localStorage.getItem(KEY)||"null");if(v&&Array.isArray(v.filters)&&Array.isArray(v.removed))state={filters:v.filters.filter(x=>typeof x==="string").slice(0,20),removed:v.removed.filter(x=>typeof x==="string").slice(0,200)};}catch{}
let scroll=0,current=null,pending=null,seq=0;
function syncRestore(){restore.hidden=!(state.filters.length||state.removed.length);}
function save(){try{if(state.filters.length||state.removed.length)localStorage.setItem(KEY,JSON.stringify(state));else localStorage.removeItem(KEY);}catch{}syncRestore();}
function safeUrl(raw){try{const u=new URL(String(raw));return(u.protocol==="https:"||u.protocol==="http:")&&!u.username&&!u.password?u.href:null;}catch{return null;}}
async function load(){
  const mine=++seq;
  let j;
  try{
    const r=await fetch("/frame?session="+encodeURIComponent(id)+"&state="+encodeURIComponent(JSON.stringify({filters:state.filters,removed:state.removed}))+"&scroll="+Math.round(scroll),{credentials:"same-origin"});
    j=await r.json();
  }catch{return;}
  if(mine!==seq||!j||!j.ok)return;
  if(!j.srcdoc){if(current)current.remove();current=null;if(pending)pending.remove();pending=null;empty.textContent="Nenhum canvas ainda nesta conversa.";empty.hidden=false;document.title="Canvas";return;}
  document.title=j.title||"Canvas";
  document.getElementById("t").textContent=j.title||"Canvas";
  document.getElementById("u").textContent=new Date(j.updatedAt).toLocaleTimeString();
  if(pending)pending.remove();
  const f=document.createElement("iframe");
  f.className="loading";
  f.setAttribute("sandbox","allow-scripts");
  f.srcdoc=j.srcdoc;
  pending=f;
  stage.appendChild(f);
}
window.addEventListener("message",(e)=>{
  const fromPending=pending&&e.source===pending.contentWindow;
  const fromCurrent=current&&e.source===current.contentWindow;
  if(!fromPending&&!fromCurrent)return;
  const m=e.data;
  if(!m||typeof m!=="object"||m.cvCanvas!==1)return;
  if(m.k==="doc"&&fromPending){pending.classList.remove("loading");if(current)current.remove();current=pending;pending=null;empty.hidden=true;}
  else if(m.k==="state"&&fromCurrent&&Array.isArray(m.filters)&&Array.isArray(m.removed)){state={filters:m.filters.filter(x=>typeof x==="string").slice(0,20),removed:m.removed.filter(x=>typeof x==="string").slice(0,200)};save();}
  else if(m.k==="scroll"&&fromCurrent&&typeof m.y==="number"&&isFinite(m.y)&&m.y>=0)scroll=m.y;
  else if(m.k==="link"&&fromCurrent){const u=safeUrl(m.url);if(u)window.open(u,"_blank","noopener,noreferrer");}
});
restore.addEventListener("click",()=>{state={filters:[],removed:[]};save();load();});
syncRestore();
load();
const es=new EventSource("/events");
es.onmessage=(e)=>{try{if(JSON.parse(e.data).rootId===id)load();}catch{}};
</script>`;
}

// server/routes.ts
var COOKIE = "canvas_token";
var HEARTBEAT_MS = 15e3;
async function resolveRoot(sessionId, env = process.env) {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("id de sess\xE3o inv\xE1lido");
  try {
    await stat(sessionDir(sessionId, env));
    return sessionId;
  } catch {
  }
  try {
    const alias = (await readFile2(aliasFile(sessionId, env), "utf8")).trim();
    if (SESSION_ID_PATTERN.test(alias)) return alias;
  } catch {
  }
  return sessionId;
}
async function readTitle(rootId, env) {
  try {
    const meta = JSON.parse(await readFile2(metaFile(rootId, env), "utf8"));
    const title = meta && typeof meta === "object" ? meta.title : void 0;
    return typeof title === "string" ? title.slice(0, LIMITS.titleChars) : "";
  } catch {
    return "";
  }
}
async function readDoc(rootId, env) {
  const file = canvasFile(rootId, env);
  let info;
  try {
    info = await stat(file);
  } catch {
    return { ok: true, rootId, canvas: null };
  }
  if (info.size > LIMITS.canvasBytes) return { ok: false, error: "canvas maior que o limite" };
  const html2 = await readFile2(file, "utf8");
  return { ok: true, rootId, canvas: { title: await readTitle(rootId, env), html: html2, updatedAt: Math.trunc(info.mtimeMs), path: file } };
}
async function listCanvases(env) {
  let names;
  try {
    names = await readdir(sessionsDir(env));
  } catch {
    return [];
  }
  const items = [];
  for (const rootId of names) {
    if (!SESSION_ID_PATTERN.test(rootId)) continue;
    try {
      const info = await stat(canvasFile(rootId, env));
      items.push({ rootId, title: await readTitle(rootId, env), updatedAt: Math.trunc(info.mtimeMs) });
    } catch {
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
}
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
function cookieOf(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}
function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}
function html(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}
function createRoutes(options) {
  const env = options.env ?? process.env;
  const clients = /* @__PURE__ */ new Set();
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();
  const authorize = (request, url) => {
    const bearer = String(request.headers.authorization ?? "");
    if (bearer.startsWith("Bearer ") && sameToken(bearer.slice(7), options.token)) return { ok: true, viaQuery: false };
    const query = url.searchParams.get("t");
    if (query && sameToken(query, options.token)) return { ok: true, viaQuery: true };
    if (sameToken(cookieOf(request.headers.cookie, COOKIE), options.token)) return { ok: true, viaQuery: false };
    return { ok: false, viaQuery: false };
  };
  const publish = async (rootId) => {
    let updatedAt = Date.now();
    try {
      updatedAt = Math.trunc((await stat(canvasFile(rootId, env))).mtimeMs);
    } catch {
    }
    const frame = `data: ${JSON.stringify({ rootId, updatedAt })}

`;
    for (const client of clients) client.write(frame);
  };
  const handle = async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    if (method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, version: options.version });
      return;
    }
    const auth = authorize(request, url);
    if (!auth.ok) {
      json(response, 401, { ok: false, error: "n\xE3o autorizado" });
      return;
    }
    if (auth.viaQuery && method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/s/"))) {
      const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      url.searchParams.delete("t");
      response.writeHead(302, {
        location: url.pathname + url.search,
        "set-cookie": `${COOKIE}=${options.token}; Path=/; HttpOnly; SameSite=Strict${secure}`,
        "referrer-policy": "no-referrer",
        "cache-control": "no-store"
      });
      response.end();
      return;
    }
    if (method === "GET" && url.pathname === "/canvas") {
      const session = url.searchParams.get("session") ?? "";
      if (!SESSION_ID_PATTERN.test(session)) {
        json(response, 400, { ok: false, error: "id de sess\xE3o inv\xE1lido" });
        return;
      }
      const result = await readDoc(await resolveRoot(session, env), env);
      json(response, result.ok ? 200 : 413, result);
      return;
    }
    if (method === "GET" && url.pathname === "/frame") {
      const session = url.searchParams.get("session") ?? "";
      if (!SESSION_ID_PATTERN.test(session)) {
        json(response, 400, { ok: false, error: "id de sess\xE3o inv\xE1lido" });
        return;
      }
      const result = await readDoc(await resolveRoot(session, env), env);
      if (!result.ok) {
        json(response, 413, result);
        return;
      }
      if (!result.canvas) {
        json(response, 200, { ok: true, rootId: result.rootId, srcdoc: null });
        return;
      }
      let stored = null;
      try {
        stored = JSON.parse(url.searchParams.get("state") ?? "null");
      } catch {
      }
      const scroll = Number(url.searchParams.get("scroll"));
      const srcdoc = buildFrameDocument({
        html: result.canvas.html,
        theme: BROWSER_THEME,
        colorScheme: "dark",
        mode: "browser",
        state: { ...parseViewState(stored), scroll: Number.isFinite(scroll) ? scroll : 0 }
      });
      json(response, 200, { ok: true, rootId: result.rootId, title: result.canvas.title, updatedAt: result.canvas.updatedAt, srcdoc });
      return;
    }
    if (method === "GET" && url.pathname === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      response.write(": ok\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    if (method === "GET" && url.pathname === "/") {
      html(response, 200, indexPage(await listCanvases(env)));
      return;
    }
    if (method === "GET" && url.pathname.startsWith("/s/")) {
      const id = decode(url.pathname.slice(3));
      if (!SESSION_ID_PATTERN.test(id)) {
        json(response, 400, { ok: false, error: "id de sess\xE3o inv\xE1lido" });
        return;
      }
      html(response, 200, shellPage(await resolveRoot(id, env)));
      return;
    }
    if (method === "DELETE" && url.pathname.startsWith("/canvas/")) {
      const id = decode(url.pathname.slice("/canvas/".length));
      if (!SESSION_ID_PATTERN.test(id)) {
        json(response, 400, { ok: false, error: "id de sess\xE3o inv\xE1lido" });
        return;
      }
      await rm(sessionDir(id, env), { recursive: true, force: true });
      await rm(aliasFile(id, env), { force: true });
      await publish(id);
      json(response, 200, { ok: true });
      return;
    }
    if (method === "POST" && url.pathname === "/shutdown") {
      const below = Number(url.searchParams.get("below"));
      if (url.searchParams.has("below") && !(options.version < below)) {
        json(response, 409, { ok: false, error: "vers\xE3o atual n\xE3o \xE9 menor" });
        return;
      }
      json(response, 200, { ok: true });
      response.on("finish", options.onShutdown);
      return;
    }
    json(response, 404, { ok: false, error: "n\xE3o encontrado" });
  };
  return {
    handle,
    publish,
    clientCount: () => clients.size,
    closeClients() {
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
    }
  };
}
async function ensureDirs(env = process.env) {
  await mkdir2(sessionsDir(env), { recursive: true, mode: 448 });
}

// server/watch.ts
import { watch } from "node:fs";
import { mkdir as mkdir3, stat as stat2 } from "node:fs/promises";
import path2 from "node:path";
function rootIdOf(relative) {
  const parts = relative.split(path2.sep).filter(Boolean);
  const id = parts[0];
  return id && SESSION_ID_PATTERN.test(id) ? id : null;
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function sizeOf(file) {
  try {
    return (await stat2(file)).size;
  } catch {
    return -1;
  }
}
async function watchSessions(sessionsDir2, onChange, options = {}) {
  const debounceMs = options.debounceMs ?? 30;
  const settleMs = options.settleMs ?? 10;
  await mkdir3(sessionsDir2, { recursive: true, mode: 448 });
  const timers = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Map();
  let closed = false;
  const flush = async (rootId, generation) => {
    const file = path2.join(sessionsDir2, rootId, "index.html");
    let size = await sizeOf(file);
    for (let i = 0; i < 20; i += 1) {
      await sleep(settleMs);
      const next = await sizeOf(file);
      if (next === size) break;
      size = next;
    }
    if (!closed && seen.get(rootId) === generation) onChange(rootId);
  };
  const watcher = watch(sessionsDir2, { recursive: true }, (_event, filename) => {
    if (closed || !filename) return;
    const rootId = rootIdOf(String(filename));
    if (!rootId) return;
    const generation = (seen.get(rootId) ?? 0) + 1;
    seen.set(rootId, generation);
    const previous = timers.get(rootId);
    if (previous) clearTimeout(previous);
    timers.set(
      rootId,
      setTimeout(() => {
        timers.delete(rootId);
        void flush(rootId, generation);
      }, debounceMs)
    );
  });
  watcher.on("error", () => {
  });
  return {
    close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      seen.clear();
      watcher.close();
    }
  };
}

// server/main.ts
var PORT = Number(process.env.OPENCHAMBER_CANVAS_PORT || SERVER_PORT);
var HOST = process.env.OPENCHAMBER_CANVAS_HOST || "0.0.0.0";
var IDLE_MS = Number(process.env.OPENCHAMBER_CANVAS_IDLE_MS || 30 * 6e4);
async function main() {
  await ensureDirs();
  const token = await ensureToken();
  let stop = () => process.exit(0);
  const routes = createRoutes({ token, version: SERVICE_VERSION, onShutdown: () => stop() });
  const server = http.createServer((request, response) => {
    routes.handle(request, response).catch((error) => {
      console.error("[canvas-server] erro:", error instanceof Error ? error.message : "erro");
      if (response.headersSent) return;
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "erro interno" }));
    });
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") process.exit(0);
    console.error("[canvas-server] falha ao ouvir:", error.message);
    process.exit(1);
  });
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  const watcher = await watchSessions(sessionsDir(), (rootId) => void routes.publish(rootId));
  await writeFile2(serverFile(), JSON.stringify({ pid: process.pid, port: PORT, version: SERVICE_VERSION }), { encoding: "utf8", mode: 384 });
  let stopping = false;
  stop = () => {
    if (stopping) return;
    stopping = true;
    watcher.close();
    routes.closeClients();
    void (async () => {
      try {
        const current = JSON.parse(await readFile3(serverFile(), "utf8"));
        if (current && typeof current === "object" && current.pid === process.pid) await rm2(serverFile(), { force: true });
      } catch {
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1e3).unref();
    })();
  };
  let idleSince = Date.now();
  setInterval(() => {
    if (routes.clientCount() > 0) idleSince = Date.now();
    else if (Date.now() - idleSince > IDLE_MS) stop();
  }, Math.min(IDLE_MS, 6e4)).unref();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(`[canvas-server] v${SERVICE_VERSION} em ${HOST}:${PORT} (${canvasHome()})`);
}
main().catch((error) => {
  console.error("[canvas-server] falha:", error instanceof Error ? error.message : "erro");
  process.exit(1);
});
