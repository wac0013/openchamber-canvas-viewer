/**
 * Servidor único do Canvas Viewer (um por máquina, porta fixa). Guarda os canvases em arquivo,
 * vigia as mudanças e avisa por SSE. Casca: a regra está em routes.ts e watch.ts.
 *
 * Exclusão mútua pela porta: se `listen` der EADDRINUSE, outro já é o dono e este sai com 0.
 */

import http from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";

import { SERVER_PORT, SERVICE_VERSION } from "../src/shared/contract.ts";
import { canvasHome, sessionsDir, serverFile } from "../src/shared/paths.ts";
import { ensureToken } from "../src/shared/token.ts";
import { createRoutes, ensureDirs } from "./routes.ts";
import { watchSessions } from "./watch.ts";

const PORT = Number(process.env.OPENCHAMBER_CANVAS_PORT || SERVER_PORT);
const HOST = process.env.OPENCHAMBER_CANVAS_HOST || "0.0.0.0";
/** Sem nenhum cliente SSE por este tempo, o servidor encerra (o próximo serviço sobe outro). */
const IDLE_MS = Number(process.env.OPENCHAMBER_CANVAS_IDLE_MS || 30 * 60_000);

async function main(): Promise<void> {
  await ensureDirs();
  const token = await ensureToken();
  let stop: () => void = () => process.exit(0);

  const routes = createRoutes({ token, version: SERVICE_VERSION, onShutdown: () => stop() });
  const server = http.createServer((request, response) => {
    routes.handle(request, response).catch((error: unknown) => {
      console.error("[canvas-server] erro:", error instanceof Error ? error.message : "erro");
      if (response.headersSent) return;
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "erro interno" }));
    });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") process.exit(0);
    console.error("[canvas-server] falha ao ouvir:", error.message);
    process.exit(1);
  });

  await new Promise<void>((resolve) => server.listen(PORT, HOST, resolve));

  const watcher = await watchSessions(sessionsDir(), (rootId) => void routes.publish(rootId));
  await writeFile(serverFile(), JSON.stringify({ pid: process.pid, port: PORT, version: SERVICE_VERSION }), { encoding: "utf8", mode: 0o600 });

  let stopping = false;
  stop = () => {
    if (stopping) return;
    stopping = true;
    watcher.close();
    routes.closeClients();
    void (async () => {
      // Só apaga o server.json se ainda for o nosso (um servidor novo pode já ter escrito o dele).
      try {
        const current: unknown = JSON.parse(await readFile(serverFile(), "utf8"));
        if (current && typeof current === "object" && (current as { pid?: unknown }).pid === process.pid) await rm(serverFile(), { force: true });
      } catch {
        // sem arquivo
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    })();
  };

  let idleSince = Date.now();
  setInterval(() => {
    if (routes.clientCount() > 0) idleSince = Date.now();
    else if (Date.now() - idleSince > IDLE_MS) stop();
  }, Math.min(IDLE_MS, 60_000)).unref();

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(`[canvas-server] v${SERVICE_VERSION} em ${HOST}:${PORT} (${canvasHome()})`);
}

main().catch((error: unknown) => {
  console.error("[canvas-server] falha:", error instanceof Error ? error.message : "erro");
  process.exit(1);
});
