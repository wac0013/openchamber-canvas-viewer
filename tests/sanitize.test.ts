import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCanvasHtml, structureSignature, textOf, validateTree } from "../src/canvas/sanitize.ts";
import { LIMITS } from "../src/shared/contract.ts";

function ok(html: string) {
  const result = parseCanvasHtml(html);
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

describe("parseCanvasHtml — conteúdo válido", () => {
  it("lê tags, classes, itens marcáveis e decodifica entidades", () => {
    const { tree, blocked } = ok('<div class="card big"><h1>Olá &amp; tchau</h1><p data-canvas-item="p-1">a &lt; b</p></div>');
    assert.deepEqual(blocked, []);
    assert.equal(tree.length, 1);
    assert.equal(textOf(tree), "Olá & tchaua < b");
    const card = tree[0];
    assert.ok(card && card.t === "el");
    assert.equal(card.attrs.class, "card big");
  });

  it("aceita tags void e auto-fechadas e comentários", () => {
    const { tree } = ok("<p>a<br>b<hr/></p><!-- nota -->");
    assert.equal(textOf(tree), "a\nb");
  });

  it("tabelas com colspan/rowspan válidos", () => {
    const { tree, blocked } = ok('<table><tr><td colspan="2">x</td></tr></table>');
    assert.deepEqual(blocked, []);
    assert.equal(textOf(tree), "x");
  });
});

describe("parseCanvasHtml — o proibido é removido e o resto segue (CA8)", () => {
  it("remove <script> junto com o conteúdo e mantém o restante", () => {
    const { tree, blocked } = ok("<p>antes</p><script>fetch('http://evil')</script><p>depois</p>");
    assert.equal(textOf(tree), "antesdepois");
    assert.deepEqual(blocked, ["<script>"]);
    assert.equal(JSON.stringify(tree).includes("evil"), false);
  });

  it("remove <style>, <iframe>, <svg>, <object> e <template> com conteúdo", () => {
    const { tree, blocked } = ok("<style>p{background:url(//x)}</style><iframe src=x>fb</iframe><svg><circle/></svg><object>o</object><template>t</template><p>ok</p>");
    assert.equal(textOf(tree), "ok");
    assert.deepEqual(blocked.sort(), ["<iframe>", "<object>", "<style>", "<svg>", "<template>"]);
  });

  it("remove imagens, links e mídia sem conteúdo; desembrulha <a> e <button> mantendo o texto", () => {
    const { tree, blocked } = ok('<img src="http://x/a.png"><a href="javascript:alert(1)">clique</a><button>ok</button><input value=1>');
    assert.equal(textOf(tree), "cliqueok");
    assert.ok(blocked.includes("<img>") && blocked.includes("<a>") && blocked.includes("<button>") && blocked.includes("<input>"));
    assert.equal(JSON.stringify(tree).includes("javascript"), false);
  });

  it("remove handlers on*, href, src, style e atributos desconhecidos", () => {
    const { tree, blocked } = ok('<p onclick="x()" style="color:red" href="//x" src="y" id="z" data-x="1">t</p>');
    const p = tree[0];
    assert.ok(p && p.t === "el");
    assert.deepEqual(p.attrs, {});
    assert.ok(blocked.includes("atributo on*") && blocked.includes("atributo style") && blocked.includes("atributo href"));
  });

  it("remove declarações (<!doctype>, <?xml>)", () => {
    const { tree, blocked } = ok("<!doctype html><?xml version='1.0'?><p>a</p>");
    assert.equal(textOf(tree), "a");
    assert.deepEqual(blocked, ["declaração (<! ou <?)"]);
  });

  it("tags com maiúsculas e variações não escapam do bloqueio", () => {
    const { tree } = ok("<SCRIPT>alert(1)</SCRIPT><ScRiPt\n>x</sCrIpT ><p>a</p>");
    assert.equal(textOf(tree), "a");
  });

  it("não reproduz o conteúdo do agente nos avisos", () => {
    const { blocked } = ok('<script>segredo-123</script><p onclick="segredo-456">a</p>');
    assert.equal(blocked.join(" ").includes("segredo"), false);
  });
});

describe("parseCanvasHtml — malformado é recusado (RN4)", () => {
  const bad: Array<[string, string]> = [
    ["tag não fechada", "<div><p>oi</div>"],
    ["fechamento órfão", "<p>a</p></div>"],
    ["< solto", "a < b"],
    ["comentário aberto", "<p>a</p><!-- x"],
    ["script não fechado", "<script>alert(1)"],
    ["data-canvas-item inválido", '<p data-canvas-item="A B">x</p>'],
    ["data-canvas-item repetido", '<p data-canvas-item="a">x</p><p data-canvas-item="a">y</p>'],
    ["caractere de controle", "<p>a\u0001b</p>"],
  ];
  for (const [name, html] of bad) {
    it(name, () => {
      assert.equal(parseCanvasHtml(html).ok, false);
    });
  }

  it("não-texto", () => {
    assert.equal(parseCanvasHtml(42).ok, false);
    assert.equal(parseCanvasHtml(null).ok, false);
  });

  it("html acima do limite", () => {
    const result = parseCanvasHtml("a".repeat(LIMITS.htmlChars + 1));
    assert.equal(result.ok, false);
  });

  it("aninhamento acima do limite", () => {
    const html = "<div>".repeat(LIMITS.depth + 1) + "</div>".repeat(LIMITS.depth + 1);
    assert.equal(parseCanvasHtml(html).ok, false);
    const fine = "<div>".repeat(LIMITS.depth) + "</div>".repeat(LIMITS.depth);
    assert.equal(parseCanvasHtml(fine).ok, true);
  });

  it("nós acima do limite", () => {
    assert.equal(parseCanvasHtml("<i></i>".repeat(LIMITS.nodes + 1)).ok, false);
  });

  it("itens marcáveis acima do limite", () => {
    const html = Array.from({ length: LIMITS.items + 1 }, (_, i) => `<p data-canvas-item="i${i}">x</p>`).join("");
    assert.equal(parseCanvasHtml(html).ok, false);
  });

  it("a mensagem de recusa não ecoa o conteúdo", () => {
    const result = parseCanvasHtml("<div>segredo-789");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message.includes("segredo"), false);
  });
});

