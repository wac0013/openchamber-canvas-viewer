import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEmbedDocument, EMBED_CSP, EMBED_SANDBOX, hasUserGesture, readEmbedMessage } from "../src/canvas/embed-frame.ts";
import { parseEmbedsInput, validateEmbeds } from "../src/canvas/embeds.ts";
import { buildSnapshot } from "../src/canvas/snapshot.ts";
import { LIMITS } from "../src/shared/contract.ts";

describe("parseEmbedsInput", () => {
  it("ausente = nenhuma parte", () => {
    assert.deepEqual(parseEmbedsInput(undefined), { ok: true, embeds: {} });
    assert.deepEqual(parseEmbedsInput(null), { ok: true, embeds: {} });
  });

  it("aceita HTML completo com style, script e svg", () => {
    const html = "<style>a{}</style><svg><circle/></svg><script>1</script>";
    assert.deepEqual(parseEmbedsInput([{ id: "g1", html }]), { ok: true, embeds: { g1: html } });
  });

  it("recusa formato, id, repetição, vazio, tamanho, controle e quantidade", () => {
    const bad: unknown[] = [
      "texto", {}, [null], [{ id: "A", html: "x" }], [{ id: "a b", html: "x" }], [{ id: "__proto__", html: "x" }], [{ id: "a", html: 3 }], [{ id: "a", html: "   " }],
      [{ id: "a", html: "x" }, { id: "a", html: "y" }], [{ id: "a", html: "x".repeat(LIMITS.embedChars + 1) }], [{ id: "a", html: "a\u0001b" }],
      Array.from({ length: LIMITS.embeds + 1 }, (_, index) => ({ id: `e${index}`, html: "x" })),
      [{ id: "a", html: "x".repeat(LIMITS.embedChars) }, { id: "b", html: "x".repeat(LIMITS.embedChars) }, { id: "c", html: "x" }],
    ];
    for (const value of bad) assert.equal(parseEmbedsInput(value).ok, false, JSON.stringify(value).slice(0, 60));
  });
});

describe("validateEmbeds (segunda fronteira)", () => {
  it("ausente vira {} (registro de versão anterior)", () => {
    assert.deepEqual(validateEmbeds(undefined), {});
  });
  it("aceita o mapa válido e recusa corrompido", () => {
    assert.deepEqual(validateEmbeds({ a: "<p>x</p>" }), { a: "<p>x</p>" });
    for (const bad of [[], "x", null, { A: "x" }, { a: 1 }, { a: "" }]) assert.equal(validateEmbeds(bad), null);
  });
});

describe("buildSnapshot com embeds", () => {
  it("guarda só as partes usadas e avisa sobre sobra e referência sem conteúdo", () => {
    const built = buildSnapshot("T", '<div data-embed="a">alt</div><div data-embed="faltando">alt</div>', 1, [
      { id: "a", html: "<p>a</p>" },
      { id: "sobra", html: "<p>s</p>" },
    ]);
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.deepEqual(built.snapshot.embeds, { a: "<p>a</p>" });
    assert.ok(built.snapshot.blocked.includes("embed sem uso: sobra"));
    assert.ok(built.snapshot.blocked.includes("data-embed sem conteúdo: faltando"));
  });

  it("embeds inválidos recusam a publicação inteira", () => {
    const built = buildSnapshot("T", '<div data-embed="a"></div>', 1, [{ id: "A", html: "x" }]);
    assert.equal(built.ok, false);
  });

  it("sem embeds o snapshot tem mapa vazio", () => {
    const built = buildSnapshot("T", "<p>x</p>", 1);
    assert.ok(built.ok && Object.keys(built.snapshot.embeds).length === 0);
  });
});

describe("documento do iframe", () => {
  const theme = { "--oc-fg": "#eee", "--oc-bg": "#111", "--oc-font": "Inter, sans-serif" };

  it("a CSP vem antes de qualquer conteúdo e proíbe rede, frames e formulários", () => {
    const doc = buildEmbedDocument("<p>oi</p>", theme, "dark");
    assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("<p>oi</p>"));
    for (const expected of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'"]) assert.ok(EMBED_CSP.includes(expected), expected);
    assert.equal(/https?:|\*/.test(EMBED_CSP), false, "nenhuma origem externa");
    assert.equal(EMBED_CSP.includes("unsafe-eval"), false);
  });

  it("repassa o tema como variáveis CSS e o esquema de cores", () => {
    const doc = buildEmbedDocument("x", theme, "light");
    assert.ok(doc.includes("--oc-fg:#eee"));
    assert.ok(doc.includes("color-scheme:light"));
    assert.ok(doc.includes("--chart-1"));
  });

  it("valor de tema com marcação não escapa do <style>", () => {
    const doc = buildEmbedDocument("x", { "--oc-fg": "red;}</style><script>alert(1)</script>", "--oc-bg": "#000" }, "dark");
    assert.equal(doc.includes("alert(1)"), false);
    assert.ok(doc.includes("--oc-bg:#000"));
  });

  it("o sandbox é só allow-scripts", () => {
    assert.equal(EMBED_SANDBOX, "allow-scripts");
  });
});

describe("mensagens do iframe", () => {
  it("altura é limitada; link é revalidado; o resto é ignorado", () => {
    assert.deepEqual(readEmbedMessage({ cvEmbed: 1, k: "h", v: 300.4 }), { kind: "height", value: 300 });
    assert.deepEqual(readEmbedMessage({ cvEmbed: 1, k: "h", v: 99999 }), { kind: "height", value: LIMITS.embedHeightMax });
    assert.deepEqual(readEmbedMessage({ cvEmbed: 1, k: "h", v: -5 }), { kind: "height", value: 20 });
    assert.deepEqual(readEmbedMessage({ cvEmbed: 1, k: "l", v: "https://example.com/x" }), { kind: "link", url: "https://example.com/x" });
    for (const bad of [null, "x", {}, { cvEmbed: 2, k: "h", v: 1 }, { cvEmbed: 1, k: "h", v: "1" }, { cvEmbed: 1, k: "h", v: NaN },
      { cvEmbed: 1, k: "l", v: "javascript:alert(1)" }, { cvEmbed: 1, k: "l", v: "about:srcdoc#x" }, { cvEmbed: 1, k: "l", v: 5 }, { cvEmbed: 1, k: "x", v: 1 }]) {
      assert.equal(readEmbedMessage(bad), null, JSON.stringify(bad));
    }
  });

  it("link só abre com gesto do usuário quando o navegador informa a ativação", () => {
    assert.equal(hasUserGesture({ userActivation: { isActive: false } }), false);
    assert.equal(hasUserGesture({ userActivation: { isActive: true } }), true);
    assert.equal(hasUserGesture(undefined), true);
    assert.equal(hasUserGesture({}), true);
  });
});
