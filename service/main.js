// service/main.ts
import { timingSafeEqual } from "node:crypto";
import http from "node:http";

// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = /* @__PURE__ */ new WeakMap();
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== void 0)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1e3));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);

// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_WIRE_VERSION = 1;
var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
var isGuestSessionEventType = (value) => EVENT_TYPES.has(value);
var readSessionEventRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, event, content } = wire;
  if (v !== SESSION_EVENTS_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(event) !== event || event === void 0)
    return null;
  const { id, type, at, session, project, linked, permission, question } = event;
  if (String(id) !== id || id.length === 0)
    return null;
  if (String(type) !== type || !isGuestSessionEventType(type))
    return null;
  if (!Number.isFinite(at))
    return null;
  if (Object(session) !== session || session === void 0)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const parentId = session.parentId;
  if (parentId !== null && (String(parentId) !== parentId || parentId.length === 0))
    return null;
  if (Object(project) !== project || project === void 0)
    return null;
  const directory = project.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  if (!Array.isArray(linked))
    return null;
  const request = {
    v: SESSION_EVENTS_WIRE_VERSION,
    requestId,
    event: { id, type, at: Number(at), session: { id: sessionId, parentId }, project: { directory }, linked }
  };
  if (permission !== void 0) {
    if (Object(permission) !== permission)
      return null;
    const permissionRequestId = permission.requestId;
    if (String(permissionRequestId) !== permissionRequestId || permissionRequestId.length === 0)
      return null;
    request.event.permission = { requestId: permissionRequestId };
  }
  if (question !== void 0) {
    if (Object(question) !== question)
      return null;
    const { kind, id: questionId } = question;
    if (kind !== "form" && kind !== "page")
      return null;
    if (String(questionId) !== questionId || questionId.length === 0)
      return null;
    request.event.question = { kind, id: questionId };
  }
  if (content !== void 0) {
    if (Object(content) !== content || content.type !== type)
      return null;
    request.content = content;
  }
  return request;
};

// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 3e4;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
var MENTIONS_IDLE_MS = 10 * 6e4;
var ServiceHostError = class extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
};
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== void 0)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === void 0 ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};

// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);

// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

// src/shared/contract.ts
var SERVICE_VERSION = 1;
var INBOX_SCHEMA_VERSION = 1;
var LIMITS = {
  /** Tamanho máximo do HTML publicado pelo agente. */
  htmlChars: 2e5,
  titleChars: 120,
  depth: 32,
  nodes: 5e3,
  items: 200,
  /** Texto máximo de um item marcável (limite do `host.attach`). */
  itemTextChars: 16e3
};
var SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
var BLOCKED_NOTES_MAX = 20;

