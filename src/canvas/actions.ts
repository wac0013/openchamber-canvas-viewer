/**
 * Ações do painel que escrevem na caixa de mensagem do chat: adicionar ao contexto
 * (canvas inteiro, elemento marcável ou trecho selecionado).
 *
 * Fail-closed (RN5 / CA7): o chip só sai enquanto a sessão dona do canvas exibido é a sessão em
 * foco. O host escreve no composer VISÍVEL no momento da chamada, então a sessão é conferida
 * imediatamente antes de chamar; se mudou, nada é escrito. Nada é enviado ao agente: o chip fica
 * na caixa até o usuário enviar ou remover (RN1). O comentário em si o usuário escreve no campo
 * nativo da caixa de mensagem.
 */

import type { AttachIssueRequest } from "@openchamber/sdk";

import { buildChip, type ContextCanvas, type ContextTarget } from "./context.ts";

export type ActionHost = {
  attach(request: AttachIssueRequest): Promise<void>;
};

/** O que o painel mostra agora e a quem pertence. `current` é a sessão em foco neste instante. */
export type ActionSnapshot = { current: string | null; shown: ({ owner: string } & ContextCanvas) | null };

export type ActionFailure = "no-canvas" | "session-changed" | "item-missing" | "empty-selection" | "host-error";

export type ActionResult = { ok: true; truncated: boolean } | { ok: false; reason: ActionFailure };

export type Actions = {
  addToContext(target: ContextTarget): Promise<ActionResult>;
};

export const FAILURE_MESSAGES: Record<ActionFailure, string> = {
  "no-canvas": "Não há canvas para adicionar.",
  "session-changed": "A sessão em foco mudou. Nada foi enviado para a caixa de mensagem desta sessão.",
  "item-missing": "O elemento não existe mais no canvas atual.",
  "empty-selection": "Selecione um trecho de texto do canvas.",
  "host-error": "O OpenChamber recusou a ação. Tente de novo.",
};

/** A sessão dona do canvas exibido só é "a de agora" se for também a sessão em foco. */
export function ownedByFocus(snapshot: ActionSnapshot): snapshot is { current: string; shown: NonNullable<ActionSnapshot["shown"]> } {
  return snapshot.current !== null && snapshot.shown !== null && snapshot.shown.owner === snapshot.current;
}

export function createActions(host: ActionHost, read: () => ActionSnapshot): Actions {
  return {
    async addToContext(target) {
      const snapshot = read();
      if (snapshot.shown === null) return { ok: false, reason: "no-canvas" };
      if (!ownedByFocus(snapshot)) return { ok: false, reason: "session-changed" };
      const built = buildChip(snapshot.shown, target);
      if (!built) return { ok: false, reason: target.kind === "selection" ? "empty-selection" : "item-missing" };
      try {
        await host.attach(built.chip);
      } catch {
        return { ok: false, reason: "host-error" };
      }
      return { ok: true, truncated: built.truncated };
    },
  };
}
