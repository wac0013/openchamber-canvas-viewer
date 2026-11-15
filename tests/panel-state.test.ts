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

describe("parseCanvasResponse", () => {
  it("aceita JSON de resposta; recusa lixo", () => {
    assert.ok(parseCanvasResponse('{"ok":true}'));
    assert.equal(parseCanvasResponse("não json"), null);
    assert.equal(parseCanvasResponse("null"), null);
    assert.equal(parseCanvasResponse('{"x":1}'), null);
  });
});
