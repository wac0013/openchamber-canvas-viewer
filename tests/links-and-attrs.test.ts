import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanHref, embedIds, parseCanvasHtml, textOf, validateTree } from "../src/canvas/sanitize.ts";
import { LIMITS } from "../src/shared/contract.ts";

function ok(html: string) {
  const result = parseCanvasHtml(html);
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

describe("cleanHref", () => {
  it("aceita http e https e normaliza a URL", () => {
    assert.equal(cleanHref("https://github.com/org/repo/pull/1"), "https://github.com/org/repo/pull/1");
    assert.equal(cleanHref("http://example.com"), "http://example.com/");
    assert.equal(cleanHref("  https://exemplo.com/a b ".trim().replace(" ", "%20")), "https://exemplo.com/a%20b");
  });

  it("recusa outros esquemas, credenciais, espaços, controles e URLs enormes", () => {
    for (const bad of [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd", "ftp://x.com", "vbscript:x", "blob:https://x.com/1",
      "//evil.com", "/relativo", "#ancora", "", "   ", "https://", "https://user:senha@x.com", "https://user@x.com", "https://x.com/a b", "https://x.com/\u202e", "https://x.com/\u0007",
      `https://x.com/${"a".repeat(LIMITS.hrefChars)}`,
    ]) {
      assert.equal(cleanHref(bad), null, bad);
    }
  });

  it("é idempotente (leitura e revalidação concordam)", () => {
    const first = cleanHref("https://BÜCHER.example/Pfad?x=1&y=2#frag");
    assert.ok(first);
    assert.equal(cleanHref(first), first);
  });
});

describe("links no HTML", () => {
  it("<a href> http(s) vira elemento com href validado e texto preservado", () => {
    const { tree, blocked } = ok('<p><a href="https://github.com/org/repo/pull/12" title="PR">PR 12</a></p>');
    assert.deepEqual(blocked, []);
    const p = tree[0];
    assert.ok(p && p.t === "el");
    const a = p.c[0];
    assert.ok(a && a.t === "el");
    assert.equal(a.tag, "a");
    assert.deepEqual(a.attrs, { href: "https://github.com/org/repo/pull/12", title: "PR" });
    assert.equal(textOf(tree), "PR 12");
  });

  it("esquemas perigosos perdem o href: o texto fica e o aviso não reproduz a URL", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://u:p@x.com/"]) {
      const { tree, blocked } = ok(`<a href="${href}">clique</a>`);
      const a = tree[0];
      assert.ok(a && a.t === "el");
      assert.deepEqual(a.attrs, {});
      assert.equal(textOf(tree), "clique");
      assert.ok(blocked.includes("link inválido (use http:// ou https://)"));
      assert.equal(JSON.stringify([tree, blocked]).includes("alert"), false);
    }
  });

  it("href fora de <a> continua bloqueado como antes", () => {
    const { tree, blocked } = ok('<p href="https://x.com">t</p>');
    const p = tree[0];
    assert.ok(p && p.t === "el");
    assert.deepEqual(p.attrs, {});
    assert.ok(blocked.includes("atributo href"));
  });

  it("validateTree: a segunda fronteira recusa href adulterado ou em outra tag", () => {
    const base = (attrs: Record<string, string>, tag = "a") => [{ t: "el", tag, attrs, c: [{ t: "text", v: "x" }] }];
    assert.ok(validateTree(base({ href: "https://x.com/" })));
    assert.equal(validateTree(base({ href: "javascript:alert(1)" })), null);
    assert.equal(validateTree(base({ href: "https://x.com" })), null, "forma não normalizada");
    assert.equal(validateTree(base({ href: "https://x.com/" }, "p")), null);
  });
});

