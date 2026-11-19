import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import plugin from "../plugin/index.ts";

type Tool = { name: string; execute: (input: unknown, ctx: { sessionID: string }) => Promise<{ content: string }> };

async function load(parents: Record<string, string> = {}): Promise<{ publish: Tool; edit: Tool }> {
  const tools: Tool[] = [];
  await plugin.setup({
    tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool as unknown as Tool) }) },
    session: { get: async ({ sessionID }) => (parents[sessionID] ? { id: sessionID, parentID: parents[sessionID] } : { id: sessionID }) },
  });
  const find = (name: string): Tool => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    return tool;
  };
  return { publish: find("canvas_publish"), edit: find("canvas_edit") };
}

let dir = "";
const previous = process.env.OPENCHAMBER_CANVAS_HOME;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cv-plugin-err-"));
});
afterEach(async () => {
  if (previous === undefined) delete process.env.OPENCHAMBER_CANVAS_HOME;
  else process.env.OPENCHAMBER_CANVAS_HOME = previous;
  await rm(dir, { recursive: true, force: true });
});

/** Aponta a pasta de dados para um ARQUIVO: qualquer mkdir dentro dela falha (ENOTDIR). */
async function breakHome(): Promise<void> {
  const file = path.join(dir, "arquivo");
  await writeFile(file, "x");
  process.env.OPENCHAMBER_CANVAS_HOME = file;
}

describe("plugin: falhas de gravação e entradas inesperadas", () => {
  it("canvas_publish informa a falha de disco em vez de lançar", async () => {
    await breakHome();
    const { publish } = await load();
    const result = await publish.execute({ html: "<p>a</p>" }, { sessionID: "ses_a" });
    assert.match(result.content, /^Canvas NÃO publicado: /);
  });

  it("canvas_edit informa a falha de disco em vez de lançar (alias de subagente não grava)", async () => {
    await breakHome();
    const { edit } = await load({ ses_filha: "ses_mae" });
    const result = await edit.execute({ find: "a", replace: "b" }, { sessionID: "ses_filha" });
    assert.match(result.content, /^Canvas NÃO editado: /);
  });

  it("html que não é texto é tratado como vazio", async () => {
    process.env.OPENCHAMBER_CANVAS_HOME = dir;
    const { publish } = await load();
    for (const html of [123, null, undefined, { a: 1 }]) {
      const result = await publish.execute({ html }, { sessionID: "ses_a" });
      assert.match(result.content, /NÃO publicado: html vazio/);
    }
  });

  it("entrada ausente não derruba as ferramentas", async () => {
    process.env.OPENCHAMBER_CANVAS_HOME = dir;
    const { publish, edit } = await load();
    assert.match((await publish.execute(undefined, { sessionID: "ses_a" })).content, /NÃO publicado/);
    assert.match((await edit.execute(null, { sessionID: "ses_a" })).content, /NÃO editado/);
  });

  it("sessão inválida ou contexto sem sessão é recusado nas duas ferramentas", async () => {
    process.env.OPENCHAMBER_CANVAS_HOME = dir;
    const { publish, edit } = await load();
    assert.match((await publish.execute({ html: "<p>a</p>" }, { sessionID: "../x" })).content, /sessão inválida/);
    assert.match((await edit.execute({ find: "a", replace: "b" }, { sessionID: "../x" })).content, /sessão inválida/);
    assert.match((await publish.execute({ html: "<p>a</p>" }, undefined as unknown as { sessionID: string })).content, /sessão inválida/);
  });
});
