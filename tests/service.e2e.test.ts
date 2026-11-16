// Sobe o serviço real (service/main.ts) em processo filho, como o host faz, e exercita o
// caminho completo: plugin → caixa de entrada → serviço → HTTP, incluindo CA9 (session-deleted).

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import plugin from "../plugin/index.ts";
import { UPDATE_REQUEST_TEXT } from "../src/shared/contract.ts";

const TOKEN = "token-de-teste";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let dir = "";
let port = 0;
let child: ChildProcess | undefined;
let logs = "";
let fakeHost: http.Server | undefined;
const hostCalls: Array<{ method: string; input: any }> = [];
const hostStatus = new Map<string, "idle" | "busy" | "waiting">();
let hostRefusal: { code: string; status: number; method?: string } | null = null;
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

/** Host de mentira: o callback HTTP que o OpenChamber oferece ao serviço (POST /service/call). */
function startFakeHost(): Promise<number> {
  return new Promise((resolve) => {
    fakeHost = http.createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const answer = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
        if (request.headers.authorization !== `Bearer ${TOKEN}`) return answer(401, { error: { code: "HOST_UNAVAILABLE", message: "token" } });
        const { method, input } = JSON.parse(raw) as { method: string; input: any };
        hostCalls.push({ method, input });
        if (hostRefusal && (hostRefusal.method ? method === hostRefusal.method : method.startsWith("sessions."))) return answer(hostRefusal.status, { error: { code: hostRefusal.code, message: "recusado" } });
        if (method === "sessions.status") return answer(200, { result: { status: hostStatus.get(input.sessionId) ?? "idle" } });
        if (method === "sessions.send") return answer(200, { result: { sent: true } });
        if (method === "panels.emit") return answer(200, { result: { delivered: true } });
        return answer(404, { error: { code: "HOST_UNAVAILABLE", message: "método desconhecido" } });
      });
    });
    fakeHost.listen(0, "127.0.0.1", () => {
      const address = fakeHost?.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cv-e2e-"));
  port = await freePort();
  const hostPort = await startFakeHost();
  process.env.OPENCHAMBER_CANVAS_INBOX = path.join(dir, "inbox");
  child = spawn(process.execPath, ["service/main.ts"], {
    cwd: root,
    env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN, OPENCHAMBER_SERVICE_DATA_DIR: path.join(dir, "data"), OPENCHAMBER_CANVAS_INBOX: path.join(dir, "inbox"), OPENCHAMBER_HOST_CALLBACK_URL: `http://127.0.0.1:${hostPort}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { logs += String(chunk); });
  child.stderr?.on("data", (chunk) => { logs += String(chunk); });
  await waitFor(() => fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((r) => r.status, () => 0), (status) => status === 200, 8000);
});

after(async () => {
  child?.kill();
  fakeHost?.close();
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
    assert.match(await publish("ses_c", '<p>ok</p><script>fetch("http://evil")</script><img src="http://evil/x">', "c"), /Avisos/);
    const { json } = await waitFor(() => call("GET", "/canvas?sessionId=ses_c"), (r) => r.json.canvas !== null, 2000);
    assert.deepEqual(json.canvas.blocked.sort(), ["<img>", "<script>"]);
    assert.equal(JSON.stringify(json).includes("evil"), false);
  });

  it("links e partes incorporadas chegam ao painel pelo caminho completo", async () => {
    const tools: Array<{ execute: (i: unknown, c: { sessionID: string }) => Promise<{ content: string }> }> = [];
    await plugin.setup({ tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool as never) }) } });
    const html = '<p><a href="https://github.com/org/repo/pull/1" onclick="x()">PR</a> <a href="javascript:alert(1)">ruim</a></p><div data-embed="g" data-height="200">alt</div>';
    assert.match((await tools[0]!.execute({ html, title: "E", embeds: [{ id: "g", html: "<style>a{}</style><svg></svg><script>1</script>" }] }, { sessionID: "ses_e" })).content, /publicado/);
    const { json } = await waitFor(() => call("GET", "/canvas?sessionId=ses_e"), (r) => r.json.canvas !== null, 2000);
    assert.deepEqual(json.canvas.embeds, { g: "<style>a{}</style><svg></svg><script>1</script>" });
    assert.equal(json.version, 3);
    const text = JSON.stringify(json.canvas.tree);
    assert.ok(text.includes("https://github.com/org/repo/pull/1"));
    assert.equal(text.includes("javascript"), false);
    assert.equal(text.includes("onclick"), false);
    await call("POST", "/session-events", sessionDeleted("ses_e"));
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

  describe("botão Atualizar (POST /update-request)", () => {
    const sends = () => hostCalls.filter((call) => call.method === "sessions.send");

    it("CA1/CA6: agente ocioso → o host recebe sessions.send na sessão pedida com o texto fixo, sem conteúdo de canvas", async () => {
      assert.match(await publish("ses_upd", "<p>SEGREDO-DO-CANVAS</p>", "t"), /publicado/);
      const before = sends().length;
      const { status, json } = await call("POST", "/update-request", { sessionId: "ses_upd" });
      assert.equal(status, 200);
      assert.deepEqual(json, { ok: true });
      const sent = sends().slice(before);
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0]!.input, { sessionId: "ses_upd", prompt: UPDATE_REQUEST_TEXT });
      assert.equal(JSON.stringify(sent).includes("SEGREDO"), false);
      assert.ok(hostCalls.some((call) => call.method === "sessions.status" && call.input.sessionId === "ses_upd"), "consulta o status antes de enviar");
    });

    it("CA4: o segundo pedido logo depois responde 429 e não envia", async () => {
      const before = sends().length;
      const { status, json } = await call("POST", "/update-request", { sessionId: "ses_upd" });
      assert.equal(status, 429);
      assert.deepEqual(json, { ok: false, code: "too-soon" });
      assert.equal(sends().length, before);
    });

    it("CA2/CA3: ocupado e esperando resposta → 409 e nada é enviado", async () => {
      hostStatus.set("ses_busy", "busy");
      hostStatus.set("ses_wait", "waiting");
      const before = sends().length;
      assert.deepEqual(await call("POST", "/update-request", { sessionId: "ses_busy" }), { status: 409, json: { ok: false, code: "busy" } });
      assert.deepEqual(await call("POST", "/update-request", { sessionId: "ses_wait" }), { status: 409, json: { ok: false, code: "waiting" } });
      assert.equal(sends().length, before);
    });

    it("sessionId inválido ou corpo ilegível → 400; sem token → 401", async () => {
      assert.equal((await call("POST", "/update-request", { sessionId: "../x" })).status, 400);
      assert.equal((await call("POST", "/update-request", {})).status, 400);
      const raw = await fetch(`http://127.0.0.1:${port}/update-request`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{lixo" });
      assert.equal(raw.status, 400);
      assert.equal((await call("POST", "/update-request", { sessionId: "ses_x" }, null)).status, 401);
    });

    it("permissão não concedida (extensão não reaprovada) → 403 e o serviço segue de pé", async () => {
      hostRefusal = { code: "NOT_GRANTED", status: 403 };
      const { status, json } = await call("POST", "/update-request", { sessionId: "ses_naoaprovada" });
      hostRefusal = null;
      assert.equal(status, 403);
      assert.deepEqual(json, { ok: false, code: "not-granted" });
      assert.equal((await call("GET", "/health")).status, 200);
    });

    it("host que falha por outro motivo → 502, sem eco da mensagem do host", async () => {
      hostRefusal = { code: "SESSION_FAILED", status: 500 };
      const { status, json } = await call("POST", "/update-request", { sessionId: "ses_falha" });
      hostRefusal = null;
      assert.equal(status, 502);
      assert.deepEqual(json, { ok: false, code: "host-refused" });
    });

    it("B1: envio sem resposta utilizável → 502 'unconfirmed' e o pedido seguinte da mesma sessão é recusado (sem duplicar)", async () => {
      hostRefusal = { code: "HOST_UNAVAILABLE", status: 503, method: "sessions.send" };
      const first = await call("POST", "/update-request", { sessionId: "ses_semresposta" });
      hostRefusal = null;
      assert.deepEqual(first, { status: 502, json: { ok: false, code: "unconfirmed" } });
      const before = sends().length;
      assert.deepEqual(await call("POST", "/update-request", { sessionId: "ses_semresposta" }), { status: 429, json: { ok: false, code: "too-soon" } });
      assert.equal(sends().length, before);
    });

    it("B2: SESSION_BUSY no envio → 409 busy", async () => {
      hostRefusal = { code: "SESSION_BUSY", status: 409, method: "sessions.send" };
      const result = await call("POST", "/update-request", { sessionId: "ses_busyenvio" });
      hostRefusal = null;
      assert.deepEqual(result, { status: 409, json: { ok: false, code: "busy" } });
    });

    it("a falha anterior não bloqueia: logo depois o pedido da mesma sessão funciona", async () => {
      const { status } = await call("POST", "/update-request", { sessionId: "ses_falha" });
      assert.equal(status, 200);
    });
  });

  it("não vaza conteúdo de canvas nos logs", () => {
    assert.equal(logs.includes("evil"), false);
  });
});
