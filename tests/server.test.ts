import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { SERVICE_VERSION } from "../src/shared/contract.ts";
import { aliasFile, canvasFile, metaFile, sessionDir, serverFile } from "../src/shared/paths.ts";
import { readToken } from "../src/shared/token.ts";

const PORT = 20311;
const BASE = `http://127.0.0.1:${PORT}`;

let home = "";
let env: Record<string, string> = {};
let child: ChildProcess;
let token = "";

function start(): ChildProcess {
  return spawn(process.execPath, [path.resolve("server/main.ts")], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: "ignore" });
}

const exited = (proc: ChildProcess): Promise<number | null> => new Promise((resolve) => (proc.exitCode !== null ? resolve(proc.exitCode) : proc.once("exit", (code) => resolve(code))));

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("servidor não subiu");
}

const get = (p: string, init: RequestInit = {}): Promise<Response> => fetch(`${BASE}${p}`, { redirect: "manual", ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) } });

async function writeCanvas(rootId: string, html: string, title = "T"): Promise<void> {
  await mkdir(sessionDir(rootId, env), { recursive: true });
  await writeFile(metaFile(rootId, env), JSON.stringify({ title }));
  await writeFile(canvasFile(rootId, env), html);
}

describe("servidor único", () => {
  before(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "ocv-server-"));
    env = { OPENCHAMBER_CANVAS_HOME: home, OPENCHAMBER_CANVAS_PORT: String(PORT), OPENCHAMBER_CANVAS_HOST: "127.0.0.1" };
    child = start();
    await waitHealth();
    token = (await readToken(env)) ?? "";
  });

  after(async () => {
    child.kill();
    await exited(child);
    await rm(home, { recursive: true, force: true });
  });

  it("/health é aberto e informa a versão; o resto exige token", async () => {
    const health = await (await fetch(`${BASE}/health`)).json();
    assert.deepEqual(health, { ok: true, version: SERVICE_VERSION });
    assert.equal((await fetch(`${BASE}/canvas?session=ses_a`)).status, 401);
    assert.equal((await fetch(`${BASE}/canvas?session=ses_a`, { headers: { authorization: "Bearer errado" } })).status, 401);
    assert.equal((await get("/canvas?session=ses_a")).status, 200);
  });

  it("grava server.json e o token em 0600", async () => {
    const info = JSON.parse(await readFile(serverFile(env), "utf8"));
    assert.equal(info.port, PORT);
    assert.equal(info.version, SERVICE_VERSION);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  });

  it("devolve o canvas livre e resolve o alias do subagente para a raiz", async () => {
    await writeCanvas("ses_root", "<h1>oi</h1><script>1</script>", "Meu canvas");
    await mkdir(path.dirname(aliasFile("ses_child", env)), { recursive: true });
    await writeFile(aliasFile("ses_child", env), "ses_root");
    const viaRoot = await (await get("/canvas?session=ses_root")).json();
    const viaChild = await (await get("/canvas?session=ses_child")).json();
    assert.equal(viaRoot.canvas.html, "<h1>oi</h1><script>1</script>");
    assert.equal(viaRoot.canvas.title, "Meu canvas");
    assert.equal(viaChild.rootId, "ses_root");
    assert.equal(viaChild.canvas.html, viaRoot.canvas.html);
  });

  it("sessão sem canvas devolve canvas nulo; id inválido, 400", async () => {
    const empty = await (await get("/canvas?session=ses_nada")).json();
    assert.equal(empty.canvas, null);
    assert.equal((await get("/canvas?session=..%2Fx")).status, 400);
    assert.equal((await get("/canvas?session=")).status, 400);
  });

  it("alias com conteúdo inválido (path traversal) é ignorado", async () => {
    await writeFile(aliasFile("ses_evil", env), "../../etc");
    const body = await (await get("/canvas?session=ses_evil")).json();
    assert.equal(body.rootId, "ses_evil");
    assert.equal(body.canvas, null);
  });

  it("?t= troca o token por cookie HttpOnly e redireciona sem o token", async () => {
    const response = await fetch(`${BASE}/s/ses_root?t=${token}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/s/ses_root");
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const page = await fetch(`${BASE}/s/ses_root`, { headers: { cookie: cookie.split(";")[0] ?? "" } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("referrer-policy") ?? "", /no-referrer/);
  });

  it("a gravação do arquivo vira um evento SSE, rápido, uma vez só", async () => {
    // deixa assentar os eventos das gravações dos testes anteriores
    await new Promise((resolve) => setTimeout(resolve, 300));
    const response = await get("/events");
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ rootId: string }> = [];
    let buffer = "";
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value);
        for (const frame of buffer.split("\n\n").slice(0, -1)) if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const t0 = performance.now();
    await writeFile(canvasFile("ses_root", env), "<h1>novo</h1>");
    while (!events.some((e) => e.rootId === "ses_root") && performance.now() - t0 < 2000) await new Promise((resolve) => setTimeout(resolve, 5));
    const latency = performance.now() - t0;
    assert.ok(events.some((e) => e.rootId === "ses_root"), "evento recebido");
    assert.ok(latency < 500, `latência ${latency.toFixed(0)} ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(events.filter((e) => e.rootId === "ses_root").length, 1);
    await reader.cancel();
    await pump.catch(() => {});
  });

  it("DELETE de subagente remove só o alias; DELETE da raiz remove o canvas", async () => {
    assert.equal((await get("/canvas/ses_child", { method: "DELETE" })).status, 200);
    const kept = await (await get("/canvas?session=ses_root")).json();
    assert.ok(kept.canvas, "canvas da raiz continua");
    const orphan = await (await get("/canvas?session=ses_child")).json();
    assert.equal(orphan.rootId, "ses_child");
    assert.equal((await get("/canvas/ses_root", { method: "DELETE" })).status, 200);
    assert.equal((await (await get("/canvas?session=ses_root")).json()).canvas, null);
  });

  it("um segundo processo sai com 0 (a porta é o lock) e o primeiro segue no ar", async () => {
    const second = start();
    assert.equal(await exited(second), 0);
    assert.equal((await fetch(`${BASE}/health`)).status, 200);
  });

  it("POST /shutdown exige token e encerra o servidor", async () => {
    assert.equal((await fetch(`${BASE}/shutdown`, { method: "POST" })).status, 401);
    assert.equal((await get("/shutdown", { method: "POST" })).status, 200);
    assert.equal(await exited(child), 0);
    await assert.rejects(fetch(`${BASE}/health`));
  });
});
