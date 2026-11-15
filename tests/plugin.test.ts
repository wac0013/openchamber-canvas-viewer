import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import plugin from "../plugin/index.ts";

type Tool = { name: string; options?: { codemode: boolean }; input: { required: string[]; additionalProperties: boolean }; execute: (input: unknown, ctx: { sessionID: string }) => Promise<{ content: string }> };

async function loadTool(): Promise<Tool> {
  const tools: Tool[] = [];
  await plugin.setup({ tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool as unknown as Tool) }) } });
  assert.equal(tools.length, 1);
  return tools[0]!;
}

let inbox = "";
const previous = process.env.OPENCHAMBER_CANVAS_INBOX;
beforeEach(async () => {
  inbox = await mkdtemp(path.join(tmpdir(), "cv-plugin-"));
  process.env.OPENCHAMBER_CANVAS_INBOX = inbox;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.OPENCHAMBER_CANVAS_INBOX;
  else process.env.OPENCHAMBER_CANVAS_INBOX = previous;
  await rm(inbox, { recursive: true, force: true });
});

describe("plugin canvas_publish", () => {
  it("registra uma ferramenta direta (fora do Code Mode) com schema estrito", async () => {
    const tool = await loadTool();
    assert.equal(plugin.id, "openchamber-canvas-viewer");
    assert.equal(tool.name, "canvas_publish");
    assert.deepEqual(tool.options, { codemode: false });
    assert.deepEqual(tool.input.required, ["html"]);
    assert.equal(tool.input.additionalProperties, false);
  });

  it("deposita o arquivo da sessão que chamou (context.sessionID), de forma atômica", async () => {
    const tool = await loadTool();
    const result = await tool.execute({ title: "Painel", html: "<p>oi</p>" }, { sessionID: "ses_abc" });
    assert.match(result.content, /publicado/);
    assert.deepEqual(await readdir(inbox), ["ses_abc.json"]);
    const payload = JSON.parse(await readFile(path.join(inbox, "ses_abc.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(payload, { v: 1, sessionId: "ses_abc", title: "Painel", html: "<p>oi</p>" });
  });

  it("publicar de novo substitui o arquivo pendente", async () => {
    const tool = await loadTool();
    await tool.execute({ html: "<p>1</p>" }, { sessionID: "ses_abc" });
    await tool.execute({ html: "<p>2</p>" }, { sessionID: "ses_abc" });
    const payload = JSON.parse(await readFile(path.join(inbox, "ses_abc.json"), "utf8")) as { html: string };
    assert.equal(payload.html, "<p>2</p>");
  });

  it("HTML malformado: erro imediato ao agente e nada depositado", async () => {
    const tool = await loadTool();
    const result = await tool.execute({ html: "<div><p>x</div>" }, { sessionID: "ses_abc" });
    assert.match(result.content, /NÃO publicado/);
    assert.match(result.content, /anterior foi mantido/);
    assert.deepEqual(await readdir(inbox), []);
  });

  it("informa ao agente o que foi removido por segurança", async () => {
    const tool = await loadTool();
    const result = await tool.execute({ html: '<p onclick="x()">a</p><script>1</script>' }, { sessionID: "ses_abc" });
    assert.match(result.content, /publicado/);
    assert.match(result.content, /<script>/);
    assert.match(result.content, /on\*/);
  });

  it("recusa sessão com id que não seja nome de arquivo seguro", async () => {
    const tool = await loadTool();
    for (const sessionID of ["", "../x", "a/b", "x".repeat(200)]) {
      const result = await tool.execute({ html: "<p>a</p>" }, { sessionID });
      assert.match(result.content, /NÃO publicado/);
    }
    assert.deepEqual(await readdir(inbox).catch(() => []), []);
  });

  it("entrada sem html ou de tipo errado não derruba o plugin", async () => {
    const tool = await loadTool();
    for (const input of [undefined, null, {}, { html: 3 }, "texto"]) {
      assert.match((await tool.execute(input, { sessionID: "ses_abc" })).content, /NÃO publicado/);
    }
  });
});
