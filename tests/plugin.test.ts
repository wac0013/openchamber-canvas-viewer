import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import plugin from "../plugin/index.ts";
import { ROOT_MAX_DEPTH, findRoot } from "../src/shared/canvas-files.ts";
import { LIMITS } from "../src/shared/contract.ts";

type Tool = { name: string; description: string; options?: { codemode: boolean }; input: { required: string[]; additionalProperties: boolean }; execute: (input: unknown, ctx: { sessionID: string }) => Promise<{ content: string }> };

/** `parents`: sessão → pai (ausente = raiz). `calls` conta as consultas ao host. */
async function load(parents: Record<string, string> = {}): Promise<{ publish: Tool; edit: Tool; calls: string[] }> {
  const tools: Tool[] = [];
  const calls: string[] = [];
  await plugin.setup({
    tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool as unknown as Tool) }) },
    session: {
      get: async ({ sessionID }) => {
        calls.push(sessionID);
        return parents[sessionID] ? { id: sessionID, parentID: parents[sessionID] } : { id: sessionID };
      },
    },
  });
  const find = (name: string): Tool => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    return tool;
  };
  return { publish: find("canvas_publish"), edit: find("canvas_edit"), calls };
}

let home = "";
const previous = process.env.OPENCHAMBER_CANVAS_HOME;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "cv-plugin-"));
  process.env.OPENCHAMBER_CANVAS_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.OPENCHAMBER_CANVAS_HOME;
  else process.env.OPENCHAMBER_CANVAS_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

const htmlOf = (root: string): Promise<string> => readFile(path.join(home, "sessions", root, "index.html"), "utf8");

describe("plugin: registro", () => {
  it("registra duas ferramentas diretas (fora do Code Mode) com schema estrito", async () => {
    const { publish, edit } = await load();
    assert.equal(plugin.id, "openchamber-canvas-viewer");
    assert.deepEqual(publish.options, { codemode: false });
    assert.deepEqual(publish.input.required, ["html"]);
    assert.deepEqual(edit.input.required, ["find", "replace"]);
    assert.equal(publish.input.additionalProperties, false);
    assert.equal(edit.input.additionalProperties, false);
  });

  it("a descrição fala do arquivo, do kit, dos itens e do filtro", async () => {
    const { publish } = await load();
    for (const expected of ["Write/Edit", "<link data-kit>", "data-canvas-item", "data-filter", "data-tags", "canvas_edit"]) assert.ok(publish.description.includes(expected), expected);
  });
});

describe("plugin: canvas_publish", () => {
  it("grava o HTML inteiro, sem sanitizar, e devolve o caminho do arquivo", async () => {
    const { publish } = await load();
    const html = '<h1 onclick="x()">oi</h1><script>window.a=1</script>';
    const result = await publish.execute({ title: "Painel", html }, { sessionID: "ses_a" });
    assert.match(result.content, /publicado/);
    assert.ok(result.content.includes(path.join(home, "sessions", "ses_a", "index.html")));
    assert.equal(await htmlOf("ses_a"), html);
    const meta = JSON.parse(await readFile(path.join(home, "sessions", "ses_a", "meta.json"), "utf8")) as { title: string };
    assert.equal(meta.title, "Painel");
  });

  it("não deixa arquivo temporário para trás e substitui o canvas anterior", async () => {
    const { publish } = await load();
    await publish.execute({ html: "<p>1</p>" }, { sessionID: "ses_a" });
    await publish.execute({ html: "<p>2</p>" }, { sessionID: "ses_a" });
    assert.equal(await htmlOf("ses_a"), "<p>2</p>");
    assert.deepEqual((await readdir(path.join(home, "sessions", "ses_a"))).sort(), ["index.html", "meta.json"]);
  });

  it("sem título novo, mantém o título anterior", async () => {
    const { publish } = await load();
    await publish.execute({ title: "Um", html: "<p>1</p>" }, { sessionID: "ses_a" });
    await publish.execute({ html: "<p>2</p>" }, { sessionID: "ses_a" });
    const meta = JSON.parse(await readFile(path.join(home, "sessions", "ses_a", "meta.json"), "utf8")) as { title: string };
    assert.equal(meta.title, "Um");
  });

  it("título acima do limite é cortado", async () => {
    const { publish } = await load();
    await publish.execute({ title: "x".repeat(500), html: "<p>1</p>" }, { sessionID: "ses_a" });
    const meta = JSON.parse(await readFile(path.join(home, "sessions", "ses_a", "meta.json"), "utf8")) as { title: string };
    assert.equal(meta.title.length, LIMITS.titleChars);
  });

  it("recusa vazio e acima de 1 MB, sem tocar no canvas anterior", async () => {
    const { publish } = await load();
    await publish.execute({ html: "<p>ok</p>" }, { sessionID: "ses_a" });
    for (const html of ["", "   ", "x".repeat(LIMITS.canvasBytes + 1)]) {
      assert.match((await publish.execute({ html }, { sessionID: "ses_a" })).content, /NÃO publicado/);
    }
    assert.equal(await htmlOf("ses_a"), "<p>ok</p>");
  });

  it("aceita exatamente 1 MB", async () => {
    const { publish } = await load();
    const result = await publish.execute({ html: "x".repeat(LIMITS.canvasBytes) }, { sessionID: "ses_a" });
    assert.match(result.content, /publicado/);
  });

  it("recusa sessão com id que não seja nome de arquivo seguro", async () => {
    const { publish } = await load();
    for (const sessionID of ["", "../x", "a/b", "x".repeat(200)]) {
      assert.match((await publish.execute({ html: "<p>a</p>" }, { sessionID })).content, /NÃO publicado/);
    }
    await assert.rejects(stat(path.join(home, "sessions")));
  });

  it("entrada sem html ou de tipo errado não derruba o plugin", async () => {
    const { publish } = await load();
    for (const input of [undefined, null, {}, { html: 3 }, "texto"]) {
      assert.match((await publish.execute(input, { sessionID: "ses_a" })).content, /NÃO publicado/);
    }
  });
});

