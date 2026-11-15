/**
 * Máquina de estado do comentário em edição, sem DOM (testável).
 *
 * - O rascunho pertence à sessão em que foi aberto: trocar de sessão o descarta (RN5).
 * - Confirmar é uma operação por vez: clique repetido enquanto a anterior está em voo é ignorado
 *   (o `compose` é *append*; escrever duas vezes duplicaria o comentário).
 * - Quando a confirmação termina, só fecha o rascunho se ele ainda for o mesmo: um rascunho aberto
 *   depois, em outra sessão, nunca é fechado por uma resposta atrasada.
 */

import type { ActionResult, Actions } from "./actions.ts";

export type Draft = { readonly owner: string; readonly itemId: string; text: string; busy: boolean };

export type DraftController = {
  current(): Draft | null;
  open(owner: string, itemId: string): void;
  setText(text: string): void;
  cancel(): void;
  /** `null` quando não há rascunho ou já há uma confirmação em voo. */
  confirm(): Promise<ActionResult | null>;
  /** Chamar a cada troca da sessão em foco. */
  sessionChanged(next: string | null): void;
};

export function createDraftController(comment: Actions["comment"], onChange: () => void): DraftController {
  let draft: Draft | null = null;

  const set = (next: Draft | null): void => {
    draft = next;
    onChange();
  };

  return {
    current: () => draft,
    open(owner, itemId) {
      set({ owner, itemId, text: "", busy: false });
    },
    setText(text) {
      if (draft) draft.text = text;
    },
    cancel() {
      if (draft) set(null);
    },
    async confirm() {
      const mine = draft;
      if (!mine || mine.busy) return null;
      mine.busy = true;
      onChange();
      const result = await comment(mine.itemId, mine.text);
      if (draft === mine) {
        if (result.ok || result.reason === "session-changed") set(null);
        else {
          mine.busy = false;
          onChange();
        }
      }
      return result;
    },
    sessionChanged(next) {
      if (draft && draft.owner !== next) set(null);
    },
  };
}
