import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { drainInbox } from "../service/inbox.ts";
import { createStore } from "../service/store.ts";
import { LIMITS } from "../src/shared/contract.ts";

let root = "";
let inbox = "";
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cv-inbox-"));
  inbox = path.join(root, "inbox");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const deposit = (name: string, body: unknown) => writeFile(path.join(inbox, name), typeof body === "string" ? body : JSON.stringify(body));
const valid = (sessionId: string, html = "<p>oi</p>") => ({ v: 1, sessionId, title: "T", html });

describe("drainInbox", () => {
  it("cria a caixa se não existir e não faz nada quando vazia", async () => {
    assert.deepEqual(await drainInbox(inbox, createStore(root), () => 1), []);
  });

  it("publica o canvas da sessão e apaga o arquivo (CA2)", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", valid("ses_a"));
    assert.deepEqual(await drainInbox(inbox, store, () => 50), ["ses_a"]);
    assert.equal((await store.read("ses_a"))?.canvas?.updatedAt, 50);
    assert.deepEqual(await readdir(inbox), []);
  });

  it("atualização mantém a mesma sessão com a hora nova (CA3)", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", valid("ses_a", "<p>v1</p>"));
    await drainInbox(inbox, store, () => 10);
    await deposit("ses_a.json", valid("ses_a", "<p>v2</p>"));
    await drainInbox(inbox, store, () => 20);
    assert.equal((await store.read("ses_a"))?.canvas?.updatedAt, 20);
  });

  it("ignora .tmp (escrita em andamento) e nomes inválidos", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json.tmp", valid("ses_a"));
    await deposit("x y.json", valid("x y"));
    await deposit("..%2f.json", valid("x"));
    assert.deepEqual(await drainInbox(inbox, store, () => 1), []);
    assert.equal((await readdir(inbox)).length, 3);
  });

  it("JSON ilegível registra erro e mantém o canvas anterior (RN4)", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await store.publish("ses_a", "bom", "<p>bom</p>", 1);
    await deposit("ses_a.json", "{lixo");
    await drainInbox(inbox, store, () => 2);
    const record = await store.read("ses_a");
    assert.equal(record?.canvas?.title, "bom");
    assert.ok(record?.error);
    assert.deepEqual(await readdir(inbox), []);
  });

  it("sessionId do arquivo diferente do nome é recusado (não publica na sessão errada)", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", valid("ses_b"));
    await drainInbox(inbox, store, () => 2);
    assert.equal(await store.read("ses_b"), null);
    assert.ok((await store.read("ses_a"))?.error);
  });

  it("versão desconhecida é recusada", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", { ...valid("ses_a"), v: 99 });
    await drainInbox(inbox, store, () => 2);
    assert.equal((await store.read("ses_a"))?.canvas, null);
  });

  it("arquivo gigante é recusado sem ser lido e apagado", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", "x".repeat(LIMITS.htmlChars * 4 + 5000));
    await drainInbox(inbox, store, () => 2);
    assert.ok((await store.read("ses_a"))?.error);
    assert.deepEqual(await readdir(inbox), []);
  });

  it("o serviço sanitiza de novo (não confia no plugin)", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", valid("ses_a", "<p>ok</p><script>evil()</script>"));
    await drainInbox(inbox, store, () => 2);
    const canvas = (await store.read("ses_a"))?.canvas;
    assert.deepEqual(canvas?.blocked, ["<script>"]);
    assert.equal(JSON.stringify(canvas).includes("evil"), false);
  });

  it("processa várias sessões na mesma rodada", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", valid("ses_a"));
    await deposit("ses_b.json", valid("ses_b"));
    assert.deepEqual((await drainInbox(inbox, store, () => 1)).sort(), ["ses_a", "ses_b"]);
  });
});
