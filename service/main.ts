/**
 * Serviço local do Canvas Viewer (um por instância do OpenChamber). Não guarda canvas: garante o
 * servidor único no ar (porta fixa), repassa os eventos dele ao painel e faz proxy do HTML.
 * Casca HTTP; a regra está em:
 * - service/ensure-server.ts → descoberta, subida e troca de versão do servidor;
 * - service/bridge.ts        → SSE do servidor → host.emit;
 * - service/update-request.ts → pedido de atualização ao agente.
 */

import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { createServiceHost, readSessionEventRequest } from "@openchamber/sdk";

import { SERVER_PORT, SERVICE_VERSION, SESSION_ID_PATTERN, type CanvasDocResponse, type InfoResponse } from "../src/shared/contract.ts";
import { readToken } from "../src/shared/token.ts";
import { startBridge } from "./bridge.ts";
import { ensureServer, realDeps } from "./ensure-server.ts";
import { createUpdateRequester } from "./update-request.ts";

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
const BODY_MAX_BYTES = 100_000;
const SERVER_PORT_IN_USE = Number(process.env.OPENCHAMBER_CANVAS_PORT || SERVER_PORT);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT_IN_USE}`;
/** Endereço que o navegador usa (Caddy, no homelab). Sem override, vale o loopback. */
const BROWSER_URL = (process.env.OPENCHAMBER_CANVAS_BROWSER_URL || SERVER_URL).replace(/\/+$/, "");

if (!PORT || !TOKEN) {
  console.error("[canvas-viewer] variáveis OPENCHAMBER_SERVICE_PORT/TOKEN ausentes");
  process.exit(1);
}

const host = createServiceHost({ env: process.env });
const updateRequester = createUpdateRequester({
  status: (sessionId) => host.sessions.status(sessionId),
  send: (sessionId, prompt) => host.sessions.send(sessionId, prompt),
});

const deps = realDeps({
  serverScript: fileURLToPath(new URL("../server/main.js", import.meta.url)),
  token: () => readToken(),
  port: SERVER_PORT_IN_USE,
});

/** Uma garantia por vez; quem chega durante ela espera pela mesma. */
let ensuring: Promise<void> | null = null;
function ensure(): Promise<void> {
  ensuring ??= ensureServer(deps, SERVICE_VERSION)
    .then(() => undefined)
    .finally(() => {
      ensuring = null;
    });
  return ensuring;
}

const UPDATE_STATUS: Record<string, number> = { "invalid-session": 400, busy: 409, waiting: 409, "too-soon": 429, "not-granted": 403, "host-refused": 502, unconfirmed: 502 };

function authorized(header: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const given = Buffer.from(String(header ?? ""));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...(status === 413 ? { connection: "close" } : {}),
  });
  response.end(body);
}

class BodyTooLarge extends Error {}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer) => {
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

/** Chamada ao servidor único com o token do disco; sobe o servidor se ele não estiver no ar. */
async function callServer(path: string, init: RequestInit = {}): Promise<Response> {
  await ensure();
  const token = await readToken();
  if (!token) throw new Error("sem token do servidor");
  return fetch(`${SERVER_URL}${path}`, { ...init, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
}

async function route(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const url = new URL(String(request.url || "/"), "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true, version: SERVICE_VERSION });
    return;
  }
  if (request.method === "GET" && url.pathname === "/canvas") {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      send(response, 400, { ok: false, error: "sessionId inválido" } satisfies CanvasDocResponse);
      return;
    }
    const upstream = await callServer(`/canvas?session=${encodeURIComponent(sessionId)}`);
    const body = (await upstream.json()) as CanvasDocResponse;
    send(response, upstream.ok ? 200 : 502, body.ok ? { ...body, version: SERVICE_VERSION } : body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/info") {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      send(response, 400, { ok: false, error: "sessionId inválido" } satisfies InfoResponse);
      return;
    }
    await ensure();
    const token = await readToken();
    if (!token) {
      send(response, 502, { ok: false, error: "sem token do servidor" } satisfies InfoResponse);
      return;
    }
    send(response, 200, { ok: true, url: `${BROWSER_URL}/s/${encodeURIComponent(sessionId)}?t=${token}` } satisfies InfoResponse);
    return;
  }
  if (request.method === "POST" && url.pathname === "/update-request") {
    let sessionId = "";
    try {
      const body = JSON.parse(await readBody(request)) as { sessionId?: unknown };
      sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    } catch (error) {
      if (error instanceof BodyTooLarge) throw error;
    }
    const outcome = await updateRequester.request(sessionId);
    send(response, outcome.ok ? 200 : (UPDATE_STATUS[outcome.code] ?? 502), outcome);
    return;
  }
  if (request.method === "POST" && url.pathname === "/session-events") {
    const event = readSessionEventRequest(await readBody(request));
    if (!event) {
      send(response, 400, { ok: false, error: "evento inválido" });
      return;
    }
    const sessionId = event.event.session.id;
    if (event.event.type === "session-deleted" && SESSION_ID_PATTERN.test(sessionId)) {
      await callServer(`/canvas/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {});
    }
    send(response, 200, { ok: true });
    return;
  }
  send(response, 404, { ok: false, error: "rota inexistente" });
}

const server = http.createServer((request, response) => {
  if (!authorized(request.headers.authorization)) {
    send(response, 401, { ok: false, error: "token do serviço inválido" });
    return;
  }
  route(request, response).catch((error: unknown) => {
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
    onEvent: (event) => void host.emit("canvas", { rootId: event.rootId }).catch(() => {}),
  });
});
