// Ponta a ponta: 3 serviços reais (um por instância do OpenChamber) sobem UM servidor único; o
// plugin publica um arquivo e os 3 hosts de mentira recebem `panels.emit` em < 150 ms (CA1).
// Também cobre: subagente → canvas da raiz, token, DELETE por sessão, /frame e página do navegador.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import plugin from "../plugin/index.ts";
import { UPDATE_REQUEST_TEXT } from "../src/shared/contract.ts";

const SERVICE_TOKEN = "token-do-servico";
let home = "";
let serverPort = 0;
let serverToken = "";
const services: Array<{ child: ChildProcess; port: number; host: http.Server; emits: Array<{ at: number; data: any }>; calls: Array<{ method: string; input: any }> }> = [];
const previousHome = process.env.OPENCHAMBER_CANVAS_HOME;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const value = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(value));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, ms = 8000): Promise<T> {
  const limit = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > limit) return value;
    await sleep(25);
  }
}

async function startService() {
  const emits: Array<{ at: number; data: any }> = [];
  const calls: Array<{ method: string; input: any }> = [];
  const host = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const answer = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      const { method, input } = JSON.parse(raw) as { method: string; input: any };
      calls.push({ method, input });
      if (method === "panels.emit") {
        emits.push({ at: Date.now(), data: input.data });
        return answer(200, { result: { delivered: true } });
      }
      if (method === "sessions.status") return answer(200, { result: { status: "idle" } });
      if (method === "sessions.send") return answer(200, { result: { sent: true } });
      return answer(404, { error: { code: "HOST_UNAVAILABLE", message: "método desconhecido" } });
    });
  });
  await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
  const hostPort = (host.address() as { port: number }).port;
  const port = await freePort();
  const child = spawn(process.execPath, [path.resolve("service/main.ts")], {
    env: {
      PATH: process.env.PATH ?? "",
      OPENCHAMBER_CANVAS_HOME: home,
      OPENCHAMBER_CANVAS_PORT: String(serverPort),
      OPENCHAMBER_CANVAS_HOST: "127.0.0.1",
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: SERVICE_TOKEN,
      OPENCHAMBER_HOST_CALLBACK_URL: `http://127.0.0.1:${hostPort}`,
    },
    stdio: "ignore",
  });
  const entry = { child, port, host, emits, calls };
  services.push(entry);
  await until(() => fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } }).then((r) => r.ok, () => false), Boolean);
  return entry;
}

const callService = async (index: number, method: string, route: string, body?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${services[index]!.port}${route}`, {
    method,
    headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: (await response.json()) as any };
};

const server = (route: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${serverPort}${route}`, { ...init, headers: { authorization: `Bearer ${serverToken}`, ...(init.headers ?? {}) } });

/** Plugin real com consulta de pai simulada: `parents` mapeia subagente → pai. */
async function tools(parents: Record<string, string> = {}) {
  const added: Array<{ name: string; execute: (input: unknown, ctx: { sessionID: string }) => Promise<{ content: string }> }> = [];
  await plugin.setup({
    tool: { transform: async (edit) => edit({ add: (tool) => added.push(tool as never) }) },
    session: { get: async ({ sessionID }) => (parents[sessionID] ? { id: sessionID, parentID: parents[sessionID] } : { id: sessionID }) },
  });
  const find = (name: string) => added.find((tool) => tool.name === name)!;
  return { publish: find("canvas_publish"), edit: find("canvas_edit") };
}

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), "cv-e2e-"));
  process.env.OPENCHAMBER_CANVAS_HOME = home;
  serverPort = await freePort();
  // 3 instâncias iniciando juntas: só um servidor pode ficar de pé.
  await Promise.all([startService(), startService(), startService()]);
  serverToken = (await until(() => readFile(path.join(home, "token"), "utf8").catch(() => ""), Boolean)).trim();
  await until(() => fetch(`http://127.0.0.1:${serverPort}/health`).then((r) => r.ok, () => false), Boolean);
  // as pontes (SSE) dos 3 serviços precisam estar conectadas antes de publicar
  await sleep(500);
});

