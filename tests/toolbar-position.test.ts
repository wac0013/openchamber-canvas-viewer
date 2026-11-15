import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isInView, placeToolbar } from "../src/canvas/toolbar-position.ts";

const viewport = { width: 400, height: 600 };
const toolbar = { width: 160, height: 30 };

describe("placeToolbar", () => {
  it("fica acima do trecho e centralizada nele", () => {
    const place = placeToolbar({ top: 200, bottom: 216, left: 100, right: 220 }, viewport, toolbar);
    assert.deepEqual(place, { top: 164, left: 80, side: "above" });
  });

  it("sem espaço acima, vai para baixo", () => {
    const place = placeToolbar({ top: 10, bottom: 26, left: 100, right: 220 }, viewport, toolbar);
    assert.equal(place.side, "below");
    assert.equal(place.top, 32);
  });

  it("não sai da janela pelos lados", () => {
    assert.equal(placeToolbar({ top: 200, bottom: 216, left: 0, right: 20 }, viewport, toolbar).left, 4);
    assert.equal(placeToolbar({ top: 200, bottom: 216, left: 380, right: 400 }, viewport, toolbar).left, 236);
  });

  it("embaixo também fica contida na altura da janela", () => {
    const place = placeToolbar({ top: 0, bottom: 590, left: 100, right: 200 }, viewport, toolbar);
    assert.equal(place.side, "below");
    assert.ok(place.top + toolbar.height <= viewport.height);
  });

  it("janela mais estreita que a barra: ancora na borda esquerda", () => {
    assert.equal(placeToolbar({ top: 200, bottom: 216, left: 10, right: 30 }, { width: 100, height: 600 }, toolbar).left, 4);
  });

  it("seleção abaixo da dobra: a barra fica contida na janela mesmo acima do trecho (revisão M1)", () => {
    const place = placeToolbar({ top: 704, bottom: 720, left: 100, right: 220 }, { width: 400, height: 640 }, toolbar);
    assert.ok(place.top + toolbar.height <= 640 - 4);
    assert.ok(place.top >= 4);
  });
});

describe("isInView", () => {
  const area = { top: 40, bottom: 600, left: 0, right: 400 };
  it("seleção dentro da área visível", () => {
    assert.equal(isInView({ top: 100, bottom: 120, left: 0, right: 10 }, area), true);
  });
  it("parcialmente visível ainda conta", () => {
    assert.equal(isInView({ top: 590, bottom: 640, left: 0, right: 10 }, area), true);
    assert.equal(isInView({ top: 20, bottom: 50, left: 0, right: 10 }, area), true);
  });
  it("rolada para fora, acima ou abaixo, não conta (a barra some em vez de ficar presa)", () => {
    assert.equal(isInView({ top: -30, bottom: -10, left: 0, right: 10 }, area), false);
    assert.equal(isInView({ top: 700, bottom: 720, left: 0, right: 10 }, area), false);
    assert.equal(isInView({ top: 10, bottom: 40, left: 0, right: 10 }, area), false);
  });
});
