/**
 * Ações do painel que escrevem na caixa de mensagem do chat: adicionar ao contexto e comentar.
 *
 * Fail-closed (RN5 / CA7): o chip e o texto só saem enquanto a sessão dona do canvas exibido é a
 * sessão em foco. O host escreve no composer VISÍVEL no momento da chamada, então a sessão é
 * conferida imediatamente antes de cada chamada; se mudou, nada é escrito. Nada é enviado ao
 * agente: o chip e o texto ficam na caixa até o usuário enviar ou remover (RN1).
 */

import type { AttachIssueRequest, ComposeRequest } from "@openchamber/sdk";

import { LIMITS } from "../shared/contract.ts";
import { buildChip, type ContextCanvas, type ContextTarget } from "./context.ts";

export type ActionHost = {
  attach(request: AttachIssueRequest): Promise<void>;
  compose(request: ComposeRequest): Promise<void>;
};

/** O que o painel mostra agora e a quem pertence. `current` é a sessão em foco neste instante. */
export type ActionSnapshot = { current: string | null; shown: ({ owner: string } & ContextCanvas) | null };

export type ActionFailure = "no-canvas" | "session-changed" | "item-missing" | "empty-comment" | "comment-too-long" | "host-error";

export type ActionResult =
  | { ok: true; truncated: boolean }
  | { ok: false; reason: ActionFailure; /** O chip já tinha sido anexado quando a sessão mudou. */ attached?: boolean };

export type Actions = {
  addToContext(target: ContextTarget): Promise<ActionResult>;
  comment(itemId: string, text: string): Promise<ActionResult>;
};

export const FAILURE_MESSAGES: Record<ActionFailure, string> = {
  "no-canvas": "Não há canvas para adicionar.",
  "session-changed": "A sessão em foco mudou. Nada foi enviado para a caixa de mensagem desta sessão.",
  "item-missing": "O elemento não existe mais no canvas atual.",
  "empty-comment": "Escreva o comentário antes de confirmar.",
  "comment-too-long": `O comentário passa de ${LIMITS.itemTextChars} caracteres.`,
  "host-error": "O OpenChamber recusou a ação. Tente de novo.",
};

/** A sessão dona do canvas exibido só é "a de agora" se for também a sessão em foco. */
export function ownedByFocus(snapshot: ActionSnapshot): snapshot is { current: string; shown: NonNullable<ActionSnapshot["shown"]> } {
  return snapshot.current !== null && snapshot.shown !== null && snapshot.shown.owner === snapshot.current;
}

export function createActions(host: ActionHost, read: () => ActionSnapshot): Actions {
  const before = (): { owner: string; shown: NonNullable<ActionSnapshot["shown"]> } | ActionFailure => {
    const snapshot = read();
    if (snapshot.shown === null) return "no-canvas";
    if (!ownedByFocus(snapshot)) return "session-changed";
    return { owner: snapshot.current, shown: snapshot.shown };
  };

  return {
    async addToContext(target) {
      const state = before();
      if (typeof state === "string") return { ok: false, reason: state };
      const built = buildChip(state.shown, target);
      if (!built) return { ok: false, reason: "item-missing" };
      try {
        await host.attach(built.chip);
      } catch {
        return { ok: false, reason: "host-error" };
      }
      return { ok: true, truncated: built.truncated };
    },

    async comment(itemId, text) {
      const comment = text.trim();
      if (!comment) return { ok: false, reason: "empty-comment" };
      if (comment.length > LIMITS.itemTextChars) return { ok: false, reason: "comment-too-long" };
      const state = before();
      if (typeof state === "string") return { ok: false, reason: state };
      const built = buildChip(state.shown, { kind: "item", id: itemId });
      if (!built) return { ok: false, reason: "item-missing" };
      try {
        await host.attach(built.chip);
      } catch {
        return { ok: false, reason: "host-error" };
      }
      const after = read();
      if (!ownedByFocus(after) || after.current !== state.owner) return { ok: false, reason: "session-changed", attached: true };
      try {
        await host.compose({ text: comment, mode: "append" });
      } catch {
        return { ok: false, reason: "host-error", attached: true };
      }
      return { ok: true, truncated: built.truncated };
    },
  };
}