describe("atributos visuais e de filtro", () => {
  it("data-tone aceita só os tons do tema", () => {
    const { tree, blocked } = ok('<span data-tone="success">a</span><span data-tone="rosa">b</span>');
    assert.equal((tree[0] as { attrs: Record<string, string> }).attrs["data-tone"], "success");
    assert.deepEqual((tree[1] as { attrs: Record<string, string> }).attrs, {});
    assert.ok(blocked.includes("atributo data-tone inválido"));
  });

  it("data-value é um número de 0 a 100", () => {
    for (const good of ["0", "5", "42.5", "100", "100.0"]) assert.equal((ok(`<div data-value="${good}"></div>`).tree[0] as { attrs: Record<string, string> }).attrs["data-value"], good);
    for (const bad of ["101", "-1", "1e3", "abc", "", "50%", "99.999"]) assert.deepEqual((ok(`<div data-value="${bad}"></div>`).tree[0] as { attrs: Record<string, string> }).attrs, {}, bad);
  });

  it("data-group é cortado no limite, sem bidi, e vazio é descartado", () => {
    const { tree } = ok(`<div data-group="${"g".repeat(100)}"></div><div data-group="  "></div><div data-group="a\u202eb"></div>`);
    assert.equal((tree[0] as { attrs: Record<string, string> }).attrs["data-group"]?.length, LIMITS.groupChars);
    assert.deepEqual((tree[1] as { attrs: Record<string, string> }).attrs, {});
    assert.deepEqual((tree[2] as { attrs: Record<string, string> }).attrs, {});
  });

  it("validateTree conhece os atributos novos e recusa valores inválidos", () => {
    const el = (attrs: Record<string, string>) => [{ t: "el", tag: "div", attrs, c: [] }];
    assert.ok(validateTree(el({ "data-tone": "error", "data-value": "40", "data-group": "A" })));
    assert.equal(validateTree(el({ "data-tone": "x" })), null);
    assert.equal(validateTree(el({ "data-value": "400" })), null);
    assert.equal(validateTree(el({ "data-group": "" })), null);
  });
});

describe("data-embed", () => {
  it("aceita em <div> com altura opcional e lista os ids", () => {
    const { tree, blocked } = ok('<div data-embed="grafico" data-height="240">texto</div><div data-embed="outro"></div>');
    assert.deepEqual(blocked, []);
    assert.deepEqual(embedIds(tree), ["grafico", "outro"]);
    assert.equal((tree[0] as { attrs: Record<string, string> }).attrs["data-height"], "240");
  });

  it("altura fora de 60–1200 é descartada com aviso", () => {
    for (const bad of ["10", "59", "1201", "abc", "99999"]) {
      const { tree, blocked } = ok(`<div data-embed="a" data-height="${bad}"></div>`);
      assert.equal((tree[0] as { attrs: Record<string, string> }).attrs["data-height"], undefined, bad);
      assert.ok(blocked.includes("atributo data-height inválido"));
    }
  });

  it("id inválido ou repetido recusa o canvas; em outra tag é só avisado", () => {
    assert.equal(parseCanvasHtml('<div data-embed="A B"></div>').ok, false);
    assert.equal(parseCanvasHtml('<div data-embed="a"></div><div data-embed="a"></div>').ok, false);
    const { blocked } = ok('<p data-embed="a">x</p>');
    assert.ok(blocked.includes("data-embed fora de <div>"));
  });

  it("mais de 8 partes recusa", () => {
    const html = Array.from({ length: LIMITS.embeds + 1 }, (_, index) => `<div data-embed="e${index}"></div>`).join("");
    assert.equal(parseCanvasHtml(html).ok, false);
  });

  it("validateTree: só em <div>, ids únicos e dentro do limite", () => {
    assert.equal(validateTree([{ t: "el", tag: "p", attrs: { "data-embed": "a" }, c: [] }]), null);
    const twice = [{ t: "el", tag: "div", attrs: { "data-embed": "a" }, c: [] }, { t: "el", tag: "div", attrs: { "data-embed": "a" }, c: [] }];
    assert.equal(validateTree(twice), null);
  });
});
