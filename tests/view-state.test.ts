import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS } from "../src/shared/contract.ts";
import { EMPTY_VIEW_STATE, isEmptyViewState, parseViewState, viewStateKey } from "../src/canvas/view-state.ts";

describe("viewStateKey", () => {
  it("monta a chave para um id de sessão válido", () => {
    assert.equal(viewStateKey("ses_abc-1"), "view:ses_abc-1");
  });

  it("devolve null para id inválido", () => {
    for (const bad of ["", "../x", "a b", "a/b", "x".repeat(129)]) assert.equal(viewStateKey(bad), null, bad);
  });
});

describe("parseViewState", () => {
  it("aceita filtros e itens válidos", () => {
    const state = parseViewState({ filters: ["status:ok", "tipo:a_b"], removed: ["item-1", "x"] });
    assert.deepEqual(state, { filters: ["status:ok", "tipo:a_b"], removed: ["item-1", "x"] });
  });

  it("entrada que não é objeto vira estado vazio", () => {
    for (const bad of [null, undefined, 3, "x", true, ["status:ok"]]) assert.deepEqual(parseViewState(bad), { filters: [], removed: [] });
  });

  it("campos que não são lista viram lista vazia", () => {
    assert.deepEqual(parseViewState({ filters: "status:ok", removed: { a: 1 } }), { filters: [], removed: [] });
    assert.deepEqual(parseViewState({}), { filters: [], removed: [] });
  });

  it("descarta valores inválidos, não-string e duplicados", () => {
    const state = parseViewState({ filters: ["status:ok", "status:ok", "sem-dois-pontos", 7, null, "A:b"], removed: ["ok", "ok", "Maiusculo", "-x", 1, {}] });
    assert.deepEqual(state, { filters: ["status:ok"], removed: ["ok"] });
  });

  it("limita a quantidade de filtros e de itens removidos", () => {
    const filters = Array.from({ length: LIMITS.filters + 5 }, (_, i) => `f:v${i}`);
    const removed = Array.from({ length: LIMITS.items + 5 }, (_, i) => `i${i}`);
    const state = parseViewState({ filters, removed });
    assert.equal(state.filters.length, LIMITS.filters);
    assert.equal(state.removed.length, LIMITS.items);
    assert.equal(state.filters[0], "f:v0");
  });

  it("não compartilha referência com o estado vazio exportado", () => {
    const state = parseViewState(null);
    state.filters.push("x:y");
    assert.deepEqual(EMPTY_VIEW_STATE, { filters: [], removed: [] });
  });
});

describe("isEmptyViewState", () => {
  it("só é vazio sem filtros e sem removidos", () => {
    assert.equal(isEmptyViewState(EMPTY_VIEW_STATE), true);
    assert.equal(isEmptyViewState({ filters: ["a:b"], removed: [] }), false);
    assert.equal(isEmptyViewState({ filters: [], removed: ["a"] }), false);
  });
});