describe("plugin: sessão raiz", () => {
  it("subagente grava no canvas da raiz e deixa o alias", async () => {
    const { publish } = await load({ ses_filha: "ses_mae", ses_neta: "ses_filha" });
    await publish.execute({ html: "<p>da neta</p>" }, { sessionID: "ses_neta" });
    assert.equal(await htmlOf("ses_mae"), "<p>da neta</p>");
    await assert.rejects(stat(path.join(home, "sessions", "ses_neta")));
    assert.equal((await readFile(path.join(home, "aliases", "ses_neta"), "utf8")).trim(), "ses_mae");
  });

  it("a raiz não gera alias e a cadeia é consultada uma só vez (cache)", async () => {
    const { publish, calls } = await load({ ses_filha: "ses_mae" });
    await publish.execute({ html: "<p>1</p>" }, { sessionID: "ses_filha" });
    await publish.execute({ html: "<p>2</p>" }, { sessionID: "ses_filha" });
    await publish.execute({ html: "<p>3</p>" }, { sessionID: "ses_mae" });
    assert.deepEqual(calls, ["ses_filha", "ses_mae"]);
    assert.deepEqual(await readdir(path.join(home, "aliases")), ["ses_filha"]);
  });

  it("findRoot: limite de níveis, ciclo e falha de consulta", async () => {
    const chain = (id: string): Promise<unknown> => Promise.resolve({ parentID: `n${Number(id.slice(1)) + 1}` });
    const root = await findRoot("n0", chain, new Map());
    assert.equal(root, `n${ROOT_MAX_DEPTH}`);
    assert.equal(await findRoot("a", async (id) => ({ parentID: id === "a" ? "b" : "a" }), new Map()), "b");
    const cache = new Map<string, string>();
    assert.equal(await findRoot("x", async () => Promise.reject(new Error("host fora")), cache), "x");
    assert.equal(cache.size, 0);
  });

  it("parentID inválido (caminho) é ignorado", async () => {
    assert.equal(await findRoot("ses_a", async () => ({ parentID: "../../etc" }), new Map()), "ses_a");
  });

  it("aceita a sessão embrulhada em { data }", async () => {
    assert.equal(await findRoot("ses_a", async (id) => (id === "ses_a" ? { data: { parentID: "ses_b" } } : { data: {} }), new Map()), "ses_b");
  });
});

describe("plugin: canvas_edit", () => {
  it("troca um trecho único", async () => {
    const { publish, edit } = await load();
    await publish.execute({ html: "<p>um</p><p>dois</p>" }, { sessionID: "ses_a" });
    const result = await edit.execute({ find: "<p>dois</p>", replace: "<p>2</p>" }, { sessionID: "ses_a" });
    assert.match(result.content, /editado/);
    assert.equal(await htmlOf("ses_a"), "<p>um</p><p>2</p>");
  });

  it("não interpreta $ no texto de troca", async () => {
    const { publish, edit } = await load();
    await publish.execute({ html: "<p>x</p>" }, { sessionID: "ses_a" });
    await edit.execute({ find: "x", replace: "$& $1 $$" }, { sessionID: "ses_a" });
    assert.equal(await htmlOf("ses_a"), "<p>$& $1 $$</p>");
  });

  it("zero ou várias ocorrências falham e não alteram o arquivo", async () => {
    const { publish, edit } = await load();
    await publish.execute({ html: "<p>a</p><p>a</p>" }, { sessionID: "ses_a" });
    assert.match((await edit.execute({ find: "zzz", replace: "x" }, { sessionID: "ses_a" })).content, /não encontrado/);
    assert.match((await edit.execute({ find: "<p>a</p>", replace: "x" }, { sessionID: "ses_a" })).content, /2 vezes/);
    assert.match((await edit.execute({ find: "", replace: "x" }, { sessionID: "ses_a" })).content, /vazio/);
    assert.equal(await htmlOf("ses_a"), "<p>a</p><p>a</p>");
  });

  it("sem canvas ainda: pede para publicar primeiro", async () => {
    const { edit } = await load();
    assert.match((await edit.execute({ find: "a", replace: "b" }, { sessionID: "ses_a" })).content, /canvas_publish/);
  });

  it("subagente edita o canvas da raiz", async () => {
    const { publish, edit } = await load({ ses_filha: "ses_mae" });
    await publish.execute({ html: "<p>a</p>" }, { sessionID: "ses_mae" });
    await edit.execute({ find: "a", replace: "b" }, { sessionID: "ses_filha" });
    assert.equal(await htmlOf("ses_mae"), "<p>b</p>");
  });
});
