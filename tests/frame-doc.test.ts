import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { BROWSER_THEME, buildFrameDocument, FRAME_CSP, FRAME_SANDBOX, hasUserGesture, readCanvasMessage } from "../src/canvas/frame-doc.ts";
import { cleanHref } from "../src/canvas/links.ts";
import { LIMITS } from "../src/shared/contract.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = { filters: [], removed: [], scroll: 0 };
const build = (html: string, theme: Record<string, string> = {}) => buildFrameDocument({ html, theme, colorScheme: "dark", mode: "panel", state });

describe("isolamento do iframe", () => {
  it("sandbox é exatamente allow-scripts", () => {
    assert.equal(FRAME_SANDBOX, "allow-scripts");
  });

  it("CSP fecha rede, frames, formulários e base", () => {
    for (const rule of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(FRAME_CSP.includes(rule), rule);
    assert.equal(/https?:/.test(FRAME_CSP), false);
  });

  it("painel e página do navegador usam o mesmo sandbox e nunca allow-same-origin", async () => {
    const { shellPage } = await import("../server/page.ts");
    assert.match(shellPage("ses_a"), /setAttribute\("sandbox","allow-scripts"\)/);
    for (const file of ["src/main.ts", "server/page.ts", "panel/index.html"]) {
      const text = await readFile(path.join(root, file), "utf8");
      for (const bad of ["allow-same-origin", "allow-popups", "allow-forms", "allow-top-navigation"]) assert.equal(text.includes(bad), false, `${file}: ${bad}`);
    }
    assert.match(await readFile(path.join(root, "src/main.ts"), "utf8"), /setAttribute\("sandbox", FRAME_SANDBOX\)/);
  });

  it("o painel nunca insere HTML cru no próprio documento", async () => {
    for (const file of ["src/main.ts", "src/canvas/panel-state.ts", "src/canvas/actions.ts", "src/canvas/context.ts"]) {
      const text = await readFile(path.join(root, file), "utf8");
      assert.equal(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(text), false, file);
    }
  });
});

describe("buildFrameDocument", () => {
  it("ordem: CSP → tema → runtime → HTML do agente", () => {
    const doc = build("<p id=agente>oi</p>");
    const order = [doc.indexOf("Content-Security-Policy"), doc.indexOf(":root{"), doc.indexOf("<script>"), doc.indexOf("<p id=agente>")];
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(order.every((n) => n >= 0));
  });

  it("kit só entra com <link data-kit>, e o <link> é removido", () => {
    assert.equal(build("<p>x</p>").includes(".ck-card{"), false);
    const doc = build('<link data-kit><p>x</p>');
    assert.ok(doc.includes(".ck-card{"));
    assert.equal(doc.includes("<link"), false);
    assert.ok(build('<link rel="stylesheet" data-kit href="x"><p>x</p>').includes(".ck-card{"));
  });

  it("valores de tema perigosos são descartados", () => {
    const doc = build("<p>x</p>", { "--oc-fg": "red;}</style><script>x()</script>", "--oc-bg": "#111" });
    assert.equal(doc.includes("x()"), false);
    assert.ok(doc.includes("--oc-bg:#111"));
  });

  it("estado entra como JSON seguro dentro do script", () => {
    const doc = buildFrameDocument({ html: "", theme: {}, colorScheme: "dark", mode: "browser", state: { filters: ["a:b"], removed: ["</script>"], scroll: 12 } });
    assert.equal(doc.split("</script>").length, 2, "só o fechamento do runtime");
    assert.ok(doc.includes('"mode":"browser"'));
  });

  it("tema do navegador cobre as variáveis usadas pelo kit", () => {
    for (const name of ["--oc-bg", "--oc-fg", "--oc-border", "--oc-primary", "--oc-success", "--oc-error"]) assert.ok(BROWSER_THEME[name]);
  });
});

const wrap = (message: Record<string, unknown>) => ({ cvCanvas: 1, ...message });

describe("readCanvasMessage", () => {
  it("recusa o que não é do runtime", () => {
    for (const bad of [null, "x", 1, [], {}, { k: "doc" }, { cvCanvas: 2, k: "doc" }, wrap({ k: "desconhecido" })]) assert.equal(readCanvasMessage(bad), null);
  });

  it("doc: texto cortado, itens válidos e únicos", () => {
    const message = readCanvasMessage(wrap({ k: "doc", text: "x".repeat(LIMITS.canvasTextChars + 5), items: [{ id: "a", text: "1" }, { id: "a", text: "dup" }, { id: "BAD ID", text: "x" }], y: 10 }));
    assert.equal(message?.kind, "doc");
    if (message?.kind === "doc") {
      assert.equal(message.text.length, LIMITS.canvasTextChars);
      assert.deepEqual(message.items, [{ id: "a", text: "1" }]);
    }
    assert.equal(readCanvasMessage(wrap({ k: "doc", text: 1, items: [], y: 0 })), null);
    assert.equal(readCanvasMessage(wrap({ k: "doc", text: "", items: [], y: -1 })), null);
    assert.equal(readCanvasMessage(wrap({ k: "doc", text: "", items: new Array(LIMITS.items + 1).fill({ id: "a", text: "" }), y: 0 })), null);
  });

  it("state: só filtros e ids válidos", () => {
    assert.deepEqual(readCanvasMessage(wrap({ k: "state", filters: ["status:ok", "ruim", "x:y z"], removed: ["a", "../b"] })), { kind: "state", filters: ["status:ok"], removed: ["a"] });
    assert.equal(readCanvasMessage(wrap({ k: "state", filters: "x", removed: [] })), null);
  });

  it("link: só http(s) sem credenciais", () => {
    assert.deepEqual(readCanvasMessage(wrap({ k: "link", url: "https://a.com/x" })), { kind: "link", url: "https://a.com/x" });
    for (const url of ["javascript:alert(1)", "data:text/html,x", "https://u:p@a.com", "file:///etc/passwd", 5]) assert.equal(readCanvasMessage(wrap({ k: "link", url })), null);
    assert.equal(cleanHref("https://a.com/" + "x".repeat(LIMITS.hrefChars)), null);
  });

  it("scroll: número finito não negativo", () => {
    assert.deepEqual(readCanvasMessage(wrap({ k: "scroll", y: 40 })), { kind: "scroll", y: 40 });
    for (const y of [-1, NaN, Infinity, "3"]) assert.equal(readCanvasMessage(wrap({ k: "scroll", y })), null);
  });

  it("sel: limpa, ou traz retângulo; itemId inválido vira null; links filtrados", () => {
    assert.deepEqual(readCanvasMessage(wrap({ k: "sel", text: "" })), { kind: "selection-clear" });
    const rect = { top: 1, bottom: 2, left: 3, right: 4 };
    const ok = readCanvasMessage(wrap({ k: "sel", text: "abc", itemId: "x-1", itemText: "item", rect, links: [{ text: "ok", url: "https://a.com" }, { text: "mau", url: "javascript:x" }] }));
    assert.deepEqual(ok, { kind: "selection", text: "abc", itemId: "x-1", itemText: "item", links: [{ text: "ok", url: "https://a.com/" }], rect });
    const loose = readCanvasMessage(wrap({ k: "sel", text: "abc", itemId: "Ruim!", itemText: "x", rect }));
    assert.equal(loose?.kind === "selection" && loose.itemId, null);
    assert.equal(readCanvasMessage(wrap({ k: "sel", text: "abc", rect: { top: "a" } })), null);
    assert.equal(readCanvasMessage(wrap({ k: "sel", text: "abc" })), null);
  });
});

describe("hasUserGesture", () => {
  it("usa a ativação do navegador quando existe", () => {
    assert.equal(hasUserGesture({ userActivation: { isActive: false } }), false);
    assert.equal(hasUserGesture({ userActivation: { isActive: true } }), true);
    assert.equal(hasUserGesture(undefined), true);
  });
});
