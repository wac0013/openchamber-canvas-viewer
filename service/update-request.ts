/**
 * Pedido de atualização do canvas: o serviço manda ao agente, em nome do usuário, a mensagem
 * fixa `UPDATE_REQUEST_TEXT`, para a sessão EXPLÍCITA que o painel informou (nunca "a sessão em
 * foco do host": uma troca de sessão no instante do clique não desvia o pedido).
 *
 * Não interrompe o agente: sessão ocupada (`busy`) ou esperando resposta do usuário (`waiting`,
 * onde `sessions.send` fecharia a pergunta pendente) não recebe o pedido. Um pedido por vez por
 * sessão e com intervalo mínimo; a vaga é reservada ANTES de qualquer `await`, então dois cliques
 * simultâneos nunca enviam duas mensagens.
 *
 * Limite conhecido: não há operação atômica "se ocioso, envie" no host. Entre `status` e `send`
 * (milissegundos) a sessão pode ficar ocupada, e a mensagem entra na fila dela, ou passar a
 * esperar uma resposta, e o `send` fecha a pergunta. Se o `send` falha SEM resposta utilizável
 * (timeout, host fora), a mensagem pode ter saído: a vaga continua reservada e o painel avisa que
 * não foi possível confirmar, em vez de convidar a repetir e duplicar.
 */

import { SESSION_ID_PATTERN, UPDATE_MIN_INTERVAL_MS, UPDATE_REQUEST_TEXT, type UpdateRequestCode, type UpdateRequestResponse } from "../src/shared/contract.ts";

export type UpdateHost = {
  status(sessionId: string): Promise<{ status: "idle" | "busy" | "waiting" }>;
  send(sessionId: string, prompt: string): Promise<unknown>;
};

export type UpdateRequester = {
  request(sessionId: string): Promise<UpdateRequestResponse>;
};

type HostFailure = { code?: unknown; status?: unknown };

/** Relógio monotônico: um ajuste do relógio do sistema não prende nem libera as vagas. */
const monotonicNow = (): number => performance.now();

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as HostFailure).code === "string" ? (error as { code: string }).code : "";
}

function statusOf(error: unknown): number {
  return typeof error === "object" && error !== null && typeof (error as HostFailure).status === "number" ? (error as { status: number }).status : 0;
}

/** Recusa definitiva do host (nada foi enviado). `HOST_UNAVAILABLE` e timeouts não entram aqui. */
function refusal(error: unknown): UpdateRequestCode {
  const code = codeOf(error);
  if (code === "NOT_GRANTED" || statusOf(error) === 403) return "not-granted";
  if (code === "SESSION_BUSY") return "busy";
  return "host-refused";
}

/** Sem resposta utilizável: o host pode ter recebido o envio. */
const unconfirmed = (error: unknown): boolean => ["HOST_UNAVAILABLE", "HOST_TIMEOUT"].includes(codeOf(error));

export function createUpdateRequester(host: UpdateHost, now: () => number = monotonicNow, minIntervalMs: number = UPDATE_MIN_INTERVAL_MS): UpdateRequester {
  const reserved = new Map<string, number>();

  const prune = (at: number): void => {
    for (const [id, when] of reserved) if (at - when >= minIntervalMs) reserved.delete(id);
  };

  return {
    async request(sessionId) {
      if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, code: "invalid-session" };
      const at = now();
      prune(at);
      if (reserved.has(sessionId)) return { ok: false, code: "too-soon" };
      reserved.set(sessionId, at);

      let status: "idle" | "busy" | "waiting";
      try {
        status = (await host.status(sessionId)).status;
      } catch (error) {
        reserved.delete(sessionId);
        return { ok: false, code: refusal(error) };
      }
      if (status !== "idle") {
        reserved.delete(sessionId);
        return { ok: false, code: status === "waiting" ? "waiting" : "busy" };
      }

      try {
        await host.send(sessionId, UPDATE_REQUEST_TEXT);
        return { ok: true };
      } catch (error) {
        if (unconfirmed(error)) {
          reserved.set(sessionId, now());
          return { ok: false, code: "unconfirmed" };
        }
        reserved.delete(sessionId);
        return { ok: false, code: refusal(error) };
      }
    },
  };
}
