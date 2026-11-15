/**
 * Lado do painel do botão Atualizar: pede ao serviço que mande ao agente o pedido de atualização
 * para a sessão dona do canvas exibido. O painel só informa o id da sessão; o texto da mensagem
 * é fixo e vive no serviço.
 */

import type { GuestRequest, GuestRequestResult } from "@openchamber/sdk";

import type { UpdateRequestCode, UpdateRequestResponse } from "../shared/contract.ts";

export type UpdateHost = {
  serviceRequest(request: GuestRequest): Promise<GuestRequestResult>;
};

export type UpdateFailure = UpdateRequestCode | "service-outdated" | "unavailable";

export type UpdateResult = { ok: true } | { ok: false; reason: UpdateFailure };

export const UPDATE_MESSAGES: Record<UpdateFailure, { kind: "info" | "error"; message: string }> = {
  busy: { kind: "info", message: "O agente já está trabalhando. O canvas é atualizado quando ele publicar." },
  waiting: { kind: "info", message: "O agente está esperando uma resposta sua. Responda e, se precisar, peça de novo." },
  "too-soon": { kind: "info", message: "O pedido acabou de ser enviado. Aguarde alguns segundos." },
  "not-granted": { kind: "error", message: "Reaprove a extensão em Settings → Extensions: ela agora precisa da permissão de controle de sessão." },
  "service-outdated": { kind: "error", message: "O serviço da extensão está desatualizado: pause e retome a extensão em Settings → Extensions." },
  "host-refused": { kind: "error", message: "O OpenChamber recusou o pedido. Tente de novo." },
  "invalid-session": { kind: "error", message: "Sessão inválida. Reabra a sessão e tente de novo." },
  unavailable: { kind: "error", message: "Não foi possível falar com o serviço da extensão." },
};

export const UPDATE_SENT_MESSAGE = "Pedido de atualização enviado ao agente.";

const CODES: ReadonlySet<string> = new Set(["busy", "waiting", "too-soon", "not-granted", "host-refused", "invalid-session"]);

function parse(body: string): UpdateRequestResponse | null {
  try {
    const value = JSON.parse(body) as { ok?: unknown; code?: unknown };
    if (value.ok === true) return { ok: true };
    if (value.ok === false && typeof value.code === "string" && CODES.has(value.code)) return { ok: false, code: value.code as UpdateRequestCode };
  } catch {
    return null;
  }
  return null;
}

/** `sessionId` é a sessão dona do canvas exibido, entregue de forma explícita ao serviço. */
export async function requestCanvasUpdate(host: UpdateHost, sessionId: string): Promise<UpdateResult> {
  let result: GuestRequestResult;
  try {
    result = await host.serviceRequest({ method: "POST", path: "/update-request", body: JSON.stringify({ sessionId }) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (result.status === 404) return { ok: false, reason: "service-outdated" };
  const parsed = parse(result.body);
  if (parsed?.ok) return { ok: true };
  if (parsed) return { ok: false, reason: parsed.code };
  return { ok: false, reason: "unavailable" };
}
