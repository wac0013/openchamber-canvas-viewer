import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ActionResult } from "../src/canvas/actions.ts";
import { createDraftController } from "../src/canvas/comment-draft.ts";

type Resolver = (result: ActionResult) => void;

function setup() {
  const calls: Array<{ itemId: string; text: string }> = [];
  const pending: Resolver[] = [];
  let changes = 0;
  const controller = createDraftController(
    (itemId, text) => {
      calls.push({ itemId, text });
      return new Promise<ActionResult>((resolve) => pending.push(resolve));
    },
    () => { changes += 1; },
  );
  return { controller, calls, pending, changes: () => changes };
}

const ok: ActionResult = { ok: true, truncated: false };

describe("comment-draft", () => {
  it("abrir cria o rascunho da sessão dona; cancelar não chama o host (CA4)", () => {
    const { controller, calls } = setup();
    controller.open("A", "n1");
    assert.deepEqual({ ...controller.current()! }, { owner: "A", itemId: "n1", text: "", busy: false });
    controller.cancel();
    assert.equal(controller.current(), null);
    assert.deepEqual(calls, []);
  });

  it("confirmar chama o host com o texto digitado e fecha em caso de sucesso (CA3)", async () => {
    const { controller, calls, pending } = setup();
    controller.open("A", "n1");
    controller.setText("este número está errado");
    const done = controller.confirm();
    pending[0]!(ok);
    assert.deepEqual(await done, ok);
    assert.deepEqual(calls, [{ itemId: "n1", text: "este número está errado" }]);
    assert.equal(controller.current(), null);
  });

  it("duplo clique em confirmar escreve UMA vez (compose é append)", async () => {
    const { controller, calls, pending } = setup();
    controller.open("A", "n1");
    controller.setText("oi");
    const first = controller.confirm();
    const second = controller.confirm();
    assert.equal(await second, null);
    assert.equal(controller.current()?.busy, true);
    pending[0]!(ok);
    await first;
    assert.equal(calls.length, 1);
  });

  it("falha comum mantém o rascunho e libera para tentar de novo", async () => {
    const { controller, pending } = setup();
    controller.open("A", "n1");
    controller.setText("oi");
    const done = controller.confirm();
    pending[0]!({ ok: false, reason: "host-error" });
    await done;
    assert.equal(controller.current()?.text, "oi");
    assert.equal(controller.current()?.busy, false);
  });

  it("falha 'session-changed' fecha o rascunho", async () => {
    const { controller, pending } = setup();
    controller.open("A", "n1");
    controller.setText("oi");
    const done = controller.confirm();
    pending[0]!({ ok: false, reason: "session-changed", attached: true });
    await done;
    assert.equal(controller.current(), null);
  });

  it("CA7: trocar de sessão descarta o rascunho; permanecer na mesma não", () => {
    const { controller } = setup();
    controller.open("A", "n1");
    controller.sessionChanged("A");
    assert.ok(controller.current());
    controller.sessionChanged("B");
    assert.equal(controller.current(), null);
    controller.open("A", "n1");
    controller.sessionChanged(null);
    assert.equal(controller.current(), null);
  });

  it("resposta atrasada de A não fecha o rascunho aberto depois em B", async () => {
    const { controller, pending } = setup();
    controller.open("A", "n1");
    controller.setText("de A");
    const lateA = controller.confirm();
    controller.sessionChanged("B");
    controller.open("B", "m2");
    controller.setText("de B");
    pending[0]!(ok);
    await lateA;
    assert.equal(controller.current()?.owner, "B");
    assert.equal(controller.current()?.text, "de B");
    assert.equal(controller.current()?.busy, false);
  });

  it("confirmar sem rascunho não faz nada", async () => {
    assert.equal(await setup().controller.confirm(), null);
  });

  it("setText sem rascunho é ignorado", () => {
    const { controller } = setup();
    controller.setText("x");
    assert.equal(controller.current(), null);
  });
});
