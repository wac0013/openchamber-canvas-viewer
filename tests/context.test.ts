import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChip, findItem, itemIds, plainText, truncateContext } from "../src/canvas/context.ts";
import { parseCanvasHtml } from "../src/canvas/sanitize.ts";
import { CHIP_PROVIDER_ID, LIMITS, TRUNCATED_NOTICE } from "../src/shared/contract.ts";

function tree(html: string) {
  const parsed = parseCanvasHtml(html);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.tree;
}

const canvas = (html: string, title = "Meu painel") => ({ title, updatedAt: Date.UTC(2026, 10, 15, 12, 0, 0), tree: tree(html) });

describe("plainText", () => {
  it("blocos em linhas, listas com '- ' e marcador [#id] nos itens", () => {
    const text = plainText(tree('<h1>Título</h1><p data-canvas-item="p-1">um <b>dois</b></p><ul><li>a</li><li>b</li></ul>'));
    assert.equal(text, "Título\n[#p-1] um dois\n- a\n- b");
  });

  it("tabelas: células separadas por ' | ' e uma linha por <tr>", () => {
    const text = plainText(tree("<table><tr><th>Nome</th><th>Valor</th></tr><tr><td>x</td><td>42</td></tr></table>"));
    assert.equal(text, "Nome | Valor\nx | 42");
  });

  it("<pre> preserva quebras e espaços; fora dele o espaço em branco é colapsado", () => {
    assert.equal(plainText(tree("<pre>a\n  b</pre>")), "a\n  b");
    assert.equal(plainText(tree("<p>a\n\n   b</p>")), "a b");
  });

  it("marcação do agente aparece como texto literal, nunca como tag (CA8)", () => {
    const text = plainText(tree("<p>&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;x&lt;/script&gt;</p>"));
    assert.equal(text, "<img src=x onerror=alert(1)> <script>x</script>");
  });

  it("não contém tags de elementos bloqueados nem seu conteúdo", () => {
    assert.equal(plainText(tree("<p>ok</p><script>segredo()</script>")), "ok");
  });
});

describe("findItem / itemIds", () => {
  const c = canvas('<div data-canvas-item="a"><p data-canvas-item="b">x</p></div><p>sem marca</p>');
  it("lista os ids na ordem do documento e acha elementos aninhados", () => {
    assert.deepEqual(itemIds(c.tree), ["a", "b"]);
    assert.equal(findItem(c.tree, "b")?.tag, "p");
    assert.equal(findItem(c.tree, "nao-existe"), null);
  });
});

describe("truncateContext (CA6)", () => {
  it("não corta no limite exato", () => {
    const text = "a".repeat(LIMITS.itemTextChars);
    assert.deepEqual(truncateContext(text), { text, truncated: false });
  });

  it("acima do limite: corta, deixa o aviso no final e o total cabe em 16.000", () => {
    const result = truncateContext("a".repeat(LIMITS.itemTextChars + 1));
    assert.equal(result.truncated, true);
    assert.equal(result.text.length, LIMITS.itemTextChars);
    assert.ok(result.text.endsWith(TRUNCATED_NOTICE));
    assert.ok(result.text.endsWith("[conteúdo truncado]"));
  });

  it("não deixa surrogate partido no corte", () => {
    const text = "a".repeat(LIMITS.itemTextChars - TRUNCATED_NOTICE.length - 1) + "😀".repeat(10);
    const result = truncateContext(text);
    assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])/.test(result.text), false);
    assert.ok(result.text.length <= LIMITS.itemTextChars);
  });
});

describe("buildChip", () => {
  it("CA1: canvas inteiro — chip com o título, texto estruturado e id estável", () => {
    const built = buildChip(canvas('<h1>Resumo</h1><p data-canvas-item="n1">42</p>'), { kind: "canvas" });
    assert.ok(built);
    assert.equal(built.chip.providerId, CHIP_PROVIDER_ID);
    assert.equal(built.chip.id, "canvas");
    assert.equal(built.chip.title, "Meu painel");
    assert.match(built.chip.url, /^https:\/\//);
    assert.deepEqual(built.chip.data, { v: 1, kind: "canvas" });
    assert.equal(
      built.chip.text,
      "Canvas: Meu painel\nAtualizado: 2026-11-15T12:00:00.000Z\n---\nResumo\n[#n1] 42",
    );
    assert.equal(built.truncated, false);
  });

  it("canvas sem título usa 'Canvas'", () => {
    assert.equal(buildChip(canvas("<p>x</p>", ""), { kind: "canvas" })?.chip.title, "Canvas");
  });

  it("CA2: elemento — chip com a identificação do elemento e SÓ o conteúdo dele", () => {
    const built = buildChip(canvas('<p data-canvas-item="a">alfa</p><p data-canvas-item="b">beta</p>'), { kind: "item", id: "b" });
    assert.ok(built);
    assert.equal(built.chip.id, "item-b");
    assert.equal(built.chip.title, "Meu painel › b");
    assert.equal(built.chip.text, "Canvas: Meu painel\nElemento: b\n---\nbeta");
    assert.equal(built.chip.text?.includes("alfa"), false);
    assert.deepEqual(built.chip.data, { v: 1, kind: "item", itemId: "b" });
  });

  it("CA9: o mesmo elemento sempre gera o mesmo providerId+id (o host substitui o chip)", () => {
    const first = buildChip(canvas('<p data-canvas-item="a">v1</p>'), { kind: "item", id: "a" });
    const second = buildChip(canvas('<p data-canvas-item="a">v2</p>'), { kind: "item", id: "a" });
    assert.equal(first?.chip.providerId, second?.chip.providerId);
    assert.equal(first?.chip.id, second?.chip.id);
  });

  it("elemento que não existe devolve null", () => {
    assert.equal(buildChip(canvas("<p>x</p>"), { kind: "item", id: "nada" }), null);
  });

  it("CA6: canvas com mais de 16.000 caracteres vem truncado, com aviso, cabendo no limite do chip", () => {
    const built = buildChip(canvas(`<p>${"x".repeat(20_000)}</p>`), { kind: "canvas" });
    assert.ok(built);
    assert.equal(built.truncated, true);
    assert.equal(built.chip.text?.length, LIMITS.itemTextChars);
    assert.ok(built.chip.text?.endsWith("[conteúdo truncado]"));
  });

  it("título gigante não estoura o limite do texto", () => {
    const built = buildChip(canvas("<p>x</p>", "t".repeat(LIMITS.titleChars)), { kind: "canvas" });
    assert.ok((built?.chip.text?.length ?? 0) <= LIMITS.itemTextChars);
  });
});
