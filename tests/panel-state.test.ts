import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { infoFromBody, rootOfEvent, viewFromBody } from "../src/canvas/panel-state.ts";
import { cleanHref } from "../src/canvas/links.ts";
import { LIMITS, SERVICE_VERSION } from "../src/shared/contract.ts";

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ok: true, rootId: "ses_A", version: SERVICE_VERSION, canvas: { title: "T", html: "<p>oi</p>", updatedAt: 5 }, ...extra });

describe("viewFromBody", () => {
  it("canvas válido", () => {
    assert.deepEqual(viewFromBody(body()), { kind: "canvas", rootId: "ses_A", title: "T", html: "<p>oi</p>", updatedAt: 5, outdatedService: false });
  });

  it("sem canvas → estado vazio da raiz", () => {
    assert.deepEqual(viewFromBody(body({ canvas: null })), { kind: "empty", rootId: "ses_A", outdatedService: false });
  });

  it("versão diferente do serviço marca como desatualizado", () => {
    assert.equal(viewFromBody(body({ version: 1 })).kind === "canvas" && (viewFromBody(body({ version: 1 })) as { outdatedService: boolean }).outdatedService, true);
    assert.equal(viewFromBody(body({ canvas: null, version: undefined })).kind, "empty");
  });

  it("lixo, erro do serviço, raiz inválida e updatedAt inválido viram falha visível", () => {
    assert.equal(viewFromBody("não é json").kind, "failed");
    assert.equal(viewFromBody("null").kind, "failed");
    assert.deepEqual(viewFromBody(JSON.stringify({ ok: false, error: "x".repeat(500) })).kind, "failed");
    assert.equal(viewFromBody(body({ rootId: "../x" })).kind, "failed");
    assert.equal(viewFromBody(body({ canvas: { title: "T", html: "x", updatedAt: "ontem" } })).kind, "failed");
    assert.equal(viewFromBody(body({ canvas: { title: "T", html: "x", updatedAt: -1 } })).kind, "failed");
  });

  it("html acima do limite é recusado e título longo é cortado", () => {
    assert.equal(viewFromBody(body({ canvas: { title: "T", html: "x".repeat(LIMITS.canvasBytes + 1), updatedAt: 5 } })).kind, "failed");
    const view = viewFromBody(body({ canvas: { title: "t".repeat(500), html: "x", updatedAt: 5 } }));
    assert.equal(view.kind === "canvas" && view.title.length, LIMITS.titleChars);
  });
});

describe("infoFromBody", () => {
  it("só devolve link http/https válido", () => {
    assert.equal(infoFromBody(JSON.stringify({ ok: true, url: "https://canvas.homelab.lan/s/ses_A?t=abc" }), cleanHref), "https://canvas.homelab.lan/s/ses_A?t=abc");
    assert.equal(infoFromBody(JSON.stringify({ ok: true, url: "javascript:alert(1)" }), cleanHref), null);
    assert.equal(infoFromBody(JSON.stringify({ ok: false }), cleanHref), null);
    assert.equal(infoFromBody("lixo", cleanHref), null);
  });
});

describe("rootOfEvent", () => {
  it("exige um rootId válido", () => {
    assert.equal(rootOfEvent({ rootId: "ses_A" }), "ses_A");
    assert.equal(rootOfEvent({ rootId: "a/b" }), null);
    assert.equal(rootOfEvent(null), null);
    assert.equal(rootOfEvent([]), null);
    assert.equal(rootOfEvent({}), null);
  });
});
