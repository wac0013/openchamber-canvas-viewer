// Serviço local do Canvas Viewer. O iframe do painel não tem disco; o host spawna este
// processo e faz proxy de serviceRequest para cá. Este arquivo é só a casca HTTP:
// - service/inbox.ts → recebe as publicações do plugin do OpenCode;
// - service/store.ts → persistência por sessão;
// - src/canvas/*     → sanitização (a regra de negócio).

import http from "node:http";

import { createServiceHost, readSessionEventRequest } from "@openchamber/sdk";

import { SERVICE_VERSION, SESSION_ID_PATTERN, type CanvasResponse } from "../src/shared/contract.ts";
import { drainInbox } from "./inbox.ts";
import { inboxDir } from "./paths.ts";
import { createStore } from "./store.ts";

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
const DATA_DIR = process.env.OPENCHAMBER_SERVICE_DATA_DIR || "";
const DRAIN_INTERVAL_MS = 500;

if (!PORT || !TOKEN || !DATA_DIR) {
  console.error("[canvas-viewer] variáveis OPENCHAMBER_SERVICE_PORT/TOKEN/DATA_DIR ausentes");
  process.exit(1);
}

const store = createStore(DATA_DIR);
const inbox = inboxDir();
const host = createServiceHost({ env: process.env });

function send(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new Error("corpo grande demais"));
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

let draining = false;
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (const sessionId of await drainInbox(inbox, store, () => Date.now())) {
      // Aviso imediato ao painel; o polling dele cobre qualquer falha daqui.
      void host.emit("canvas", { sessionId }).catch(() => {});
    }
  } catch (error) {
    console.error("[canvas-viewer] falha ao ler a caixa de entrada:", error instanceof Error ? error.message : "erro");
  } finally {
    draining = false;
  }
}

const server = http.createServer(async (request, response) => {
  if (String(request.headers.authorization || "") !== `Bearer ${TOKEN}`) {
    send(response, 401, { ok: false, error: "token do serviço inválido" });
    return;
  }
  const url = new URL(String(request.url || "/"), "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, { ok: true, version: SERVICE_VERSION });
    } else if (request.method === "GET" && url.pathname === "/canvas") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        send(response, 400, { ok: false, error: "sessionId inválido" } satisfies CanvasResponse);
        return;
      }
      await drain(); // publicação recém-chegada aparece sem esperar o próximo ciclo
      const record = await store.read(sessionId);
      send(response, 200, { ok: true, version: SERVICE_VERSION, canvas: record?.canvas ?? null, error: record?.error ?? null } satisfies CanvasResponse);
    } else if (request.method === "POST" && url.pathname === "/session-events") {
      const event = readSessionEventRequest(await readBody(request));
      if (!event) {
        send(response, 400, { ok: false, error: "evento inválido" });
        return;
      }
      if (event.event.type === "session-deleted" && SESSION_ID_PATTERN.test(event.event.session.id)) {
        await store.remove(event.event.session.id); // CA9
      }
      send(response, 200, { ok: true });
    } else {
      send(response, 404, { ok: false, error: "rota inexistente" });
    }
  } catch (error) {
    // Nunca ecoa conteúdo de canvas: só a categoria.
    console.error("[canvas-viewer] erro:", error instanceof Error ? error.message : "erro");
    send(response, 500, { ok: false, error: "erro interno" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  void drain();
  setInterval(() => void drain(), DRAIN_INTERVAL_MS);
});
