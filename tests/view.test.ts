import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildNodes, formatTime, mapClass } from "../src/canvas/view.ts";
import type { CanvasNode } from "../src/shared/contract.ts";

// Document mínimo: só o que buildNodes usa. Mantém o teste sem dependência de DOM.
type FakeNode = { kind: "el"; tag: string; className: string; attrs: Record<string, string>; style: { props: Record<string, string>; setProperty(n: string, v: string): void }; children: FakeChild[]; setAttribute(n: string, v: string): void; append(...c: FakeChild[]): void } | { kind: "text"; data: string } | { kind: "frag"; children: FakeChild[]; append(...c: FakeChild[]): void };
type FakeChild = FakeNode;

function fakeDocument(): Document {
  const frag = (): FakeNode => {
    const node: Extract<FakeNode, { kind: "frag" }> = { kind: "frag", children: [], append: (...c) => { for (const x of c) node.children.push(...(x.kind === "frag" ? x.children : [x])); } };
    return node;
  };
  const doc = {
    createDocumentFragment: frag,
    createTextNode: (data: string): FakeNode => ({ kind: "text", data }),
    createElement: (tag: string): FakeNode => {
      const style = { props: {} as Record<string, string>, setProperty: (n: string, v: string) => { style.props[n] = v; } };
      const node: Extract<FakeNode, { kind: "el" }> = { kind: "el", tag, className: "", attrs: {}, style, children: [], setAttribute: (n, v) => { node.attrs[n] = v; }, append: (...c) => { for (const x of c) node.children.push(...(x.kind === "frag" ? x.children : [x])); } };
      return node;
    },
  };
  return doc as unknown as Document;
}

describe("buildNodes", () => {
  const tree: CanvasNode[] = [
    { t: "el", tag: "div", attrs: { class: "card big", "data-canvas-item": "a" }, c: [{ t: "text", v: "<img src=x onerror=alert(1)>" }] },
  ];

  it("texto do agente vira nó de texto (nunca marcação) e classes ganham prefixo cv-", () => {
    const fragment = buildNodes(tree, fakeDocument()) as unknown as Extract<FakeNode, { kind: "frag" }>;
    const div = fragment.children[0] as Extract<FakeNode, { kind: "el" }>;
    assert.equal(div.tag, "div");
    assert.equal(div.className, "cv-card cv-big");
    assert.equal(div.attrs["data-canvas-item"], "a");
    assert.deepEqual(div.children, [{ kind: "text", data: "<img src=x onerror=alert(1)>" }]);
  });

  it("CA5/RN2: o gancho de ações roda só para elementos marcáveis", () => {
    const mixed: CanvasNode[] = [
      { t: "el", tag: "p", attrs: { "data-canvas-item": "a" }, c: [{ t: "text", v: "marcável" }] },
      { t: "el", tag: "p", attrs: {}, c: [{ t: "text", v: "comum" }] },
      { t: "el", tag: "div", attrs: { "data-canvas-item": "b" }, c: [{ t: "el", tag: "span", attrs: {}, c: [] }] },
    ];
    const seen: string[] = [];
    buildNodes(mixed, fakeDocument(), { onItem: (_element, id) => { seen.push(id); } });
    assert.deepEqual(seen, ["a", "b"]);
    buildNodes(mixed, fakeDocument());
  });

  it("prefixo oc- (render nativo do OpenChamber) vira o mesmo nome do canvas", () => {
    assert.equal(mapClass("oc-box"), "cv-box");
    assert.equal(mapClass("oc-badge"), "cv-badge");
    assert.equal(mapClass("card"), "cv-card");
    assert.equal(mapClass("oc-"), "cv-oc-");
  });

  it("link: o destino vai em data-href (nunca href), com papel, foco e dica com a URL", () => {
    const links: CanvasNode[] = [
      { t: "el", tag: "a", attrs: { href: "https://github.com/org/repo/pull/1" }, c: [{ t: "text", v: "PR" }] },
      { t: "el", tag: "a", attrs: { href: "https://x.com/", title: "Site" }, c: [] },
      { t: "el", tag: "a", attrs: {}, c: [{ t: "text", v: "sem link" }] },
    ];
    const fragment = buildNodes(links, fakeDocument()) as unknown as Extract<FakeNode, { kind: "frag" }>;
    const [first, second, third] = fragment.children as Array<Extract<FakeNode, { kind: "el" }>>;
    assert.equal(first!.attrs.href, undefined);
    assert.equal(first!.attrs["data-href"], "https://github.com/org/repo/pull/1");
    assert.equal(first!.attrs.role, "link");
    assert.equal(first!.attrs.tabindex, "0");
    assert.equal(first!.attrs.title, "https://github.com/org/repo/pull/1");
    assert.equal(second!.attrs.title, "Site\nhttps://x.com/");
    assert.deepEqual(third!.attrs, {});
  });

  it("data-value define --value (%) e --n pelo CSSOM, sem texto de estilo", () => {
    const bar: CanvasNode[] = [{ t: "el", tag: "div", attrs: { class: "bar", "data-tone": "success", "data-value": "42.5" }, c: [] }];
    const fragment = buildNodes(bar, fakeDocument()) as unknown as Extract<FakeNode, { kind: "frag" }>;
    const div = fragment.children[0] as Extract<FakeNode, { kind: "el" }>;
    assert.deepEqual(div.style.props, { "--value": "42.5%", "--n": "42.5" });
    assert.equal(div.attrs["data-tone"], "success");
    assert.equal(div.attrs.style, undefined);
  });

  it("parte incorporada: o gancho devolve o nó (texto de reserva não é desenhado) ou null para cair no texto", () => {
    const tree: CanvasNode[] = [{ t: "el", tag: "div", attrs: { "data-embed": "g", "data-height": "240" }, c: [{ t: "text", v: "reserva" }] }];
    const doc = fakeDocument();
    const calls: Array<[string, number | null]> = [];
    const frame = doc.createElement("iframe");
    const withFrame = buildNodes(tree, doc, { embed: (id, height) => { calls.push([id, height]); return frame; } }) as unknown as Extract<FakeNode, { kind: "frag" }>;
    assert.deepEqual(calls, [["g", 240]]);
    assert.equal((withFrame.children[0] as Extract<FakeNode, { kind: "el" }>).tag, "iframe");
    const fallback = buildNodes(tree, doc, { embed: () => null }) as unknown as Extract<FakeNode, { kind: "frag" }>;
    const div = fallback.children[0] as Extract<FakeNode, { kind: "el" }>;
    assert.equal(div.tag, "div");
    assert.deepEqual(div.children, [{ kind: "text", data: "reserva" }]);
  });

  it("formatTime devolve hora legível", () => {
    assert.match(formatTime(Date.UTC(2026, 0, 1, 12, 0, 0)), /\d{1,2}:\d{2}:\d{2}/);
  });
});

describe("guarda estática de XSS", () => {
  it("nenhum código-fonte do painel usa innerHTML, outerHTML, insertAdjacentHTML, document.write ou eval", async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    await walk(root);
    assert.ok(files.length > 0);
    for (const file of files) {
      const raw = (await readFile(file, "utf8")).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(raw, /allow-same-origin|allow-popups|allow-top-navigation|allow-forms/, `${file}: o iframe do embed nunca ganha essas permissões`);
      const code = (await readFile(file, "utf8")).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, file);
    }
  });
});