after(async () => {
  for (const service of services) {
    service.child.kill();
    service.host.close();
  }
  await fetch(`http://127.0.0.1:${serverPort}/shutdown`, { method: "POST", headers: { authorization: `Bearer ${serverToken}` } }).catch(() => {});
  if (previousHome === undefined) delete process.env.OPENCHAMBER_CANVAS_HOME;
  else process.env.OPENCHAMBER_CANVAS_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("servidor único + 3 serviços", () => {
  it("CA1: uma publicação chega aos 3 painéis em menos de 150 ms", async () => {
    const { publish } = await tools();
    const before = services.map((service) => service.emits.length);
    const started = Date.now();
    assert.match((await publish.execute({ html: "<h1>Olá</h1>", title: "Meu canvas" }, { sessionID: "ses_raiz" })).content, /publicado/i);
    await until(() => services.every((service, i) => service.emits.length > before[i]!), Boolean, 2000);
    for (const [i, service] of services.entries()) {
      const emit = service.emits[before[i]!];
      assert.ok(emit, `serviço ${i} recebeu o evento`);
      assert.deepEqual(emit.data, { rootId: "ses_raiz" });
      assert.ok(emit.at - started < 150, `serviço ${i}: ${emit.at - started} ms`);
    }
  });

  it("o painel lê o canvas pelo serviço e o servidor aceita só o token", async () => {
    const { status, json } = await callService(1, "GET", "/canvas?sessionId=ses_raiz");
    assert.equal(status, 200);
    assert.equal(json.canvas.title, "Meu canvas");
    assert.equal(json.canvas.html, "<h1>Olá</h1>");
    assert.equal((await fetch(`http://127.0.0.1:${serverPort}/canvas?session=ses_raiz`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${serverPort}/canvas?session=ses_raiz`, { headers: { authorization: "Bearer errado" } })).status, 401);
  });

  it("subagente publica no canvas da raiz; o painel aberto no subagente vê o da raiz", async () => {
    const { publish } = await tools({ ses_sub: "ses_raiz" });
    await publish.execute({ html: "<p>do subagente</p>", title: "Raiz" }, { sessionID: "ses_sub" });
    const fromRoot = await callService(0, "GET", "/canvas?sessionId=ses_raiz");
    assert.equal(fromRoot.json.canvas.html, "<p>do subagente</p>");
    const fromSub = await callService(0, "GET", "/canvas?sessionId=ses_sub");
    assert.equal(fromSub.json.rootId, "ses_raiz");
    assert.equal(fromSub.json.canvas.html, "<p>do subagente</p>");
  });

  it("Write direto no arquivo da sessão também dispara o hot reload", async () => {
    const before = services.map((service) => service.emits.length);
    await writeFile(path.join(home, "sessions", "ses_raiz", "index.html"), "<p>editado à mão</p>");
    await until(() => services.every((service, i) => service.emits.length > before[i]!), Boolean, 2000);
    assert.equal((await callService(2, "GET", "/canvas?sessionId=ses_raiz")).json.canvas.html, "<p>editado à mão</p>");
  });

  it("apagar o subagente não remove o canvas da raiz; apagar a raiz remove", async () => {
    const event = (id: string) => ({ v: 1, requestId: "r1", event: { id: "e1", type: "session-deleted", at: Date.now(), session: { id, parentId: null }, project: { directory: null }, linked: [] } });
    assert.equal((await callService(0, "POST", "/session-events", event("ses_sub"))).status, 200);
    assert.equal((await callService(0, "GET", "/canvas?sessionId=ses_raiz")).json.canvas.html, "<p>editado à mão</p>");
    assert.equal((await callService(0, "POST", "/session-events", event("ses_raiz"))).status, 200);
    assert.equal((await callService(0, "GET", "/canvas?sessionId=ses_raiz")).json.canvas, null);
  });

  it("/info devolve o link do navegador com o token; /frame monta o documento com CSP e sandbox no cliente", async () => {
    const { publish } = await tools();
    await publish.execute({ html: '<link data-kit><div class="ck-card" data-canvas-item="a">x</div>', title: "Kit" }, { sessionID: "ses_kit" });
    const info = await callService(0, "GET", "/info?sessionId=ses_kit");
    assert.equal(info.json.url, `http://127.0.0.1:${serverPort}/s/ses_kit?t=${serverToken}`);
    const frame = (await (await server("/frame?session=ses_kit&state=%7B%22filters%22%3A%5B%5D%2C%22removed%22%3A%5B%22a%22%5D%7D&scroll=0")).json()) as any;
    assert.equal(frame.ok, true);
    assert.match(frame.srcdoc, /Content-Security-Policy/);
    assert.match(frame.srcdoc, /connect-src 'none'/);
    assert.match(frame.srcdoc, /\.ck-card\{/);
    assert.equal(frame.srcdoc.includes("data-kit"), false);
    const shell = await (await server("/s/ses_kit")).text();
    assert.match(shell, /sandbox","allow-scripts"/);
    assert.equal(shell.includes("allow-same-origin"), false);
    assert.equal(shell.includes("ck-card"), false, "o HTML do agente nunca entra na casca");
  });

  it("botão Atualizar: o texto fixo vai para a sessão pedida, sem conteúdo de canvas", async () => {
    const result = await callService(1, "POST", "/update-request", { sessionId: "ses_raiz" });
    assert.equal(result.status, 200);
    const sent = services[1]!.calls.filter((call) => call.method === "sessions.send");
    assert.equal(sent.at(-1)?.input.sessionId, "ses_raiz");
    assert.equal(sent.at(-1)?.input.prompt ?? sent.at(-1)?.input.text, UPDATE_REQUEST_TEXT);
  });

  it("rejeita sessionId inválido", async () => {
    assert.equal((await callService(0, "GET", "/canvas?sessionId=../x")).status, 400);
    assert.equal((await callService(0, "GET", "/info")).status, 400);
  });
});
