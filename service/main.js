// service/main.ts
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

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
var SERVICE_VERSION = 4;
var SERVER_PORT = 57130;
var SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
var UPDATE_REQUEST_MARKER = "[Painel Canvas \xB7 Atualizar]";
var UPDATE_REQUEST_TEXT = `${UPDATE_REQUEST_MARKER} Atualize agora o canvas desta conversa: publique de novo com canvas_publish, refletindo o estado atual do trabalho e mantendo os mesmos ids de elemento. N\xE3o repita a visualiza\xE7\xE3o no chat; responda s\xF3 com um resumo curto do que mudou.`;
var UPDATE_MIN_INTERVAL_MS = 5e3;

// src/shared/token.ts
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

// src/shared/paths.ts
import os from "node:os";
import path from "node:path";
function canvasHome(env = process.env) {
  if (env.OPENCHAMBER_CANVAS_HOME) return env.OPENCHAMBER_CANVAS_HOME;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "openchamber-canvas");
}
function tokenFile(env = process.env) {
  return path.join(canvasHome(env), "token");
}

// src/shared/token.ts
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

// service/bridge.ts
function parseSse(buffer) {
  const events = [];
  const cut = buffer.lastIndexOf("\n\n");
  if (cut < 0) return { events, rest: buffer };
  for (const frame of buffer.slice(0, cut).split("\n\n")) {
    if (!frame.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(frame.slice(6));
      if (!data || typeof data !== "object") continue;
      const { rootId, updatedAt } = data;
      if (typeof rootId === "string" && SESSION_ID_PATTERN.test(rootId) && typeof updatedAt === "number") events.push({ rootId, updatedAt });
    } catch {
    }
  }
  return { events, rest: buffer.slice(cut + 2) };
}
var BACKOFF_MIN_MS = 500;
var BACKOFF_MAX_MS = 1e4;
function startBridge(options) {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const controller = new AbortController();
  const run = async () => {
    let delay = BACKOFF_MIN_MS;
    while (!controller.signal.aborted) {
      try {
        await options.beforeConnect?.();
        const token = await options.token();
        if (!token) throw new Error("sem token");
        const response = await doFetch(options.url, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        delay = BACKOFF_MIN_MS;
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) options.onEvent(event);
        }
      } catch {
      }
      if (controller.signal.aborted) return;
      await sleep(delay);
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    }
  };
  void run();
  return { stop: () => controller.abort() };
}

