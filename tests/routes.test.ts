import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { LIMITS } from "../src/shared/contract.ts";
import { aliasFile, canvasFile, metaFile, sessionDir } from "../src/shared/paths.ts";
import { createRoutes, ensureDirs, resolveRoot, type Routes } from "../server/routes.ts";

const PORT = 20323;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "t".repeat(43);
const VERSION = 9;

let home = "";
let env: Record<string, string> = {};
let routes: Routes;
let server: http.Server;
let shutdowns = 0;

const call = (p: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${p}`, { redirect: "manual", ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers as Record<string, string> | undefined) } });

async function seed(rootId: string, html: string, title?: string, mtime?: number): Promise<void> {
  await mkdir(sessionDir(rootId, env), { recursive: true });
  if (title !== undefined) await writeFile(metaFile(rootId, env), JSON.stringify({ title }));
  await writeFile(canvasFile(rootId, env), html);
  if (mtime !== undefined) await utimes(canvasFile(rootId, env), mtime, mtime);
}

describe("rotas (em processo)", () => {
  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "ocv-routes-"));
    env = { OPENCHAMBER_CANVAS_HOME: home };
    await ensureDirs(env);
    routes = createRoutes({ env, token: TOKEN, version: VERSION, onShutdown: () => (shutdowns += 1) });
    server = http.createServer((req, res) => void routes.handle(req, res));
    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  });

  after(async () => {
    routes.closeClients();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });

  describe("resolveRoot", () => {
    it("rejeita id inválido", async () => {
      await assert.rejects(resolveRoot("../x", env), /inválido/);
    });

    it("usa a própria sessão se ela tem pasta, o alias se não, e ela mesma sem nenhum", async () => {
      await seed("ses_r1", "<p>a</p>");
      await mkdir(path.dirname(aliasFile("ses_f1", env)), { recursive: true });
      await writeFile(aliasFile("ses_f1", env), "ses_r1\n");
      await writeFile(aliasFile("ses_ruim", env), "../fora");
      assert.equal(await resolveRoot("ses_r1", env), "ses_r1");
      assert.equal(await resolveRoot("ses_f1", env), "ses_r1");
      assert.equal(await resolveRoot("ses_ruim", env), "ses_ruim");
      assert.equal(await resolveRoot("ses_solta", env), "ses_solta");
    });
  });

  describe("GET /canvas", () => {
    it("título ilegível ou ausente vira vazio; título longo é cortado", async () => {
      await seed("ses_semmeta", "<p>x</p>");
      await seed("ses_metaruim", "<p>x</p>");
      await writeFile(metaFile("ses_metaruim", env), "{nao json");
      await seed("ses_longo", "<p>x</p>", "T".repeat(LIMITS.titleChars + 50));
      await seed("ses_titulonum", "<p>x</p>");
      await writeFile(metaFile("ses_titulonum", env), JSON.stringify({ title: 5 }));
      for (const id of ["ses_semmeta", "ses_metaruim", "ses_titulonum"]) {
        const body = await (await call(`/canvas?session=${id}`)).json();
        assert.equal(body.canvas.title, "", id);
      }
      const longo = await (await call("/canvas?session=ses_longo")).json();
      assert.equal(longo.canvas.title.length, LIMITS.titleChars);
    });

    it("sem arquivo devolve canvas null; id inválido 400", async () => {
      assert.deepEqual(await (await call("/canvas?session=ses_vazia")).json(), { ok: true, rootId: "ses_vazia", canvas: null });
      assert.equal((await call("/canvas?session=..%2Fx")).status, 400);
      assert.equal((await call("/canvas")).status, 400);
    });

    it("canvas acima do limite responde 413", async () => {
      await seed("ses_grande", "x".repeat(LIMITS.canvasBytes + 1));
      const response = await call("/canvas?session=ses_grande");
      assert.equal(response.status, 413);
      assert.equal((await response.json()).ok, false);
    });
  });

  describe("GET /frame", () => {
    it("id inválido responde 400", async () => {
      assert.equal((await call("/frame?session=a%2Fb")).status, 400);
    });

    it("sem canvas devolve srcdoc null", async () => {
      assert.deepEqual(await (await call("/frame?session=ses_semframe")).json(), { ok: true, rootId: "ses_semframe", srcdoc: null });
    });

    it("canvas acima do limite responde 413", async () => {
      await seed("ses_framegrande", "x".repeat(LIMITS.canvasBytes + 1));
      assert.equal((await call("/frame?session=ses_framegrande")).status, 413);
    });

    it("monta o srcdoc com o HTML do agente, título e a raiz do alias", async () => {
      await seed("ses_fraiz", "<h1 id=marca>oi</h1>", "Meu");
      await writeFile(aliasFile("ses_ffilha", env), "ses_fraiz");
      const body = await (await call("/frame?session=ses_ffilha")).json();
      assert.equal(body.ok, true);
      assert.equal(body.rootId, "ses_fraiz");
      assert.equal(body.title, "Meu");
      assert.equal(typeof body.updatedAt, "number");
      assert.match(body.srcdoc, /<h1 id=marca>oi<\/h1>/);
      assert.match(body.srcdoc, /Content-Security-Policy/);
    });

    it("estado válido entra no srcdoc; estado ilegível e rolagem inválida começam limpos", async () => {
      await seed("ses_festado", "<p>a</p>");
      const state = encodeURIComponent(JSON.stringify({ filters: ["status:ok"], removed: ["item-9"] }));
      const withState = await (await call(`/frame?session=ses_festado&state=${state}&scroll=120`)).json();
      assert.match(withState.srcdoc, /status:ok/);
      assert.match(withState.srcdoc, /item-9/);
      const bad = await (await call("/frame?session=ses_festado&state=%7Bnao-json&scroll=abc")).json();
      assert.equal(bad.ok, true);
      assert.doesNotMatch(bad.srcdoc, /status:ok/);
    });
  });

  describe("GET / e GET /s/<id>", () => {
    it("a página inicial lista os canvases por data (mais recente primeiro) e ignora pastas inválidas ou sem canvas", async () => {
      await seed("ses_idx_velha", "<p>a</p>", "Velha <b>", 1_000_000);
      await seed("ses_idx_nova", "<p>a</p>", "Nova", 2_000_000);
      await mkdir(sessionDir("ses_idx_sempasta", env), { recursive: true });
      await mkdir(path.join(home, "sessions", "nome inválido!"), { recursive: true });
      const response = await call("/");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const page = await response.text();
      assert.ok(page.indexOf("ses_idx_nova") < page.indexOf("ses_idx_velha"));
      assert.doesNotMatch(page, /ses_idx_sempasta/);
      assert.doesNotMatch(page, /nome inválido/);
      assert.doesNotMatch(page, /Velha <b>/);
    });

    it("a página de uma sessão usa a raiz do alias; id inválido 400", async () => {
      await seed("ses_sraiz", "<p>a</p>");
      await writeFile(aliasFile("ses_sfilha", env), "ses_sraiz");
      const page = await (await call("/s/ses_sfilha")).text();
      assert.match(page, /ses_sraiz/);
      assert.equal((await call("/s/a%2Fb")).status, 400);
      assert.equal((await call("/s/%E0%A4%A")).status, 400);
    });
  });

  describe("DELETE /canvas/<id>", () => {
    it("id inválido responde 400", async () => {
      assert.equal((await call("/canvas/a%2Fb", { method: "DELETE" })).status, 400);
      assert.equal((await call("/canvas/%E0%A4%A", { method: "DELETE" })).status, 400);
    });
  });

  describe("POST /shutdown", () => {
    it("com below maior que a versão atual, responde 200 e chama onShutdown", async () => {
      const before = shutdowns;
      const response = await call(`/shutdown?below=${VERSION + 1}`, { method: "POST" });
      assert.equal(response.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(shutdowns, before + 1);
    });

    it("com below igual ou menor que a versão atual, recusa com 409 e não desliga", async () => {
      const before = shutdowns;
      for (const below of [VERSION, VERSION - 1]) {
        assert.equal((await call(`/shutdown?below=${below}`, { method: "POST" })).status, 409);
      }
      assert.equal((await call("/shutdown?below=abc", { method: "POST" })).status, 409);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(shutdowns, before);
    });
  });

  describe("autorização e rotas desconhecidas", () => {
    it("token pelo cookie é aceito; por ?t= em rota de API não redireciona", async () => {
      assert.equal((await fetch(`${BASE}/canvas?session=ses_x`, { headers: { cookie: `canvas_token=${TOKEN}` } })).status, 200);
      assert.equal((await fetch(`${BASE}/canvas?session=ses_x&t=${TOKEN}`)).status, 200);
    });

    it("primeira visita com ?t= troca o token por cookie e redireciona sem o token", async () => {
      const response = await fetch(`${BASE}/s/ses_x?t=${TOKEN}`, { redirect: "manual", headers: { "x-forwarded-proto": "https" } });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/s/ses_x");
      const cookie = response.headers.get("set-cookie") ?? "";
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
      assert.match(cookie, /Secure/);
    });

    it("rota desconhecida responde 404", async () => {
      assert.equal((await call("/nao-existe")).status, 404);
      assert.equal((await call("/health", { method: "POST" })).status, 404);
    });
  });

  describe("SSE", () => {
    it("publish anuncia o rootId aos clientes e o cliente sai da lista ao fechar", async () => {
      const controller = new AbortController();
      const response = await call("/events", { signal: controller.signal });
      assert.equal(response.status, 200);
      assert.equal(routes.clientCount(), 1);
      await seed("ses_sse", "<p>a</p>");
      await routes.publish("ses_sse");
      await routes.publish("ses_apagada");
      const reader = response.body?.getReader();
      assert.ok(reader);
      let text = "";
      const decoder = new TextDecoder();
      while (!text.includes("ses_apagada")) text += decoder.decode((await reader.read()).value);
      assert.match(text, /"rootId":"ses_sse"/);
      controller.abort();
      for (let i = 0; i < 50 && routes.clientCount() > 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(routes.clientCount(), 0);
    });
  });
});
