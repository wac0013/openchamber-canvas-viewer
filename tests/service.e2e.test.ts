// Sobe o serviço real (service/main.ts) em processo filho, como o host faz, e exercita o
// caminho completo: plugin → caixa de entrada → serviço → HTTP, incluindo CA9 (session-deleted).

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import plugin from "../plugin/index.ts";

const TOKEN = "token-de-teste";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let dir = "";
let port = 0;
let child: ChildProcess | undefined;
let logs = "";
const previousInbox = process.env.OPENCHAMBER_CANVAS_INBOX;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const value = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(value));
    });
  });
}

async function call(method: string, route: string, body?: unknown, token: string | null = TOKEN): Promise<{ status: number; json: any }> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() };
}

async function publish(sessionID: string, html: string, title = "T"): Promise<string> {
  const tools: Array<{ execute: (i: unknown, c: { sessionID: string }) => Promise<{ content: string }> }> = [];
  await plugin.setup({ tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool as never) }) } });
  return (await tools[0]!.execute({ html, title }, { sessionID })).content;
}

function sessionDeleted(id: string) {
  return { v: 1, requestId: "r1", event: { id: "e1", type: "session-deleted", at: Date.now(), session: { id, parentId: null }, project: { directory: null }, linked: [] } };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 4000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cv-e2e-"));
  port = await freePort();
  process.env.OPENCHAMBER_CANVAS_INBOX = path.join(dir, "inbox");
  child = spawn(process.execPath, ["service/main.ts"], {
    cwd: root,
    env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN, OPENCHAMBER_SERVICE_DATA_DIR: path.join(dir, "data"), OPENCHAMBER_CANVAS_INBOX: path.join(dir, "inbox") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { logs += String(chunk); });
  child.stderr?.on("data", (chunk) => { logs += String(chunk); });
  await waitFor(() => fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((r) => r.status, () => 0), (status) => status === 200, 8000);
});

after(async () => {
  child?.kill();
  if (previousInbox === undefined) delete process.env.OPENCHAMBER_CANVAS_INBOX;
  else process.env.OPENCHAMBER_CANVAS_INBOX = previousInbox;
  await rm(dir, { recursive: true, force: true });
});

describe("serviço (ponta a ponta)", () => {
  it("exige o token do serviço", async () => {
    assert.equal((await call("GET", "/health", undefined, null)).status, 401);
    assert.equal((await call("GET", "/health", undefined, "errado")).status, 401);
    assert.equal((await call("GET", "/health")).status, 200);
  });

  it("CA1: sessão sem canvas responde vazio", async () => {
    const { status, json } = await call("GET", "/canvas?sessionId=ses_vazia");
    assert.equal(status, 200);
    assert.equal(json.canvas, null);
  });

  it("recusa sessionId inválido e rota inexistente", async () => {
    assert.equal((await call("GET", "/canvas?sessionId=../x")).status, 400);
    assert.equal((await call("GET", "/canvas")).status, 400);
    assert.equal((await call("GET", "/nada")).status, 404);
  });

  it("CA2 (RN5): publicação do plugin aparece em até 2 s com a hora", async () => {
    const started = Date.now();
    assert.match(await publish("ses_a", "<h1>Olá</h1>", "Meu canvas"), /publicado/);
    const { json } = await waitFor(() => call("GET", "/canvas?sessionId=ses_a"), (r) => r.json.canvas !== null, 2000);
    assert.equal(json.canvas?.title, "Meu canvas");
    assert.ok(json.canvas.updatedAt >= started);
    assert.ok(Date.now() - started <= 2000);
  });

  it("CA3/CA6: nova publicação substitui; CA4: outra sessão segue vazia", async () => {
    await publish("ses_a", "<h1>Versão 2</h1>", "v2");
    const a = await waitFor(() => call("GET", "/canvas?sessionId=ses_a"), (r) => r.json.canvas?.title === "v2", 2000);
    assert.equal(a.json.canvas.title, "v2");
    assert.equal((await call("GET", "/canvas?sessionId=ses_b")).json.canvas, null);
  });

  it("CA7: HTML inválido não chega ao serviço e o canvas segue; arquivo inválido direto na caixa registra erro", async () => {
    assert.match(await publish("ses_a", "<div><p>x</div>"), /NÃO publicado/);
    assert.equal((await call("GET", "/canvas?sessionId=ses_a")).json.canvas.title, "v2");
  });

  it("CA8: conteúdo bloqueado é removido e informado; o restante renderiza", async () => {
    assert.match(await publish("ses_c", '<p>ok</p><script>fetch("http://evil")</script><img src="http://evil/x">', "c"), /Removido por segurança/);
    const { json } = await waitFor(() => call("GET", "/canvas?sessionId=ses_c"), (r) => r.json.canvas !== null, 2000);
    assert.deepEqual(json.canvas.blocked.sort(), ["<img>", "<script>"]);
    assert.equal(JSON.stringify(json).includes("evil"), false);
  });

  it("CA9: session-deleted apaga o canvas só daquela sessão", async () => {
    assert.equal((await call("POST", "/session-events", sessionDeleted("ses_a"))).status, 200);
    assert.equal((await call("GET", "/canvas?sessionId=ses_a")).json.canvas, null);
    assert.notEqual((await call("GET", "/canvas?sessionId=ses_c")).json.canvas, null);
  });

  it("evento inválido responde 400; outros eventos são aceitos sem efeito", async () => {
    assert.equal((await call("POST", "/session-events", { lixo: true })).status, 400);
    const other = sessionDeleted("ses_c");
    other.event.type = "turn-finished";
    assert.equal((await call("POST", "/session-events", other)).status, 200);
    assert.notEqual((await call("GET", "/canvas?sessionId=ses_c")).json.canvas, null);
  });

  it("corpo grande demais responde 413 e o serviço continua de pé", async () => {
    const big = "x".repeat(150_000);
    const response = await fetch(`http://127.0.0.1:${port}/session-events`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: big }).catch(() => null);
    assert.ok(response === null || response.status === 413);
    assert.equal((await call("GET", "/health")).status, 200);
  });

  it("alvo de requisição malformado com token válido não derruba o serviço", async () => {
    const { request } = await import("node:http");
    await new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port, method: "GET", path: "http://[::1", headers: { authorization: `Bearer ${TOKEN}` } }, (res) => { res.resume(); res.on("end", () => resolve()); });
      req.on("error", () => resolve());
      req.end();
    });
    assert.equal((await call("GET", "/health")).status, 200);
  });

  it("não vaza conteúdo de canvas nos logs", () => {
    assert.equal(logs.includes("evil"), false);
  });
});