// service/inbox.ts
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
var FILE_NAME = /^([A-Za-z0-9_-]{1,128})\.json$/;
var CLAIMED_NAME = /^([A-Za-z0-9_-]{1,128})\.json\.[0-9a-f-]{36}\.proc$/;
var MAX_FILE_BYTES = LIMITS.htmlChars * 6 + 4096;
var STALE_CLAIM_MS = 6e4;
var MAX_ATTEMPTS = 5;
var attempts = /* @__PURE__ */ new Map();
async function readPayload(file, sessionId) {
  const info = await lstat(file);
  if (!info.isFile()) return { ok: false, message: "a publica\xE7\xE3o n\xE3o \xE9 um arquivo comum" };
  if (info.size > MAX_FILE_BYTES) return { ok: false, message: `publica\xE7\xE3o maior que o limite (${LIMITS.htmlChars} caracteres de HTML)` };
  let payload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { ok: false, message: "a publica\xE7\xE3o n\xE3o \xE9 um JSON v\xE1lido" };
  }
  if (typeof payload !== "object" || payload === null) return { ok: false, message: "a publica\xE7\xE3o n\xE3o \xE9 um objeto" };
  if (payload.v !== INBOX_SCHEMA_VERSION) return { ok: false, message: "vers\xE3o de publica\xE7\xE3o n\xE3o suportada" };
  if (payload.sessionId !== sessionId) return { ok: false, message: "a publica\xE7\xE3o n\xE3o pertence a esta sess\xE3o" };
  return { ok: true, title: payload.title, html: payload.html };
}
async function drainInbox(inbox2, store2, now, options = {}) {
  await mkdir(inbox2, { recursive: true });
  const changed = [];
  for (const name of await readdir(inbox2)) {
    const claimedMatch = CLAIMED_NAME.exec(name);
    if (claimedMatch) {
      await dropStaleClaim(path.join(inbox2, name), now());
      continue;
    }
    const match = FILE_NAME.exec(name);
    if (!match) continue;
    const sessionId = match[1];
    const file = path.join(inbox2, name);
    const claimed = `${file}.${randomUUID()}.proc`;
    const generation = store2.generation(sessionId);
    try {
      await rename(file, claimed);
    } catch {
      continue;
    }
    try {
      const payload = await readPayload(claimed, sessionId);
      const record = payload.ok ? await store2.publish(sessionId, payload.title, payload.html, now(), { expectedGeneration: generation }) : await store2.reject(sessionId, payload.message, now(), { expectedGeneration: generation });
      if (record) changed.push(sessionId);
      attempts.delete(sessionId);
      await rm(claimed, { force: true, recursive: true });
    } catch (error) {
      options.onError?.(sessionId, error);
      const tried = (attempts.get(sessionId) ?? 0) + 1;
      if (tried >= MAX_ATTEMPTS) {
        attempts.delete(sessionId);
        await rm(claimed, { force: true, recursive: true });
        await store2.reject(sessionId, "n\xE3o foi poss\xEDvel gravar a publica\xE7\xE3o (erro de disco)", now(), { expectedGeneration: generation }).catch(() => null);
      } else {
        attempts.set(sessionId, tried);
        await giveBack(claimed, file);
      }
    }
  }
  return changed;
}
async function giveBack(claimed, file) {
  await link(claimed, file).catch(() => void 0);
  await rm(claimed, { force: true, recursive: true });
}
async function dropStaleClaim(claimed, now) {
  try {
    const info = await lstat(claimed);
    if (now - info.mtimeMs > STALE_CLAIM_MS) await rm(claimed, { force: true, recursive: true });
  } catch {
    return;
  }
}
async function discardPending(inbox2, sessionId) {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  await rm(path.join(inbox2, `${sessionId}.json`), { force: true });
}

// service/paths.ts
import os from "node:os";
import path2 from "node:path";
function inboxDir(env = process.env) {
  if (env.OPENCHAMBER_CANVAS_INBOX) return env.OPENCHAMBER_CANVAS_INBOX;
  const base = env.XDG_CONFIG_HOME || path2.join(os.homedir(), ".config");
  return path2.join(base, "openchamber", "canvas-viewer", "inbox");
}

// service/store.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, readFile as readFile2, rename as rename2, rm as rm2, writeFile } from "node:fs/promises";
import path3 from "node:path";

