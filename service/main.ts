/**
 * Serviço local do Canvas Viewer. O iframe do painel não tem disco; o host spawna este
 * processo e faz proxy de serviceRequest para cá. Este arquivo é só a casca HTTP:
 * - service/inbox.ts → recebe as publicações do plugin do OpenCode;
 * - service/store.ts → persistência por sessão;
 * - src/canvas/*     → sanitização (a regra de negócio).
 */

import { timingSafeEqual } from "node:crypto";
import http from "node:http";

import { createServiceHost, readSessionEventRequest } from "@openchamber/sdk";

import { SERVICE_VERSION, SESSION_ID_PATTERN, type CanvasResponse } from "../src/shared/contract.ts";
import { discardPending, drainInbox } from "./inbox.ts";
import { inboxDir } from "./paths.ts";
import { createStore } from "./store.ts";
import { createUpdateRequester } from "./update-request.ts";

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
const DATA_DIR = process.env.OPENCHAMBER_SERVICE_DATA_DIR || "";
const DRAIN_INTERVAL_MS = 500;
const BODY_MAX_BYTES = 100_000;

if (!PORT || !TOKEN || !DATA_DIR) {
  console.error("[canvas-viewer] variáveis OPENCHAMBER_SERVICE_PORT/TOKEN/DATA_DIR ausentes");
  process.exit(1);
}

const store = createStore(DATA_DIR);
const inbox = inboxDir();
const host = createServiceHost({ env: process.env });
const updateRequester = createUpdateRequester({
  status: (sessionId) => host.sessions.status(sessionId),
  send: (sessionId, prompt) => host.sessions.send(sessionId, prompt),
});

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

let draining: Promise<void> | null = null;

/** Um ciclo por vez; quem chega durante um ciclo espera por ele em vez de iniciar outro. */
function drain(): Promise<void> {
  draining ??= (async () => {
    try {
      const changed = await drainInbox(inbox, store, () => Date.now(), {
        onError: (sessionId, error) => console.error("[canvas-viewer] publicação adiada:", sessionId, error instanceof Error ? error.message : "erro"),
      });
      for (const sessionId of changed) void host.emit("canvas", { sessionId }).catch(() => {});
    } catch (error) {
      console.error("[canvas-viewer] falha ao ler a caixa de entrada:", error instanceof Error ? error.message : "erro");
    } finally {
      draining = null;
    }
  })();
  return draining;
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
      send(response, 400, { ok: false, error: "sessionId inválido" } satisfies CanvasResponse);
      return;
    }
    await drain();
    const record = await store.read(sessionId);
    send(response, 200, { ok: true, version: SERVICE_VERSION, canvas: record?.canvas ?? null, error: record?.error ?? null } satisfies CanvasResponse);
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
      await discardPending(inbox, sessionId);
      await store.remove(sessionId);
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
  void drain();
  setInterval(() => void drain(), DRAIN_INTERVAL_MS);
});
