import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { describe, it } from "node:test";

import { canvasRuntime } from "../src/runtime/canvas-runtime.ts";

type Listener = (event: unknown) => void;

/** DOM mínimo: um item marcado e um chip de filtro; só o que o runtime toca. */
function fakeWindow() {
  const posted: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, Listener[]>();
  const attrs = new Map<object, Map<string, string>>();
  const mk = (name: string, data: Record<string, string> = {}, text = "") => {
    const own = new Map(Object.entries(data));
    const el: Record<string, unknown> = {
      nodeName: name,
      innerText: text,
      textContent: text,
      style: {},
      getClientRects: () => [1],
      getAttribute: (key: string) => own.get(key) ?? null,
      setAttribute: (key: string, value: string) => own.set(key, value),
      removeAttribute: (key: string) => own.delete(key),
      hasAttribute: (key: string) => own.has(key),
      addEventListener: () => {},
      remove: () => {},
      appendChild: () => {},
      closest: () => null,
    };
    attrs.set(el, own);
    return el;
  };
  const one = mk("div", { "data-canvas-item": "one", "data-tags": "st:a" }, "Um");
  const two = mk("div", { "data-canvas-item": "two", "data-tags": "st:b" }, "Dois");
  const body = mk("body", {}, "Um\nDois");
  Object.assign(body, { insertBefore: () => {}, firstChild: null });
  const doc = {
    readyState: "complete",
    body,
    head: mk("head"),
    createElement: (name: string) => mk(name),
    createTextNode: (text: string) => ({ text }),
    querySelectorAll: (selector: string) => (selector.includes("data-canvas-item") ? [one, two] : []),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  };
  const win = {
    document: doc,
    scrollY: 0,
    scrollX: 0,
    parent: { postMessage: (message: Record<string, unknown>) => posted.push(message) },
    addEventListener: () => {},
    scrollTo: () => {},
    getSelection: () => null,
  };
  return { win, posted, one, two, attrs };
}

const config = { mode: "panel" as const, filters: [] as string[], removed: ["two"], scroll: 0, limits: { items: 100, itemText: 1000, canvasText: 10000, filters: 10 } };

describe("canvasRuntime", () => {
  it("é autocontido: roda serializado, sem nada do módulo", () => {
    const { win, posted } = fakeWindow();
    const source = `(${canvasRuntime.toString()})(${JSON.stringify(config)}, win)`;
    runInNewContext(source, { win, Element: class {} });
    const doc = posted.find((message) => message.k === "doc");
    assert.ok(doc, "envia o texto do canvas ao subir");
    assert.equal(doc.cvCanvas, 1);
  });

  it("item removido some da visão e não vai no texto dos itens", () => {
    const { win, posted, two } = fakeWindow();
    runInNewContext(`(${canvasRuntime.toString()})(${JSON.stringify(config)}, win)`, { win, Element: class {} });
    assert.equal((two as { hasAttribute: (k: string) => boolean }).hasAttribute("data-cv-hidden"), true);
    const doc = posted.find((message) => message.k === "doc") as { items: Array<{ id: string }> };
    assert.equal(JSON.stringify(doc.items.map((item) => item.id)), '["one"]');
  });
});
