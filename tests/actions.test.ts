import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createActions, FAILURE_MESSAGES, ownedByFocus, type ActionHost, type ActionSnapshot } from "../src/canvas/actions.ts";

const shown = (owner: string) => ({ owner, title: "Painel", updatedAt: 1, text: "Resumo\n[#n1] 42", items: [{ id: "n1", text: "42" }] });

type Call = { type: "attach"; payload: any };

function setup(initial: ActionSnapshot, hooks: { failAttach?: boolean } = {}) {
  const calls: Call[] = [];
  const state = { snapshot: initial };
  const host: ActionHost = {
    async attach(request) {
      calls.push({ type: "attach", payload: request });
      if (hooks.failAttach) throw new Error("recusado");
    },
  };
  return { calls, state, actions: createActions(host, () => state.snapshot) };
}

describe("ownedByFocus", () => {
  it("só vale quando o canvas exibido pertence à sessão em foco", () => {
    assert.equal(ownedByFocus({ current: "A", shown: shown("A") }), true);
    assert.equal(ownedByFocus({ current: "B", shown: shown("A") }), false);
    assert.equal(ownedByFocus({ current: null, shown: shown("A") }), false);
    assert.equal(ownedByFocus({ current: "A", shown: null }), false);
  });
});

describe("addToContext", () => {
  it("CA1: anexa o chip do canvas inteiro", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    const result = await actions.addToContext({ kind: "canvas" });
    assert.deepEqual(result, { ok: true, truncated: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.payload.title, "Painel");
  });

  it("CA2: anexa só o elemento escolhido", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    await actions.addToContext({ kind: "item", id: "n1" });
    assert.equal(calls[0]!.payload.id, "item-n1");
    assert.match(calls[0]!.payload.text, /Elemento: n1/);
  });

  it("CA9: duas adições do mesmo elemento usam o mesmo providerId+id", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    await actions.addToContext({ kind: "item", id: "n1" });
    await actions.addToContext({ kind: "item", id: "n1" });
    assert.equal(calls[0]!.payload.providerId, calls[1]!.payload.providerId);
    assert.equal(calls[0]!.payload.id, calls[1]!.payload.id);
  });

  it("CA7: canvas de outra sessão que a em foco → nada é escrito", async () => {
    const { actions, calls } = setup({ current: "B", shown: shown("A") });
    assert.deepEqual(await actions.addToContext({ kind: "canvas" }), { ok: false, reason: "session-changed" });
    assert.deepEqual(calls, []);
  });

  it("sem canvas exibido, elemento inexistente e recusa do host", async () => {
    assert.deepEqual(await setup({ current: "A", shown: null }).actions.addToContext({ kind: "canvas" }), { ok: false, reason: "no-canvas" });
    assert.deepEqual(await setup({ current: "A", shown: shown("A") }).actions.addToContext({ kind: "item", id: "x" }), { ok: false, reason: "item-missing" });
    assert.deepEqual(await setup({ current: "A", shown: shown("A") }, { failAttach: true }).actions.addToContext({ kind: "canvas" }), { ok: false, reason: "host-error" });
  });

  it("sinaliza truncamento", async () => {
    const { actions } = setup({ current: "A", shown: { owner: "A", title: "t", updatedAt: 1, text: "x".repeat(20_000), items: [] } });
    assert.deepEqual(await actions.addToContext({ kind: "canvas" }), { ok: true, truncated: true });
  });
});

describe("trecho selecionado (comentar)", () => {
  it("CA3: anexa um chip com o trecho e NÃO escreve nada além disso (o comentário é do campo nativo)", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    const result = await actions.addToContext({ kind: "selection", text: "este número", itemId: "n1" });
    assert.deepEqual(result, { ok: true, truncated: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.payload.id.startsWith("sel-"), true);
    assert.match(calls[0]!.payload.text, /Elemento: n1/);
    assert.match(calls[0]!.payload.text, /\n---\neste número$/);
  });

  it("CA4: seleção vazia ou só de espaços não anexa nada", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    assert.deepEqual(await actions.addToContext({ kind: "selection", text: "  \n  " }), { ok: false, reason: "empty-selection" });
    assert.deepEqual(calls, []);
  });

  it("CA7: a sessão em foco mudou antes do clique → nada é escrito", async () => {
    const { actions, calls } = setup({ current: "B", shown: shown("A") });
    assert.deepEqual(await actions.addToContext({ kind: "selection", text: "x" }), { ok: false, reason: "session-changed" });
    assert.deepEqual(calls, []);
  });

  it("recusa do host é informada", async () => {
    const { actions } = setup({ current: "A", shown: shown("A") }, { failAttach: true });
    assert.deepEqual(await actions.addToContext({ kind: "selection", text: "x" }), { ok: false, reason: "host-error" });
  });

  it("a mesma seleção gera o mesmo chip (o host substitui); seleções diferentes geram chips diferentes", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    await actions.addToContext({ kind: "selection", text: "trecho um", itemId: "n1" });
    await actions.addToContext({ kind: "selection", text: "trecho um", itemId: "n1" });
    await actions.addToContext({ kind: "selection", text: "trecho dois", itemId: "n1" });
    assert.equal(calls[0]!.payload.id, calls[1]!.payload.id);
    assert.notEqual(calls[0]!.payload.id, calls[2]!.payload.id);
  });
});

describe("mensagens", () => {
  it("toda falha tem texto para o usuário", () => {
    for (const reason of ["no-canvas", "session-changed", "item-missing", "empty-selection", "host-error"] as const) {
      assert.ok(FAILURE_MESSAGES[reason].length > 10);
    }
  });
});
