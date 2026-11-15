/**
 * Esvazia a caixa de entrada: cada `<sessionId>.json` depositado pelo plugin vira o canvas
 * da sessão. O arquivo é entrada não confiável: tipo, tamanho, JSON, versão e id são conferidos
 * e o HTML passa de novo pelo sanitizador (a validação do plugin é só cortesia ao agente).
 *
 * O arquivo é "reivindicado" por rename atômico para `<nome>.<uuid>.proc` antes de ser lido:
 * uma versão nova que o plugin deposite durante o processamento não é apagada, e uma falha
 * de I/O devolve o arquivo à caixa (sem sobrescrever versão mais nova) para nova tentativa.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { INBOX_SCHEMA_VERSION, LIMITS, SESSION_ID_PATTERN } from "../src/shared/contract.ts";
import type { Store } from "./store.ts";

const FILE_NAME = /^([A-Za-z0-9_-]{1,128})\.json$/;
const CLAIMED_NAME = /^([A-Za-z0-9_-]{1,128})\.json\.[0-9a-f-]{36}\.proc$/;
/** HTML no limite com o pior escape de JSON (surrogate solto = 6 bytes) + margem do envelope. */
const MAX_FILE_BYTES = LIMITS.htmlChars * 6 + 4096;
/** Reivindicação abandonada (processo morreu no meio) é descartada depois deste tempo. */
const STALE_CLAIM_MS = 60_000;

export type DrainOptions = {
  onError?: (sessionId: string, error: unknown) => void;
};

type Payload = { ok: true; title: unknown; html: unknown } | { ok: false; message: string };

async function readPayload(file: string, sessionId: string): Promise<Payload> {
  const info = await lstat(file);
  if (!info.isFile()) return { ok: false, message: "a publicação não é um arquivo comum" };
  if (info.size > MAX_FILE_BYTES) return { ok: false, message: `publicação maior que o limite (${LIMITS.htmlChars} caracteres de HTML)` };
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "a publicação não é um JSON válido" };
  }
  if (typeof payload !== "object" || payload === null) return { ok: false, message: "a publicação não é um objeto" };
  if (payload.v !== INBOX_SCHEMA_VERSION) return { ok: false, message: "versão de publicação não suportada" };
  if (payload.sessionId !== sessionId) return { ok: false, message: "a publicação não pertence a esta sessão" };
  return { ok: true, title: payload.title, html: payload.html };
}

/** Processa tudo o que está na caixa; devolve as sessões cujo registro mudou. */
export async function drainInbox(inbox: string, store: Store, now: () => number, options: DrainOptions = {}): Promise<string[]> {
  await mkdir(inbox, { recursive: true });
  const changed: string[] = [];
  for (const name of await readdir(inbox)) {
    const claimedMatch = CLAIMED_NAME.exec(name);
    if (claimedMatch) {
      await dropStaleClaim(path.join(inbox, name), now());
      continue;
    }
    const match = FILE_NAME.exec(name);
    if (!match) continue;
    const sessionId = match[1]!;
    const file = path.join(inbox, name);
    const claimed = `${file}.${randomUUID()}.proc`;
    const generation = store.generation(sessionId);
    try {
      await rename(file, claimed);
    } catch {
      continue;
    }
    try {
      const payload = await readPayload(claimed, sessionId);
      const record = payload.ok
        ? await store.publish(sessionId, payload.title, payload.html, now(), { expectedGeneration: generation })
        : await store.reject(sessionId, payload.message, now(), { expectedGeneration: generation });
      if (record) changed.push(sessionId);
      await rm(claimed, { force: true });
    } catch (error) {
      options.onError?.(sessionId, error);
      await giveBack(claimed, file);
    }
  }
  return changed;
}

/** Devolve a publicação à caixa para nova tentativa, a menos que o plugin já tenha depositado uma mais nova. */
async function giveBack(claimed: string, file: string): Promise<void> {
  try {
    await lstat(file);
    await rm(claimed, { force: true });
  } catch {
    await rename(claimed, file).catch(() => rm(claimed, { force: true }));
  }
}

async function dropStaleClaim(claimed: string, now: number): Promise<void> {
  try {
    const info = await lstat(claimed);
    if (now - info.mtimeMs > STALE_CLAIM_MS) await rm(claimed, { force: true });
  } catch {
    return;
  }
}

/** Remove publicações pendentes de uma sessão excluída (o arquivo ainda não reivindicado). */
export async function discardPending(inbox: string, sessionId: string): Promise<void> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  await rm(path.join(inbox, `${sessionId}.json`), { force: true });
}
