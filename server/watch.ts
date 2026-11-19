// Vigia a pasta `sessions/` e avisa quando o canvas de uma sessão muda.
// Cobre os dois jeitos de escrever: o plugin (arquivo temporário + rename) e o Write/Edit do agente.
// O aviso só sai depois que o arquivo estabiliza (tamanho igual entre duas leituras), para o painel
// nunca receber um HTML pela metade.

import { watch, type FSWatcher } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { SESSION_ID_PATTERN } from "../src/shared/contract.ts";

export type Watcher = { close(): void };

export type WatchOptions = {
  /** Espera depois do último evento de uma sessão antes de conferir. */
  debounceMs?: number;
  /** Intervalo entre as duas leituras de tamanho. */
  settleMs?: number;
};

/** `<rootId>/index.html` (ou meta.json, ou o temporário) → rootId; qualquer outra coisa → null. */
export function rootIdOf(relative: string): string | null {
  const parts = relative.split(path.sep).filter(Boolean);
  const id = parts[0];
  return id && SESSION_ID_PATTERN.test(id) ? id : null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return -1;
  }
}

export async function watchSessions(sessionsDir: string, onChange: (rootId: string) => void, options: WatchOptions = {}): Promise<Watcher> {
  const debounceMs = options.debounceMs ?? 30;
  const settleMs = options.settleMs ?? 10;
  await mkdir(sessionsDir, { recursive: true, mode: 0o700 });

  const timers = new Map<string, NodeJS.Timeout>();
  /** Conta os eventos por sessão: se chegar outro durante a conferência, quem avisa é o novo timer. */
  const seen = new Map<string, number>();
  let closed = false;

  const flush = async (rootId: string, generation: number): Promise<void> => {
    const file = path.join(sessionsDir, rootId, "index.html");
    let size = await sizeOf(file);
    for (let i = 0; i < 20; i += 1) {
      await sleep(settleMs);
      const next = await sizeOf(file);
      if (next === size) break;
      size = next;
    }
    if (!closed && seen.get(rootId) === generation) onChange(rootId);
  };

  const watcher: FSWatcher = watch(sessionsDir, { recursive: true }, (_event, filename) => {
    if (closed || !filename) return;
    const rootId = rootIdOf(String(filename));
    if (!rootId) return;
    const generation = (seen.get(rootId) ?? 0) + 1;
    seen.set(rootId, generation);
    const previous = timers.get(rootId);
    if (previous) clearTimeout(previous);
    timers.set(
      rootId,
      setTimeout(() => {
        timers.delete(rootId);
        void flush(rootId, generation);
      }, debounceMs),
    );
  });
  watcher.on("error", () => {});

  return {
    close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      seen.clear();
      watcher.close();
    },
  };
}
