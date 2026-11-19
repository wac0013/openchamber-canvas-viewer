// Rotas HTTP do servidor único. Regra de negócio aqui (e em watch.ts); server/main.ts só costura.
// Toda rota, menos /health, exige o token (Authorization: Bearer, ?t= ou cookie HttpOnly).

import type http from "node:http";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";

import { LIMITS, SESSION_ID_PATTERN, type CanvasDocResponse, type CanvasEvent, type HealthResponse } from "../src/shared/contract.ts";
import { aliasFile, canvasFile, metaFile, sessionDir, sessionsDir } from "../src/shared/paths.ts";
import { sameToken } from "../src/shared/token.ts";
import { BROWSER_THEME, buildFrameDocument } from "../src/canvas/frame-doc.ts";
import { parseViewState } from "../src/canvas/view-state.ts";
import { indexPage, shellPage, type ListedCanvas } from "./page.ts";

type Env = Record<string, string | undefined>;

export type RoutesOptions = {
  env?: Env;
  token: string;
  version: number;
  /** Chamado em POST /shutdown depois de responder. */
  onShutdown: () => void;
};

export type Routes = {
  handle: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;
  /** Anuncia a mudança do canvas de uma sessão raiz a todos os clientes SSE. */
  publish: (rootId: string) => Promise<void>;
  clientCount: () => number;
  closeClients: () => void;
};

const COOKIE = "canvas_token";
const HEARTBEAT_MS = 15_000;

/** Raiz do canvas: a própria sessão, se já tem pasta, senão o alias gravado pelo plugin; senão ela mesma. */
export async function resolveRoot(sessionId: string, env: Env = process.env): Promise<string> {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("id de sessão inválido");
  try {
    await stat(sessionDir(sessionId, env));
    return sessionId;
  } catch {
    // sem pasta própria: pode ser um subagente
  }
  try {
    const alias = (await readFile(aliasFile(sessionId, env), "utf8")).trim();
    if (SESSION_ID_PATTERN.test(alias)) return alias;
  } catch {
    // sem alias
  }
  return sessionId;
}

async function readTitle(rootId: string, env: Env): Promise<string> {
  try {
    const meta: unknown = JSON.parse(await readFile(metaFile(rootId, env), "utf8"));
    const title = meta && typeof meta === "object" ? (meta as { title?: unknown }).title : undefined;
    return typeof title === "string" ? title.slice(0, LIMITS.titleChars) : "";
  } catch {
    return "";
  }
}

async function readDoc(rootId: string, env: Env): Promise<CanvasDocResponse> {
  const file = canvasFile(rootId, env);
  let info;
  try {
    info = await stat(file);
  } catch {
    return { ok: true, rootId, canvas: null };
  }
  if (info.size > LIMITS.canvasBytes) return { ok: false, error: "canvas maior que o limite" };
  const html = await readFile(file, "utf8");
  return { ok: true, rootId, canvas: { title: await readTitle(rootId, env), html, updatedAt: Math.trunc(info.mtimeMs), path: file } };
}

