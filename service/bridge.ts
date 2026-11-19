// Ponte servidor → painel: assina o SSE do servidor único e repassa cada mudança como evento do host.
// Reconecta com backoff; o servidor pode reiniciar (troca de versão) sem derrubar o serviço.

import { SESSION_ID_PATTERN, type CanvasEvent } from "../src/shared/contract.ts";

/** Lê os quadros `data: {...}` de um pedaço de texto SSE; devolve os eventos válidos e o resto incompleto. */
export function parseSse(buffer: string): { events: CanvasEvent[]; rest: string } {
  const events: CanvasEvent[] = [];
  const cut = buffer.lastIndexOf("\n\n");
  if (cut < 0) return { events, rest: buffer };
  for (const frame of buffer.slice(0, cut).split("\n\n")) {
    if (!frame.startsWith("data: ")) continue;
    try {
      const data: unknown = JSON.parse(frame.slice(6));
      if (!data || typeof data !== "object") continue;
      const { rootId, updatedAt } = data as { rootId?: unknown; updatedAt?: unknown };
      if (typeof rootId === "string" && SESSION_ID_PATTERN.test(rootId) && typeof updatedAt === "number") events.push({ rootId, updatedAt });
    } catch {
      // quadro corrompido: ignora
    }
  }
  return { events, rest: buffer.slice(cut + 2) };
}

export type BridgeOptions = {
  url: string;
  token: () => Promise<string | null>;
  /** Chamado com cada evento válido. */
  onEvent: (event: CanvasEvent) => void;
  /** Chamado antes de cada tentativa de conexão (ex.: garantir o servidor no ar). */
  beforeConnect?: () => Promise<void>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type Bridge = { stop: () => void };

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 10_000;

export function startBridge(options: BridgeOptions): Bridge {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const controller = new AbortController();

  const run = async (): Promise<void> => {
    let delay = BACKOFF_MIN_MS;
    while (!controller.signal.aborted) {
      try {
        await options.beforeConnect?.();
        const token = await options.token();
        if (!token) throw new Error("sem token");
        const response = await doFetch(options.url, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        delay = BACKOFF_MIN_MS;
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) options.onEvent(event);
        }
      } catch {
        // cai no backoff
      }
      if (controller.signal.aborted) return;
      await sleep(delay);
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    }
  };
  void run();
  return { stop: () => controller.abort() };
}