// service/ensure-server.ts
import { spawn } from "node:child_process";
var WAIT_STEP_MS = 50;
var WAIT_STEPS = 100;
async function waitFor(deps2, done) {
  for (let i = 0; i < WAIT_STEPS; i += 1) {
    if (done(await deps2.health())) return true;
    await deps2.sleep(WAIT_STEP_MS);
  }
  return false;
}
async function ensureServer(deps2, version) {
  const current = await deps2.health();
  if (current && current.version >= version) return "reused";
  if (current) {
    await deps2.shutdownBelow(version);
    if (!await waitFor(deps2, (h) => h === null || h.version >= version)) throw new Error("servidor antigo n\xE3o encerrou");
    const now = await deps2.health();
    if (now && now.version >= version) return "replaced";
  }
  deps2.spawnServer();
  if (!await waitFor(deps2, (h) => h !== null && h.version >= version)) throw new Error("servidor n\xE3o subiu");
  return current ? "replaced" : "started";
}
function baseUrl(port) {
  return `http://127.0.0.1:${port}`;
}
function realDeps(options) {
  const port = options.port ?? SERVER_PORT;
  const doFetch = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  return {
    async health() {
      try {
        const response = await doFetch(`${baseUrl(port)}/health`, { signal: AbortSignal.timeout(1e3) });
        const body = await response.json();
        if (response.ok && body && typeof body === "object" && body.ok === true && typeof body.version === "number") {
          return body;
        }
      } catch {
      }
      return null;
    },
    async shutdownBelow(version) {
      const token = await options.token();
      if (!token) return;
      await doFetch(`${baseUrl(port)}/shutdown?below=${version}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2e3) }).catch(() => {
      });
    },
    spawnServer() {
      const passthrough = ["PATH", "HOME", "XDG_DATA_HOME", "OPENCHAMBER_CANVAS_HOME", "OPENCHAMBER_CANVAS_PORT", "OPENCHAMBER_CANVAS_HOST", "OPENCHAMBER_CANVAS_IDLE_MS"];
      const childEnv = { ELECTRON_RUN_AS_NODE: "1" };
      for (const key of passthrough) {
        const value = env[key];
        if (value !== void 0) childEnv[key] = value;
      }
      spawn(process.execPath, [options.serverScript], { detached: true, stdio: "ignore", env: childEnv }).unref();
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}

// service/update-request.ts
var monotonicNow = () => performance.now();
function codeOf(error) {
  return typeof error === "object" && error !== null && typeof error.code === "string" ? error.code : "";
}
function statusOf(error) {
  return typeof error === "object" && error !== null && typeof error.status === "number" ? error.status : 0;
}
function refusal(error) {
  const code = codeOf(error);
  if (code === "NOT_GRANTED" || statusOf(error) === 403) return "not-granted";
  if (code === "SESSION_BUSY") return "busy";
  return "host-refused";
}
var unconfirmed = (error) => ["HOST_UNAVAILABLE", "HOST_TIMEOUT"].includes(codeOf(error));
function createUpdateRequester(host2, now = monotonicNow, minIntervalMs = UPDATE_MIN_INTERVAL_MS) {
  const reserved = /* @__PURE__ */ new Map();
  const prune = (at) => {
    for (const [id, when] of reserved) if (at - when >= minIntervalMs) reserved.delete(id);
  };
  return {
    async request(sessionId) {
      if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, code: "invalid-session" };
      const at = now();
      prune(at);
      if (reserved.has(sessionId)) return { ok: false, code: "too-soon" };
      reserved.set(sessionId, at);
      let status;
      try {
        status = (await host2.status(sessionId)).status;
      } catch (error) {
        reserved.delete(sessionId);
        return { ok: false, code: refusal(error) };
      }
      if (status !== "idle") {
        reserved.delete(sessionId);
        return { ok: false, code: status === "waiting" ? "waiting" : "busy" };
      }
      try {
        await host2.send(sessionId, UPDATE_REQUEST_TEXT);
        return { ok: true };
      } catch (error) {
        if (unconfirmed(error)) {
          reserved.set(sessionId, now());
          return { ok: false, code: "unconfirmed" };
        }
        reserved.delete(sessionId);
        return { ok: false, code: refusal(error) };
      }
    }
  };
}

// service/main.ts
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
var TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
var BODY_MAX_BYTES = 1e5;
var SERVER_PORT_IN_USE = Number(process.env.OPENCHAMBER_CANVAS_PORT || SERVER_PORT);
var SERVER_URL = `http://127.0.0.1:${SERVER_PORT_IN_USE}`;
var BROWSER_URL = (process.env.OPENCHAMBER_CANVAS_BROWSER_URL || SERVER_URL).replace(/\/+$/, "");
if (!PORT || !TOKEN) {
  console.error("[canvas-viewer] vari\xE1veis OPENCHAMBER_SERVICE_PORT/TOKEN ausentes");
  process.exit(1);
}
var host = createServiceHost({ env: process.env });
var updateRequester = createUpdateRequester({
  status: (sessionId) => host.sessions.status(sessionId),
  send: (sessionId, prompt) => host.sessions.send(sessionId, prompt)
});
var deps = realDeps({
  serverScript: fileURLToPath(new URL("../server/main.js", import.meta.url)),
  token: () => readToken(),
  port: SERVER_PORT_IN_USE
});
var ensuring = null;
function ensure() {
  ensuring ??= ensureServer(deps, SERVICE_VERSION).then(() => void 0).finally(() => {
    ensuring = null;
  });
  return ensuring;
}
var UPDATE_STATUS = { "invalid-session": 400, busy: 409, waiting: 409, "too-soon": 429, "not-granted": 403, "host-refused": 502, unconfirmed: 502 };
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
async function callServer(path2, init = {}) {
  await ensure();
  const token = await readToken();
  if (!token) throw new Error("sem token do servidor");
  return fetch(`${SERVER_URL}${path2}`, { ...init, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5e3) });
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
    const upstream = await callServer(`/canvas?session=${encodeURIComponent(sessionId)}`);
    const body = await upstream.json();
    send(response, upstream.ok ? 200 : 502, body.ok ? { ...body, version: SERVICE_VERSION } : body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/info") {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      send(response, 400, { ok: false, error: "sessionId inv\xE1lido" });
      return;
    }
    await ensure();
    const token = await readToken();
    if (!token) {
      send(response, 502, { ok: false, error: "sem token do servidor" });
      return;
    }
    send(response, 200, { ok: true, url: `${BROWSER_URL}/s/${encodeURIComponent(sessionId)}?t=${token}` });
    return;
  }
  if (request.method === "POST" && url.pathname === "/update-request") {
    let sessionId = "";
    try {
      const body = JSON.parse(await readBody(request));
      sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    } catch (error) {
      if (error instanceof BodyTooLarge) throw error;
    }
    const outcome = await updateRequester.request(sessionId);
    send(response, outcome.ok ? 200 : UPDATE_STATUS[outcome.code] ?? 502, outcome);
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
      await callServer(`/canvas/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {
      });
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
  startBridge({
    url: `${SERVER_URL}/events`,
    token: () => readToken(),
    beforeConnect: ensure,
    onEvent: (event) => void host.emit("canvas", { rootId: event.rootId }).catch(() => {
    })
  });
});
