import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCanvasResponse, viewFromResponse } from "../src/canvas/panel-state.ts";
import { SERVICE_VERSION, type CanvasResponse } from "../src/shared/contract.ts";

const tree = [{ t: "el" as const, tag: "p", attrs: {}, c: [{ t: "text" as const, v: "oi" }] }];
const response = (extra: Partial<Extract<CanvasResponse, { ok: true }>> = {}): CanvasResponse => ({
  ok: true,
  version: SERVICE_VERSION,
  canvas: { title: "T", updatedAt: 5, tree, blocked: [] },
  error: null,
  ...extra,
});

describe("viewFromResponse", () => {
  it("sem canvas → estado vazio (CA1)", () => {
    assert.deepEqual(viewFromResponse(response({ canvas: null })), { kind: "empty", error: null });
  });

  it("vazio com publicação recusada mostra o erro", () => {
    const view = viewFromResponse(response({ canvas: null, error: { at: 1, message: "ruim" } }));
    assert.equal(view.kind, "empty");
  });

  it("com canvas → traz hora, árvore e erro da última publicação recusada (CA7)", () => {
    const view = viewFromResponse(response({ error: { at: 9, message: "x" } }));
    assert.equal(view.kind, "canvas");
    if (view.kind === "canvas") {
      assert.equal(view.updatedAt, 5);
      assert.equal(view.error?.at, 9);
      assert.equal(view.outdatedService, false);
    }
  });

  it("avisa serviço desatualizado", () => {
    const view = viewFromResponse({ ...response(), version: SERVICE_VERSION + 1 } as CanvasResponse);
    assert.equal(view.kind === "canvas" && view.outdatedService, true);
  });

  it("revalida a árvore: serviço adulterado não injeta <script>", () => {
    const evil = { ok: true, version: SERVICE_VERSION, canvas: { title: "T", updatedAt: 1, tree: [{ t: "el", tag: "script", attrs: {}, c: [] }], blocked: [] }, error: null } as unknown as CanvasResponse;
    assert.equal(viewFromResponse(evil).kind, "failed");
  });

  it("erro do serviço e resposta nula viram falha visível", () => {
    assert.equal(viewFromResponse({ ok: false, error: "x" }).kind, "failed");
    assert.equal(viewFromResponse(null).kind, "failed");
  });

  it("blocked com itens não-string é filtrado", () => {
    const raw = { ...response(), canvas: { title: "T", updatedAt: 1, tree, blocked: ["<script>", 3, null] } } as unknown as CanvasResponse;
    const view = viewFromResponse(raw);
    assert.deepEqual(view.kind === "canvas" ? view.blocked : null, ["<script>"]);
  });
});

describe("viewFromResponse — campos do serviço são validados", () => {
  it("updatedAt inválido não vira 'Invalid Date': a resposta é recusada", () => {
    for (const updatedAt of ["x", NaN, -1, 9e15, null]) {
      const raw = { ...response(), canvas: { title: "T", updatedAt, tree, blocked: [] } } as unknown as CanvasResponse;
      assert.equal(viewFromResponse(raw).kind, "failed");
    }
  });

  it("erro com tipos errados é ignorado; mensagem e avisos longos são cortados", () => {
    const bad = viewFromResponse(response({ error: { at: "x", message: 1 } as never }));
    assert.equal(bad.kind === "canvas" ? bad.error : "x", null);
    const long = viewFromResponse(response({ error: { at: 5, message: "m".repeat(1000) }, canvas: { title: "t".repeat(500), updatedAt: 5, tree, blocked: ["b".repeat(500)] } }));
    assert.ok(long.kind === "canvas");
    if (long.kind === "canvas") {
      assert.equal(long.error?.message.length, 300);
      assert.equal(long.title.length, 120);
      assert.equal(long.blocked[0]?.length, 120);
    }
  });
});

describe("parseCanvasResponse", () => {
  it("aceita JSON de resposta; recusa lixo", () => {
    assert.ok(parseCanvasResponse('{"ok":true}'));
    assert.equal(parseCanvasResponse("não json"), null);
    assert.equal(parseCanvasResponse("null"), null);
    assert.equal(parseCanvasResponse('{"x":1}'), null);
  });
});