// src/canvas/sanitize.ts
var ALLOWED_TAGS = /* @__PURE__ */ new Set([
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "blockquote",
  "pre",
  "code",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "mark",
  "small",
  "sub",
  "sup",
  "kbd",
  "br",
  "hr",
  "section",
  "article",
  "header",
  "footer",
  "figure",
  "figcaption",
  "details",
  "summary"
]);
var VOID_TAGS = /* @__PURE__ */ new Set(["br", "hr"]);
var DROP_WITH_CONTENT = /* @__PURE__ */ new Set([
  "script",
  "style",
  "svg",
  "math",
  "iframe",
  "object",
  "textarea",
  "noscript",
  "template",
  "title",
  "head",
  "select"
]);
var DROP_VOID = /* @__PURE__ */ new Set(["img", "input", "meta", "link", "base", "source", "track", "area", "embed", "param", "wbr"]);
var CLASS_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
var ITEM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
var NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xA0" };
var CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
var BIDI_CHARS = /[\u202a-\u202e\u2066-\u2069]/;
var BIDI_CHARS_ALL = /[\u202a-\u202e\u2066-\u2069]/g;
var Malformed = class extends Error {
};
function decodeEntities(raw) {
  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const ok = Number.isInteger(code) && (code === 9 || code === 10 || code === 13 || code >= 32 && code <= 1114111 && code !== 127 && !(code >= 55296 && code <= 57343));
      return ok ? String.fromCodePoint(code) : "\uFFFD";
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}
function position(html, index) {
  const before = html.slice(0, index);
  return `linha ${before.split("\n").length}, coluna ${index - before.lastIndexOf("\n")}`;
}
var TAG_OPEN = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
var TAG_CLOSE = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/;
var ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseOrThrow(html, blocked) {
  if (html.length > LIMITS.htmlChars) throw new Malformed(`HTML maior que ${LIMITS.htmlChars} caracteres`);
  const root = [];
  const stack = [];
  const seenItems = /* @__PURE__ */ new Set();
  let nodes = 0;
  let index = 0;
  const block = (what) => {
    if (blocked.size < BLOCKED_NOTES_MAX) blocked.add(what);
  };
  const children = () => stack.length ? stack[stack.length - 1].c : root;
  const count = () => {
    if (++nodes > LIMITS.nodes) throw new Malformed(`mais de ${LIMITS.nodes} n\xF3s`);
  };
  const pushText = (raw) => {
    if (!raw) return;
    let value = decodeEntities(raw);
    if (CONTROL_CHARS.test(value)) throw new Malformed("caractere de controle no texto");
    if (BIDI_CHARS.test(value)) {
      block("controle bidirecional");
      value = value.replace(BIDI_CHARS_ALL, "");
    }
    count();
    children().push({ t: "text", v: value });
  };
  const readAttributes = (raw, tag) => {
    const attrs = {};
    for (const match of raw.matchAll(ATTRIBUTE)) {
      const name = (match[1] ?? "").toLowerCase();
      const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
      if (CONTROL_CHARS.test(value)) throw new Malformed(`caractere inv\xE1lido no atributo "${name}"`);
      switch (name) {
        case "class": {
          const tokens = value.split(/\s+/).filter(Boolean);
          const valid = tokens.filter((token) => CLASS_TOKEN.test(token)).slice(0, 8);
          if (valid.length !== tokens.length) block("classe inv\xE1lida (use [a-z][a-z0-9-], at\xE9 8)");
          if (valid.length) attrs.class = valid.join(" ");
          break;
        }
        case "title":
          attrs.title = value.slice(0, 200);
          break;
        case "colspan":
        case "rowspan":
          if (/^[1-9][0-9]?$/.test(value)) attrs[name] = value;
          else block(`atributo ${name} inv\xE1lido`);
          break;
        case "data-canvas-item":
          if (!ITEM_ID.test(value)) throw new Malformed("data-canvas-item inv\xE1lido (use [a-z0-9][a-z0-9-], at\xE9 40)");
          if (seenItems.has(value)) throw new Malformed(`data-canvas-item repetido: ${value}`);
          if (seenItems.size >= LIMITS.items) throw new Malformed(`mais de ${LIMITS.items} itens marc\xE1veis`);
          seenItems.add(value);
          attrs["data-canvas-item"] = value;
          break;
        default:
          block(`atributo ${name.startsWith("on") ? "on*" : name}`);
      }
    }
    return attrs;
  };
  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }
    pushText(html.slice(index, lt));
    index = lt;
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      if (end === -1) throw new Malformed(`coment\xE1rio n\xE3o fechado (${position(html, index)})`);
      index = end + 3;
      continue;
    }
    if (html.startsWith("<!", index) || html.startsWith("<?", index)) {
      const end = html.indexOf(">", index);
      if (end === -1) throw new Malformed(`declara\xE7\xE3o n\xE3o fechada (${position(html, index)})`);
      block("declara\xE7\xE3o (<! ou <?)");
      index = end + 1;
      continue;
    }
    const closing = TAG_CLOSE.exec(html.slice(index, index + 64));
    if (closing) {
      const name2 = (closing[1] ?? "").toLowerCase();
      index += closing[0].length;
      if (!ALLOWED_TAGS.has(name2)) continue;
      const top = stack.pop();
      if (!top || top.tag !== name2) throw new Malformed(`fechamento </${name2}> sem abertura correspondente (${position(html, index)})`);
      continue;
    }
    const opening = TAG_OPEN.exec(html.slice(index, index + 4096));
    if (!opening) throw new Malformed(`marca\xE7\xE3o malformada (${position(html, index)}); use &lt; para o caractere <`);
    const name = (opening[1] ?? "").toLowerCase();
    index += opening[0].length;
    if (DROP_WITH_CONTENT.has(name)) {
      block(`<${name}>`);
      if (opening[3] === "/") continue;
      const close = new RegExp(`</${name}\\s*>`, "i").exec(html.slice(index));
      if (!close) throw new Malformed(`<${name}> n\xE3o foi fechada`);
      index += close.index + close[0].length;
      continue;
    }
    if (DROP_VOID.has(name)) {
      block(`<${name}>`);
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) {
      block(`<${name}>`);
      continue;
    }
    if (stack.length + 1 > LIMITS.depth) throw new Malformed(`aninhamento maior que ${LIMITS.depth}`);
    count();
    const element = { t: "el", tag: name, attrs: readAttributes(opening[2] ?? "", name), c: [] };
    children().push(element);
    if (VOID_TAGS.has(name) || opening[3] === "/") continue;
    stack.push(element);
  }
  const open = stack[stack.length - 1];
  if (open) throw new Malformed(`tag <${open.tag}> n\xE3o foi fechada`);
  return root;
}
function parseCanvasHtml(html) {
  if (typeof html !== "string") return { ok: false, message: "html deve ser texto" };
  const blocked = /* @__PURE__ */ new Set();
  try {
    const tree = parseOrThrow(html, blocked);
    return { ok: true, tree, blocked: [...blocked] };
  } catch (error) {
    if (error instanceof Malformed) return { ok: false, message: error.message };
    return { ok: false, message: "falha ao ler o HTML" };
  }
}
function validateTree(value) {
  let nodes = 0;
  let items = 0;
  const seen = /* @__PURE__ */ new Set();
  const walk = (raw, depth) => {
    if (++nodes > LIMITS.nodes || typeof raw !== "object" || raw === null) return null;
    const node = raw;
    if (node.t === "text") {
      return typeof node.v === "string" && node.v.length <= LIMITS.htmlChars && !CONTROL_CHARS.test(node.v) && !BIDI_CHARS.test(node.v) ? { t: "text", v: node.v } : null;
    }
    if (depth > LIMITS.depth) return null;
    if (node.t !== "el" || typeof node.tag !== "string" || !ALLOWED_TAGS.has(node.tag)) return null;
    if (typeof node.attrs !== "object" || node.attrs === null || !Array.isArray(node.c)) return null;
    const attrs = {};
    for (const [name, attr] of Object.entries(node.attrs)) {
      if (typeof attr !== "string") return null;
      if (name === "class") {
        const tokens = attr.split(/\s+/).filter(Boolean);
        if (tokens.length > 8 || !tokens.every((token) => CLASS_TOKEN.test(token))) return null;
        attrs.class = tokens.join(" ");
      } else if (name === "title") {
        if (attr.length > 200) return null;
        attrs.title = attr;
      } else if (name === "colspan" || name === "rowspan") {
        if (!/^[1-9][0-9]?$/.test(attr)) return null;
        attrs[name] = attr;
      } else if (name === "data-canvas-item") {
        if (!ITEM_ID.test(attr) || seen.has(attr) || ++items > LIMITS.items) return null;
        seen.add(attr);
        attrs[name] = attr;
      } else {
        return null;
      }
    }
    if (VOID_TAGS.has(node.tag) && node.c.length > 0) return null;
    const c = [];
    for (const child of node.c) {
      const clean = walk(child, depth + 1);
      if (!clean) return null;
      c.push(clean);
    }
    return { t: "el", tag: node.tag, attrs, c };
  };
  if (!Array.isArray(value)) return null;
  const tree = [];
  for (const child of value) {
    const clean = walk(child, 1);
    if (!clean) return null;
    tree.push(clean);
  }
  return tree;
}

