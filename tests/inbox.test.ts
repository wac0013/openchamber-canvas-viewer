import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { discardPending, drainInbox } from "../service/inbox.ts";
import { createStore, type Store } from "../service/store.ts";
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

  it("arquivo gigante é recusado com mensagem de tamanho e apagado", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", "x".repeat(LIMITS.htmlChars * 6 + 5000));
    await drainInbox(inbox, store, () => 2);
    assert.match((await store.read("ses_a"))?.error?.message ?? "", /maior que o limite/);
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

  it("falha de I/O ao publicar devolve o arquivo à caixa e tenta de novo (nenhuma publicação se perde)", async () => {
    const real = createStore(root);
    let fail = true;
    const flaky: Store = { ...real, publish: async (...args) => { if (fail) throw new Error("disco cheio"); return real.publish(...args); } };
    await drainInbox(inbox, flaky, () => 1);
    await deposit("ses_a.json", valid("ses_a", "<p>v1</p>"));
    const errors: string[] = [];
    assert.deepEqual(await drainInbox(inbox, flaky, () => 2, { onError: (id) => errors.push(id) }), []);
    assert.deepEqual(errors, ["ses_a"]);
    assert.deepEqual(await readdir(inbox), ["ses_a.json"]);
    fail = false;
    assert.deepEqual(await drainInbox(inbox, flaky, () => 3), ["ses_a"]);
    assert.equal((await real.read("ses_a"))?.canvas?.updatedAt, 3);
    assert.deepEqual(await readdir(inbox), []);
  });

  it("versão mais nova depositada durante a falha vence a devolvida", async () => {
    const real = createStore(root);
    const flaky: Store = {
      ...real,
      publish: async () => {
        await deposit("ses_a.json", valid("ses_a", "<p>nova</p>"));
        throw new Error("disco cheio");
      },
    };
    await drainInbox(inbox, flaky, () => 1);
    await deposit("ses_a.json", valid("ses_a", "<p>velha</p>"));
    await drainInbox(inbox, flaky, () => 2);
    await drainInbox(inbox, real, () => 3);
    const html = JSON.stringify((await real.read("ses_a"))?.canvas?.tree);
    assert.ok(html.includes("nova") && !html.includes("velha"));
    assert.deepEqual(await readdir(inbox), []);
  });

  it("exclusão da sessão durante o processamento não ressuscita o canvas (CA9)", async () => {
    const real = createStore(root);
    const racing: Store = { ...real, publish: async (id, ...rest) => { await real.remove(id); return real.publish(id, ...rest); } };
    await drainInbox(inbox, racing, () => 1);
    await deposit("ses_a.json", valid("ses_a"));
    assert.deepEqual(await drainInbox(inbox, racing, () => 2), []);
    assert.equal(await real.read("ses_a"), null);
    assert.deepEqual(await readdir(inbox), []);
  });

  it("discardPending apaga a publicação ainda pendente da sessão excluída", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await deposit("ses_a.json", valid("ses_a"));
    await deposit("ses_b.json", valid("ses_b"));
    await discardPending(inbox, "ses_a");
    await discardPending(inbox, "../x");
    assert.deepEqual(await readdir(inbox), ["ses_b.json"]);
  });

  it("symlink e diretório na caixa não são lidos como publicação", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    await writeFile(path.join(root, "alvo.json"), JSON.stringify(valid("ses_a")));
    await symlink(path.join(root, "alvo.json"), path.join(inbox, "ses_a.json"));
    await mkdir(path.join(inbox, "ses_b.json"));
    await drainInbox(inbox, store, () => 2);
    assert.equal((await store.read("ses_a"))?.canvas, null);
    assert.ok((await store.read("ses_a"))?.error);
  });

  it("reivindicação abandonada há muito tempo é descartada; recente é preservada", async () => {
    const store = createStore(root);
    await drainInbox(inbox, store, () => 1);
    const old = path.join(inbox, "ses_a.json.11111111-1111-1111-1111-111111111111.proc");
    const fresh = path.join(inbox, "ses_b.json.22222222-2222-2222-2222-222222222222.proc");
    await writeFile(old, "x");
    await writeFile(fresh, "x");
    await utimes(old, new Date(1000), new Date(1000));
    await drainInbox(inbox, store, () => Date.now());
    assert.deepEqual(await readdir(inbox), ["ses_b.json.22222222-2222-2222-2222-222222222222.proc"]);
  });
});