async function listCanvases(env: Env): Promise<ListedCanvas[]> {
  let names: string[];
  try {
    names = await readdir(sessionsDir(env));
  } catch {
    return [];
  }
  const items: ListedCanvas[] = [];
  for (const rootId of names) {
    if (!SESSION_ID_PATTERN.test(rootId)) continue;
    try {
      const info = await stat(canvasFile(rootId, env));
      items.push({ rootId, title: await readTitle(rootId, env), updatedAt: Math.trunc(info.mtimeMs) });
    } catch {
      // pasta sem canvas
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function cookieOf(header: string | undefined, name: string): string {
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function json(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

function html(response: http.ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export function createRoutes(options: RoutesOptions): Routes {
  const env = options.env ?? process.env;
  const clients = new Set<http.ServerResponse>();
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const authorize = (request: http.IncomingMessage, url: URL): { ok: boolean; viaQuery: boolean } => {
    const bearer = String(request.headers.authorization ?? "");
    if (bearer.startsWith("Bearer ") && sameToken(bearer.slice(7), options.token)) return { ok: true, viaQuery: false };
    const query = url.searchParams.get("t");
    if (query && sameToken(query, options.token)) return { ok: true, viaQuery: true };
    if (sameToken(cookieOf(request.headers.cookie, COOKIE), options.token)) return { ok: true, viaQuery: false };
    return { ok: false, viaQuery: false };
  };

  const publish = async (rootId: string): Promise<void> => {
    let updatedAt = Date.now();
    try {
      updatedAt = Math.trunc((await stat(canvasFile(rootId, env))).mtimeMs);
    } catch {
      // apagado: ainda avisa, o painel volta ao estado vazio
    }
    const frame = `data: ${JSON.stringify({ rootId, updatedAt } satisfies CanvasEvent)}\n\n`;
    for (const client of clients) client.write(frame);
  };

  const handle = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, version: options.version } satisfies HealthResponse);
      return;
    }

    const auth = authorize(request, url);
    if (!auth.ok) {
      json(response, 401, { ok: false, error: "não autorizado" });
      return;
    }

    // Primeira visita do navegador: troca o token da URL por cookie e tira-o do endereço.
    if (auth.viaQuery && method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/s/"))) {
      const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      url.searchParams.delete("t");
      response.writeHead(302, {
        location: url.pathname + url.search,
        "set-cookie": `${COOKIE}=${options.token}; Path=/; HttpOnly; SameSite=Strict${secure}`,
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    if (method === "GET" && url.pathname === "/canvas") {
      const session = url.searchParams.get("session") ?? "";
      if (!SESSION_ID_PATTERN.test(session)) {
        json(response, 400, { ok: false, error: "id de sessão inválido" } satisfies CanvasDocResponse);
        return;
      }
      const result = await readDoc(await resolveRoot(session, env), env);
      json(response, result.ok ? 200 : 413, result);
      return;
    }

    if (method === "GET" && url.pathname === "/frame") {
      const session = url.searchParams.get("session") ?? "";
      if (!SESSION_ID_PATTERN.test(session)) {
        json(response, 400, { ok: false, error: "id de sessão inválido" });
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
      let stored: unknown = null;
      try {
        stored = JSON.parse(url.searchParams.get("state") ?? "null");
      } catch {
        // estado ilegível: começa limpo
      }
      const scroll = Number(url.searchParams.get("scroll"));
      const srcdoc = buildFrameDocument({
        html: result.canvas.html,
        theme: BROWSER_THEME,
        colorScheme: "dark",
        mode: "browser",
        state: { ...parseViewState(stored), scroll: Number.isFinite(scroll) ? scroll : 0 },
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
        json(response, 400, { ok: false, error: "id de sessão inválido" });
        return;
      }
      html(response, 200, shellPage(await resolveRoot(id, env)));
      return;
    }

    if (method === "DELETE" && url.pathname.startsWith("/canvas/")) {
      const id = decode(url.pathname.slice("/canvas/".length));
      if (!SESSION_ID_PATTERN.test(id)) {
        json(response, 400, { ok: false, error: "id de sessão inválido" });
        return;
      }
      // Só o que é da própria sessão: apagar um subagente remove o alias, nunca o canvas da raiz.
      await rm(sessionDir(id, env), { recursive: true, force: true });
      await rm(aliasFile(id, env), { force: true });
      await publish(id);
      json(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/shutdown") {
      // `?below=<v>`: só encerra se esta versão for menor. Evita que um serviço atrasado derrube o servidor já trocado.
      const below = Number(url.searchParams.get("below"));
      if (url.searchParams.has("below") && !(options.version < below)) {
        json(response, 409, { ok: false, error: "versão atual não é menor" });
        return;
      }
      json(response, 200, { ok: true });
      response.on("finish", options.onShutdown);
      return;
    }

    json(response, 404, { ok: false, error: "não encontrado" });
  };

  return {
    handle,
    publish,
    clientCount: () => clients.size,
    closeClients() {
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
    },
  };
}

/** Garante as pastas-base (0700) antes de vigiar e servir. */
export async function ensureDirs(env: Env = process.env): Promise<void> {
  await mkdir(sessionsDir(env), { recursive: true, mode: 0o700 });
}