// src/canvas/snapshot.ts
var TITLE_STRIP = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;
function buildSnapshot(title, html, now) {
  const cleanTitle = typeof title === "string" ? title.replace(TITLE_STRIP, " ").trim().slice(0, LIMITS.titleChars) : "";
  const parsed = parseCanvasHtml(html);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.tree.length === 0) return { ok: false, message: "o canvas est\xE1 vazio" };
  const tree = validateTree(parsed.tree);
  if (!tree) return { ok: false, message: "o canvas excede os limites de estrutura" };
  return { ok: true, snapshot: { title: cleanTitle, updatedAt: now, tree, blocked: parsed.blocked } };
}

// service/store.ts
function createStore(dataDir) {
  const dir = path3.join(dataDir, "canvases");
  const generations = /* @__PURE__ */ new Map();
  const queues = /* @__PURE__ */ new Map();
  const fileOf = (sessionId) => {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("id de sess\xE3o inv\xE1lido");
    return path3.join(dir, `${sessionId}.json`);
  };
  const generation = (sessionId) => generations.get(sessionId) ?? 0;
  const locked = (sessionId, task) => {
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => void 0);
    queues.set(sessionId, tail);
    void tail.then(() => {
      if (queues.get(sessionId) === tail) queues.delete(sessionId);
    });
    return run;
  };
  const readFileRecord = async (sessionId) => {
    const file = fileOf(sessionId);
    let raw;
    try {
      raw = await readFile2(file, "utf8");
    } catch {
      return null;
    }
    try {
      const value = JSON.parse(raw);
      const canvas = value.canvas;
      if (canvas) {
        const tree = validateTree(canvas.tree);
        if (!tree || typeof canvas.updatedAt !== "number" || typeof canvas.title !== "string") return null;
        const blocked = Array.isArray(canvas.blocked) ? canvas.blocked.filter((note) => typeof note === "string").slice(0, BLOCKED_NOTES_MAX) : [];
        return { sessionId, canvas: { title: canvas.title, updatedAt: canvas.updatedAt, tree, blocked }, error: readError(value.error) };
      }
      return { sessionId, canvas: null, error: readError(value.error) };
    } catch {
      return null;
    }
  };
  const write = async (record) => {
    await mkdir2(dir, { recursive: true });
    const target = fileOf(record.sessionId);
    const tmp = `${target}.${randomUUID2()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(record), "utf8");
      await rename2(tmp, target);
    } catch (error) {
      await rm2(tmp, { force: true });
      throw error;
    }
  };
  const outdated = (sessionId, options) => options?.expectedGeneration !== void 0 && options.expectedGeneration !== generation(sessionId);
  return {
    generation,
    read: async (sessionId) => {
      fileOf(sessionId);
      return locked(sessionId, () => readFileRecord(sessionId));
    },
    remove: async (sessionId) => {
      fileOf(sessionId);
      return locked(sessionId, async () => {
        generations.set(sessionId, generation(sessionId) + 1);
        await rm2(fileOf(sessionId), { force: true });
      });
    },
    publish: async (sessionId, title, html, now, options) => {
      fileOf(sessionId);
      return locked(sessionId, async () => {
        if (outdated(sessionId, options)) return null;
        const built = buildSnapshot(title, html, now);
        if (!built.ok) return rejectLocked(sessionId, built.message, now);
        const record = { sessionId, canvas: built.snapshot, error: null };
        await write(record);
        return record;
      });
    },
    reject: async (sessionId, message, now, options) => {
      fileOf(sessionId);
      return locked(sessionId, async () => outdated(sessionId, options) ? null : rejectLocked(sessionId, message, now));
    }
  };
  async function rejectLocked(sessionId, message, now) {
    const previous = await readFileRecord(sessionId);
    const record = { sessionId, canvas: previous?.canvas ?? null, error: { at: now, message: message.slice(0, 300) } };
    await write(record);
    return record;
  }
}
function readError(value) {
  if (typeof value !== "object" || value === null) return null;
  const error = value;
  return typeof error.at === "number" && typeof error.message === "string" ? { at: error.at, message: error.message.slice(0, 300) } : null;
}

// service/main.ts
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
var TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
var DATA_DIR = process.env.OPENCHAMBER_SERVICE_DATA_DIR || "";
var DRAIN_INTERVAL_MS = 500;
var BODY_MAX_BYTES = 1e5;
if (!PORT || !TOKEN || !DATA_DIR) {
  console.error("[canvas-viewer] vari\xE1veis OPENCHAMBER_SERVICE_PORT/TOKEN/DATA_DIR ausentes");
  process.exit(1);
}
var store = createStore(DATA_DIR);
var inbox = inboxDir();
var host = createServiceHost({ env: process.env });
function authorized(header) {
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const given = Buffer.from(String(header ?? ""));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...status === 413 ? { connection: "close" } : {}
  });
  response.end(body);
}
var BodyTooLarge = class extends Error {
};
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
var draining = null;
function drain() {
  draining ??= (async () => {
    try {
      const changed = await drainInbox(inbox, store, () => Date.now(), {
        onError: (sessionId, error) => console.error("[canvas-viewer] publica\xE7\xE3o adiada:", sessionId, error instanceof Error ? error.message : "erro")
      });
      for (const sessionId of changed) void host.emit("canvas", { sessionId }).catch(() => {
      });
    } catch (error) {
      console.error("[canvas-viewer] falha ao ler a caixa de entrada:", error instanceof Error ? error.message : "erro");
    } finally {
      draining = null;
    }
  })();
  return draining;
}
async function route(request, response) {
  const url = new URL(String(request.url || "/"), "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true, version: SERVICE_VERSION });
    return;
  }
  if (request.method === "GET" && url.pathname === "/canvas") {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      send(response, 400, { ok: false, error: "sessionId inv\xE1lido" });
      return;
    }
    await drain();
    const record = await store.read(sessionId);
    send(response, 200, { ok: true, version: SERVICE_VERSION, canvas: record?.canvas ?? null, error: record?.error ?? null });
    return;
  }
  if (request.method === "POST" && url.pathname === "/session-events") {
    const event = readSessionEventRequest(await readBody(request));
    if (!event) {
      send(response, 400, { ok: false, error: "evento inv\xE1lido" });
      return;
    }
    const sessionId = event.event.session.id;
    if (event.event.type === "session-deleted" && SESSION_ID_PATTERN.test(sessionId)) {
      await discardPending(inbox, sessionId);
      await store.remove(sessionId);
    }
    send(response, 200, { ok: true });
    return;
  }
  send(response, 404, { ok: false, error: "rota inexistente" });
}
var server = http.createServer((request, response) => {
  if (!authorized(request.headers.authorization)) {
    send(response, 401, { ok: false, error: "token do servi\xE7o inv\xE1lido" });
    return;
  }
  route(request, response).catch((error) => {
    if (response.headersSent) return;
    if (error instanceof BodyTooLarge) {
      send(response, 413, { ok: false, error: "corpo grande demais" });
      return;
    }
    console.error("[canvas-viewer] erro:", error instanceof Error ? error.message : "erro");
    send(response, 500, { ok: false, error: "erro interno" });
  });
});
server.listen(PORT, "127.0.0.1", () => {
  void drain();
  setInterval(() => void drain(), DRAIN_INTERVAL_MS);
});
