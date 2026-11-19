import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { realDeps } from "../service/ensure-server.ts";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, calls: Call[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("realDeps.health", () => {
  it("devolve a resposta quando o servidor responde ok com versão numérica", async () => {
    const calls: Call[] = [];
    const deps = realDeps({ serverScript: "x", token: async () => null, port: 20320, fetchImpl: fakeFetch(() => jsonResponse({ ok: true, version: 5 }), calls) });
    assert.deepEqual(await deps.health(), { ok: true, version: 5 });
    assert.equal(calls[0]?.url, "http://127.0.0.1:20320/health");
  });

  it("devolve null para status de erro, corpo inesperado ou falha de rede", async () => {
    const make = (handler: () => Response | Promise<Response>) => realDeps({ serverScript: "x", token: async () => null, fetchImpl: fakeFetch(handler) });
    assert.equal(await make(() => jsonResponse({ ok: true, version: 5 }, 500)).health(), null);
    assert.equal(await make(() => jsonResponse({ ok: false, version: 5 })).health(), null);
    assert.equal(await make(() => jsonResponse({ ok: true, version: "5" })).health(), null);
    assert.equal(await make(() => jsonResponse(null)).health(), null);
    assert.equal(await make(() => new Response("não é json")).health(), null);
    assert.equal(await make(() => Promise.reject(new Error("ECONNREFUSED"))).health(), null);
  });
});

describe("realDeps.shutdownBelow", () => {
  it("envia POST /shutdown?below=<versão> com o token como Bearer", async () => {
    const calls: Call[] = [];
    const deps = realDeps({ serverScript: "x", token: async () => "tok", port: 20321, fetchImpl: fakeFetch(() => jsonResponse({ ok: true }), calls) });
    await deps.shutdownBelow(7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://127.0.0.1:20321/shutdown?below=7");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(calls[0]?.init?.headers, { authorization: "Bearer tok" });
  });

  it("sem token não faz requisição", async () => {
    const calls: Call[] = [];
    const deps = realDeps({ serverScript: "x", token: async () => null, fetchImpl: fakeFetch(() => jsonResponse({ ok: true }), calls) });
    await deps.shutdownBelow(7);
    assert.equal(calls.length, 0);
  });

  it("falha de rede é engolida", async () => {
    const deps = realDeps({ serverScript: "x", token: async () => "tok", fetchImpl: fakeFetch(() => Promise.reject(new Error("boom"))) });
    await assert.doesNotReject(deps.shutdownBelow(7));
  });
});

describe("realDeps.sleep", () => {
  it("resolve depois do tempo pedido", async () => {
    const deps = realDeps({ serverScript: "x", token: async () => null });
    const start = Date.now();
    await deps.sleep(20);
    assert.ok(Date.now() - start >= 15);
  });
});

describe("realDeps.spawnServer", () => {
  let dir = "";
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ocv-spawn-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("sobe o script com ambiente mínimo: repassa só as variáveis permitidas e não vaza segredos", async () => {
    const out = path.join(dir, "env.json");
    const script = path.join(dir, "fake-server.mjs");
    await writeFile(script, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify(process.env));\n`);
    const deps = realDeps({
      serverScript: script,
      token: async () => null,
      env: { PATH: process.env.PATH, OPENCHAMBER_CANVAS_PORT: "20322", OPENCHAMBER_CANVAS_HOME: dir, SEGREDO_DO_SERVICO: "nao-vazar" },
    });
    deps.spawnServer();
    let raw = "";
    for (let i = 0; i < 100 && !raw; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      raw = await readFile(out, "utf8").catch(() => "");
    }
    assert.ok(raw, "o filho não executou o script");
    const childEnv = JSON.parse(raw) as Record<string, string>;
    assert.equal(childEnv.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(childEnv.OPENCHAMBER_CANVAS_PORT, "20322");
    assert.equal(childEnv.OPENCHAMBER_CANVAS_HOME, dir);
    assert.equal(childEnv.SEGREDO_DO_SERVICO, undefined);
    assert.equal(childEnv.OPENCHAMBER_CANVAS_HOST, undefined);
  });
});
