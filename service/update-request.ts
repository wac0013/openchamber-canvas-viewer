/**
 * Pedido de atualização do canvas: o serviço manda ao agente, em nome do usuário, a mensagem
 * fixa `UPDATE_REQUEST_TEXT`, para a sessão EXPLÍCITA que o painel informou (nunca "a sessão em
 * foco do host": uma troca de sessão no instante do clique não desvia o pedido).
 *
 * Não interrompe o agente: sessão ocupada (`busy`) ou esperando resposta do usuário (`waiting`,
 * onde `sessions.send` fecharia a pergunta pendente) não recebe o pedido. Um pedido por vez por
 * sessão e com intervalo mínimo; a vaga é reservada ANTES de qualquer `await`, então dois cliques
 * simultâneos nunca enviam duas mensagens.
 */

import { SESSION_ID_PATTERN, UPDATE_MIN_INTERVAL_MS, UPDATE_REQUEST_TEXT, type UpdateRequestResponse } from "../src/shared/contract.ts";

export type UpdateHost = {
  status(sessionId: string): Promise<{ status: "idle" | "busy" | "waiting" }>;
  send(sessionId: string, prompt: string): Promise<unknown>;
};

export type UpdateRequester = {
  request(sessionId: string): Promise<UpdateRequestResponse>;
};

function isHostError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}

export function createUpdateRequester(host: UpdateHost, now: () => number = Date.now, minIntervalMs: number = UPDATE_MIN_INTERVAL_MS): UpdateRequester {
  const reserved = new Map<string, number>();

  const prune = (at: number): void => {
    for (const [id, when] of reserved) if (at - when >= minIntervalMs) reserved.delete(id);
  };

  const failure = (error: unknown): UpdateRequestResponse =>
    ({ ok: false, code: isHostError(error) && error.code === "NOT_GRANTED" ? "not-granted" : "host-refused" });

  return {
    async request(sessionId) {
      if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, code: "invalid-session" };
      const at = now();
      prune(at);
      if (reserved.has(sessionId)) return { ok: false, code: "too-soon" };
      reserved.set(sessionId, at);
      try {
        const { status } = await host.status(sessionId);
        if (status !== "idle") {
          reserved.delete(sessionId);
          return { ok: false, code: status === "waiting" ? "waiting" : "busy" };
        }
        await host.send(sessionId, UPDATE_REQUEST_TEXT);
        return { ok: true };
      } catch (error) {
        reserved.delete(sessionId);
        return failure(error);
      }
    },
  };
}
