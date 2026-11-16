import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectFilterItems, groupsOf, isFiltering, matchesFilter, NO_FILTER, shouldOfferFilter, visibleIds } from "../src/canvas/filter.ts";
import { parseCanvasHtml } from "../src/canvas/sanitize.ts";

function items(html: string) {
  const parsed = parseCanvasHtml(html);
  if (!parsed.ok) throw new Error(parsed.message);
  return collectFilterItems(parsed.tree);
}

const sample = items(
  '<section data-group="Heitor"><div data-canvas-item="a">ILOTTO-1154 Bilhetes prêmios</div><div data-canvas-item="b">Outra coisa</div></section>' +
    '<div data-canvas-item="c" data-group="Victor">Remodelar tela de resumo</div><div data-canvas-item="d">Sem grupo</div>',
);

describe("collectFilterItems", () => {
  it("lista itens na ordem, com grupo próprio ou herdado do ancestral", () => {
    assert.deepEqual(sample.map((item) => [item.id, item.group]), [["a", "Heitor"], ["b", "Heitor"], ["c", "Victor"], ["d", null]]);
  });
  it("grupos distintos em ordem alfabética", () => {
    assert.deepEqual(groupsOf(sample), ["Heitor", "Victor"]);
  });
});

describe("shouldOfferFilter", () => {
  it("aparece com 6+ itens ou 2+ grupos; senão não", () => {
    assert.equal(shouldOfferFilter(sample), true);
    assert.equal(shouldOfferFilter(items('<p data-canvas-item="a">1</p><p data-canvas-item="b">2</p>')), false);
    const six = Array.from({ length: 6 }, (_, index) => `<p data-canvas-item="i${index}">x</p>`).join("");
    assert.equal(shouldOfferFilter(items(six)), true);
  });
});

describe("matchesFilter", () => {
  it("busca todas as palavras, sem acento e sem diferenciar maiúsculas", () => {
    assert.equal(matchesFilter(sample[0]!, { query: "bilhetes PREMIOS", group: "" }), true);
    assert.equal(matchesFilter(sample[0]!, { query: "bilhetes remodelar", group: "" }), false);
    assert.equal(matchesFilter(sample[0]!, { query: "ilotto-1154", group: "" }), true);
  });
  it("o texto do grupo também é pesquisável", () => {
    assert.equal(matchesFilter(sample[2]!, { query: "victor", group: "" }), true);
  });
  it("grupo exato exclui os demais, inclusive os sem grupo", () => {
    assert.deepEqual([...visibleIds(sample, { query: "", group: "Heitor" })], ["a", "b"]);
    assert.deepEqual([...visibleIds(sample, { query: "outra", group: "Heitor" })], ["b"]);
  });
  it("sem filtro tudo aparece", () => {
    assert.equal(isFiltering(NO_FILTER), false);
    assert.equal(isFiltering({ query: "  ", group: "" }), false);
    assert.equal(visibleIds(sample, NO_FILTER).size, 4);
  });
});
