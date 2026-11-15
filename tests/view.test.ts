import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildNodes, formatTime } from "../src/canvas/view.ts";
import type { CanvasNode } from "../src/shared/contract.ts";

// Document mínimo: só o que buildNodes usa. Mantém o teste sem dependência de DOM.
type FakeNode = { kind: "el"; tag: string; className: string; attrs: Record<string, string>; children: FakeChild[]; setAttribute(n: string, v: string): void; append(...c: FakeChild[]): void } | { kind: "text"; data: string } | { kind: "frag"; children: FakeChild[]; append(...c: FakeChild[]): void };
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
      const node: Extract<FakeNode, { kind: "el" }> = { kind: "el", tag, className: "", attrs: {}, children: [], setAttribute: (n, v) => { node.attrs[n] = v; }, append: (...c) => { for (const x of c) node.children.push(...(x.kind === "frag" ? x.children : [x])); } };
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
      const code = (await readFile(file, "utf8")).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, file);
    }
  });
});