describe("parseCanvasHtml — endurecimentos da revisão", () => {
  it("entidade com nome do protótipo não vira código (&toString;)", () => {
    const { tree } = ok("<p>&toString; &constructor; &__proto__;</p>");
    assert.equal(textOf(tree), "&toString; &constructor; &__proto__;");
  });

  it("remove controles bidirecionais do texto e avisa", () => {
    const { tree, blocked } = ok("<p>abc\u202edef</p>");
    assert.equal(textOf(tree), "abcdef");
    assert.deepEqual(blocked, ["controle bidirecional"]);
  });

  it("classe com maiúscula é removida e avisada, sem recusar o canvas", () => {
    const { tree, blocked } = ok('<p class="ok Bad">x</p>');
    const p = tree[0];
    assert.ok(p && p.t === "el");
    assert.equal(p.attrs.class, "ok");
    assert.ok(blocked.some((note) => note.startsWith("classe inválida")));
  });

  it("limite de profundidade: 32 elementos com texto folha passam no parser E no validateTree", () => {
    const nest = (n: number) => "<div>".repeat(n) + "x" + "</div>".repeat(n);
    const fine = ok(nest(LIMITS.depth)).tree;
    assert.notEqual(validateTree(fine), null);
    assert.equal(parseCanvasHtml(nest(LIMITS.depth + 1)).ok, false);
  });
});

describe("parseCanvasHtml — fronteira de profundidade com tags void e autofechadas", () => {
  const open = (n: number, tail: string) => "<div>".repeat(n) + tail + "</div>".repeat(n);

  it("o que o parser aceita, o validateTree também aceita (para qualquer tipo de folha)", () => {
    for (const tail of ["x", "<br>", "<hr/>", "<span/>", "<p></p>"]) {
      for (const n of [LIMITS.depth - 2, LIMITS.depth - 1, LIMITS.depth, LIMITS.depth + 1]) {
        const parsed = parseCanvasHtml(open(n, tail));
        if (parsed.ok) assert.notEqual(validateTree(parsed.tree), null, `${tail} em ${n}`);
      }
    }
  });

  it("folha void ou autofechada no nível 33 é recusada pelo parser (não passa para o disco)", () => {
    assert.equal(parseCanvasHtml(open(LIMITS.depth, "<br>")).ok, false);
    assert.equal(parseCanvasHtml(open(LIMITS.depth, "<hr/>")).ok, false);
    assert.equal(parseCanvasHtml(open(LIMITS.depth, "<span/>")).ok, false);
    assert.equal(parseCanvasHtml(open(LIMITS.depth - 1, "<br>")).ok, true);
  });
});

describe("validateTree — segunda fronteira de confiança", () => {
  const good = [{ t: "el", tag: "p", attrs: { class: "a", "data-canvas-item": "x" }, c: [{ t: "text", v: "oi" }] }];

  it("aceita uma árvore válida e devolve cópia", () => {
    const clean = validateTree(good);
    assert.deepEqual(clean, good);
    assert.notEqual(clean, good);
  });

  it("recusa tag fora da lista, atributo perigoso, texto não-string e raiz não-array", () => {
    assert.equal(validateTree([{ t: "el", tag: "script", attrs: {}, c: [] }]), null);
    assert.equal(validateTree([{ t: "el", tag: "p", attrs: { onclick: "x" }, c: [] }]), null);
    assert.equal(validateTree([{ t: "el", tag: "p", attrs: { href: "http://x" }, c: [] }]), null);
    assert.equal(validateTree([{ t: "el", tag: "p", attrs: { style: "x" }, c: [] }]), null);
    assert.equal(validateTree([{ t: "text", v: 1 }]), null);
    assert.equal(validateTree({ t: "text", v: "a" }), null);
    assert.equal(validateTree([null]), null);
  });

  it("recusa item repetido, classe inválida, void com filhos e profundidade excessiva", () => {
    const item = (id: string) => ({ t: "el", tag: "p", attrs: { "data-canvas-item": id }, c: [] });
    assert.equal(validateTree([item("a"), item("a")]), null);
    assert.equal(validateTree([{ t: "el", tag: "p", attrs: { class: "X" }, c: [] }]), null);
    assert.equal(validateTree([{ t: "el", tag: "br", attrs: {}, c: [{ t: "text", v: "x" }] }]), null);
    let deep: unknown = { t: "text", v: "x" };
    for (let i = 0; i < LIMITS.depth + 1; i++) deep = { t: "el", tag: "div", attrs: {}, c: [deep] };
    assert.equal(validateTree([deep]), null);
  });
});

describe("textOf e structureSignature", () => {
  it("textOf respeita o limite", () => {
    const { tree } = ok(`<p>${"a".repeat(100)}</p>`);
    assert.equal(textOf(tree, 10).length, 10);
  });

  it("assinatura igual para mesma estrutura com texto diferente; diferente para estrutura nova", () => {
    const a = ok("<div><h1>a</h1><p>x</p></div>").tree;
    const b = ok("<div><h1>b</h1><p>y</p></div>").tree;
    const c = ok("<div><h1>a</h1><p>x</p><p>z</p></div>").tree;
    assert.equal(structureSignature(a), structureSignature(b));
    assert.notEqual(structureSignature(a), structureSignature(c));
  });
});
