import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createActions, FAILURE_MESSAGES, ownedByFocus, type ActionHost, type ActionSnapshot } from "../src/canvas/actions.ts";
import { parseCanvasHtml } from "../src/canvas/sanitize.ts";
import { LIMITS } from "../src/shared/contract.ts";

const parsed = parseCanvasHtml('<h1>Resumo</h1><p data-canvas-item="n1">42</p>');
if (!parsed.ok) throw new Error("fixture");
const shown = (owner: string) => ({ owner, title: "Painel", updatedAt: 1, tree: parsed.tree });

type Call = { type: "attach" | "compose"; payload: any };

function setup(initial: ActionSnapshot, hooks: { onAttach?: () => void; onCompose?: () => void; failAttach?: boolean; failCompose?: boolean } = {}) {
  const calls: Call[] = [];
  const state = { snapshot: initial };
  const host: ActionHost = {
    async attach(request) {
      calls.push({ type: "attach", payload: request });
      hooks.onAttach?.();
      if (hooks.failAttach) throw new Error("recusado");
    },
    async compose(request) {
      calls.push({ type: "compose", payload: request });
      hooks.onCompose?.();
      if (hooks.failCompose) throw new Error("recusado");
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
  it("CA1: anexa o chip do canvas inteiro e NÃO escreve na caixa de mensagem", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    const result = await actions.addToContext({ kind: "canvas" });
    assert.deepEqual(result, { ok: true, truncated: false });
    assert.deepEqual(calls.map((call) => call.type), ["attach"]);
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
    const big = parseCanvasHtml(`<p>${"x".repeat(20_000)}</p>`);
    if (!big.ok) throw new Error("fixture");
    const { actions } = setup({ current: "A", shown: { owner: "A", title: "t", updatedAt: 1, tree: big.tree } });
    assert.deepEqual(await actions.addToContext({ kind: "canvas" }), { ok: true, truncated: true });
  });
});

describe("comment", () => {
  it("CA3: anexa o chip do elemento e escreve o texto — nessa ordem, sem enviar", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    const result = await actions.comment("n1", "  este número está errado  ");
    assert.deepEqual(result, { ok: true, truncated: false });
    assert.deepEqual(calls.map((call) => call.type), ["attach", "compose"]);
    assert.deepEqual(calls[1]!.payload, { text: "este número está errado", mode: "append" });
    assert.equal("send" in calls[1]!.payload, false);
  });

  it("CA4: comentário vazio não escreve nada", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    assert.deepEqual(await actions.comment("n1", "   "), { ok: false, reason: "empty-comment" });
    assert.deepEqual(calls, []);
  });

  it("comentário acima do limite é recusado, não cortado em silêncio", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    assert.deepEqual(await actions.comment("n1", "x".repeat(LIMITS.itemTextChars + 1)), { ok: false, reason: "comment-too-long" });
    assert.deepEqual(calls, []);
  });

  it("CA7: sessão trocou antes do clique → nada é escrito", async () => {
    const { actions, calls } = setup({ current: "B", shown: shown("A") });
    assert.deepEqual(await actions.comment("n1", "oi"), { ok: false, reason: "session-changed" });
    assert.deepEqual(calls, []);
  });

  it("CA7: sessão trocou ENTRE o chip e o texto → o texto não é escrito na sessão errada", async () => {
    const { actions, calls, state } = setup({ current: "A", shown: shown("A") }, { onAttach: () => { state.snapshot = { current: "B", shown: shown("A") }; } });
    assert.deepEqual(await actions.comment("n1", "oi"), { ok: false, reason: "session-changed", attached: true });
    assert.deepEqual(calls.map((call) => call.type), ["attach"]);
  });

  it("sessão trocou e voltou durante o chip: o canvas exibido é de outro dono → não escreve", async () => {
    const { actions, calls, state } = setup({ current: "A", shown: shown("A") }, { onAttach: () => { state.snapshot = { current: "B", shown: shown("B") }; } });
    assert.equal((await actions.comment("n1", "oi")).ok, false);
    assert.deepEqual(calls.map((call) => call.type), ["attach"]);
  });

  it("elemento removido por uma atualização do canvas → nada é escrito", async () => {
    const { actions, calls } = setup({ current: "A", shown: shown("A") });
    assert.deepEqual(await actions.comment("sumiu", "oi"), { ok: false, reason: "item-missing" });
    assert.deepEqual(calls, []);
  });

  it("recusa do host no texto informa que o chip já estava na caixa", async () => {
    const { actions } = setup({ current: "A", shown: shown("A") }, { failCompose: true });
    assert.deepEqual(await actions.comment("n1", "oi"), { ok: false, reason: "host-error", attached: true });
    assert.deepEqual(await setup({ current: "A", shown: shown("A") }, { failAttach: true }).actions.comment("n1", "oi"), { ok: false, reason: "host-error" });
  });
});

describe("mensagens", () => {
  it("toda falha tem texto para o usuário", () => {
    for (const reason of ["no-canvas", "session-changed", "item-missing", "empty-comment", "comment-too-long", "host-error"] as const) {
      assert.ok(FAILURE_MESSAGES[reason].length > 10);
    }
  });
});
