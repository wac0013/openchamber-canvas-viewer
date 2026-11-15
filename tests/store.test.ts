import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createStore } from "../service/store.ts";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cv-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("store", () => {
  it("publica e lê o canvas da sessão", async () => {
    const store = createStore(dir);
    const record = await store.publish("ses_a", "Título", "<p>oi</p>", 1000);
    assert.equal(record.canvas?.title, "Título");
    assert.equal(record.canvas?.updatedAt, 1000);
    assert.equal(record.error, null);
    assert.deepEqual(await store.read("ses_a"), record);
  });

  it("sessão sem canvas lê null (CA1)", async () => {
    assert.equal(await createStore(dir).read("ses_nova"), null);
  });

  it("isola sessões (CA4)", async () => {
    const store = createStore(dir);
    await store.publish("ses_a", "A", "<p>a</p>", 1);
    assert.equal(await store.read("ses_b"), null);
    await store.publish("ses_b", "B", "<p>b</p>", 2);
    assert.equal((await store.read("ses_a"))?.canvas?.title, "A");
  });

  it("persiste entre instâncias do serviço (CA5)", async () => {
    await createStore(dir).publish("ses_a", "A", "<p>a</p>", 1);
    assert.equal((await createStore(dir).read("ses_a"))?.canvas?.title, "A");
  });

  it("nova publicação substitui a anterior, sem histórico (CA6/RN1)", async () => {
    const store = createStore(dir);
    await store.publish("ses_a", "v1", "<p>1</p>", 1);
    await store.publish("ses_a", "v2", "<p>2</p>", 2);
    assert.equal((await store.read("ses_a"))?.canvas?.title, "v2");
    assert.deepEqual(await readdir(path.join(dir, "canvases")), ["ses_a.json"]);
  });

  it("publicação inválida mantém o canvas vigente e registra o erro (CA7/RN4)", async () => {
    const store = createStore(dir);
    await store.publish("ses_a", "bom", "<p>bom</p>", 1);
    const record = await store.publish("ses_a", "ruim", "<div><p>quebrado</div>", 2);
    assert.equal(record.canvas?.title, "bom");
    assert.equal(record.canvas?.updatedAt, 1);
    assert.equal(record.error?.at, 2);
    assert.equal(record.error?.message.includes("quebrado"), false);
    assert.equal((await store.read("ses_a"))?.error?.at, 2);
  });

  it("uma publicação válida limpa o erro anterior", async () => {
    const store = createStore(dir);
    await store.publish("ses_a", "x", "<p>", 1);
    const record = await store.publish("ses_a", "ok", "<p>ok</p>", 2);
    assert.equal(record.error, null);
  });

  it("primeira publicação inválida deixa canvas null com erro", async () => {
    const record = await createStore(dir).publish("ses_a", "x", "<p>", 1);
    assert.equal(record.canvas, null);
    assert.ok(record.error);
  });

  it("publicação só com conteúdo bloqueado vazio é recusada", async () => {
    const record = await createStore(dir).publish("ses_a", "x", "<script>1</script>", 1);
    assert.equal(record.canvas, null);
    assert.ok(record.error);
  });

  it("guarda o que foi bloqueado para o painel avisar (CA8)", async () => {
    const record = await createStore(dir).publish("ses_a", "x", "<p>ok</p><script>1</script>", 1);
    assert.deepEqual(record.canvas?.blocked, ["<script>"]);
  });

  it("excluir a sessão remove o arquivo e não afeta as outras (CA9)", async () => {
    const store = createStore(dir);
    await store.publish("ses_a", "A", "<p>a</p>", 1);
    await store.publish("ses_b", "B", "<p>b</p>", 1);
    await store.remove("ses_a");
    assert.equal(await store.read("ses_a"), null);
    assert.equal((await store.read("ses_b"))?.canvas?.title, "B");
    assert.deepEqual(await readdir(path.join(dir, "canvases")), ["ses_b.json"]);
    await store.remove("ses_a"); // idempotente
  });

  it("recusa ids de sessão que não sejam nome de arquivo seguro", async () => {
    const store = createStore(dir);
    for (const id of ["../x", "a/b", "", "a b", "x".repeat(129), "..", "a\u0000b"]) {
      await assert.rejects(store.publish(id, "t", "<p>a</p>", 1), /inválido/);
      await assert.rejects(store.read(id), /inválido/);
      await assert.rejects(store.remove(id), /inválido/);
    }
  });

  it("arquivo corrompido ou adulterado é ignorado (trata como sem canvas)", async () => {
    const store = createStore(dir);
    await store.publish("ses_a", "A", "<p>a</p>", 1);
    const file = path.join(dir, "canvases", "ses_a.json");
    await writeFile(file, "{não é json");
    assert.equal(await store.read("ses_a"), null);
    await writeFile(file, JSON.stringify({ sessionId: "ses_a", canvas: { title: "x", updatedAt: 1, tree: [{ t: "el", tag: "script", attrs: {}, c: [] }] }, error: null }));
    assert.equal(await store.read("ses_a"), null);
  });
});
