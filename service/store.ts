/**
 * Persistência do canvas: um arquivo por sessão em `<dados da extensão>/canvases/`.
 * Só a última versão válida (RN1/RN2). Excluir a sessão apaga o arquivo (CA9).
 *
 * Toda escrita e remoção de uma sessão passa por uma fila por sessão, e cada remoção
 * incrementa a "geração" da sessão: uma publicação que começou antes da exclusão e termina
 * depois é descartada (não ressuscita o canvas de uma sessão apagada).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateTree } from "../src/canvas/sanitize.ts";
import { buildSnapshot } from "../src/canvas/snapshot.ts";
import { BLOCKED_NOTES_MAX, SESSION_ID_PATTERN, type CanvasRecord } from "../src/shared/contract.ts";

export type PublishOptions = {
  /** Geração lida antes de começar; se a sessão foi excluída desde então, a publicação é descartada. */
  expectedGeneration?: number;
};

export type Store = {
  read(sessionId: string): Promise<CanvasRecord | null>;
  remove(sessionId: string): Promise<void>;
  /** Devolve `null` quando a publicação foi descartada por exclusão concorrente da sessão. */
  publish(sessionId: string, title: unknown, html: unknown, now: number, options?: PublishOptions): Promise<CanvasRecord | null>;
  /** Registra uma publicação recusada sem tocar no canvas vigente. */
  reject(sessionId: string, message: string, now: number, options?: PublishOptions): Promise<CanvasRecord | null>;
  generation(sessionId: string): number;
};

export function createStore(dataDir: string): Store {
  const dir = path.join(dataDir, "canvases");
  const generations = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();

  const fileOf = (sessionId: string): string => {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("id de sessão inválido");
    return path.join(dir, `${sessionId}.json`);
  };

  const generation = (sessionId: string): number => generations.get(sessionId) ?? 0;

  /** Serializa as operações de uma mesma sessão; sessões diferentes seguem em paralelo. */
  const locked = <T>(sessionId: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    queues.set(sessionId, tail);
    void tail.then(() => {
      if (queues.get(sessionId) === tail) queues.delete(sessionId);
    });
    return run;
  };

  const readFileRecord = async (sessionId: string): Promise<CanvasRecord | null> => {
    const file = fileOf(sessionId);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      return null;
    }
    try {
      const value = JSON.parse(raw) as Partial<CanvasRecord>;
      const canvas = value.canvas;
      if (canvas) {
        const tree = validateTree(canvas.tree);
        if (!tree || typeof canvas.updatedAt !== "number" || typeof canvas.title !== "string") return null;
        const blocked = Array.isArray(canvas.blocked) ? canvas.blocked.filter((note): note is string => typeof note === "string").slice(0, BLOCKED_NOTES_MAX) : [];
        return { sessionId, canvas: { title: canvas.title, updatedAt: canvas.updatedAt, tree, blocked }, error: readError(value.error) };
      }
      return { sessionId, canvas: null, error: readError(value.error) };
    } catch {
      return null;
    }
  };

  const write = async (record: CanvasRecord): Promise<void> => {
    await mkdir(dir, { recursive: true });
    const target = fileOf(record.sessionId);
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(record), "utf8");
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  };

  const outdated = (sessionId: string, options?: PublishOptions): boolean =>
    options?.expectedGeneration !== undefined && options.expectedGeneration !== generation(sessionId);

  return {
    generation,
    read: async (sessionId) => {
      fileOf(sessionId);
      return locked(sessionId, () => readFileRecord(sessionId));
    },
    remove: async (sessionId) => {
      fileOf(sessionId);
      return locked(sessionId, async () => {
        generations.set(sessionId, generation(sessionId) + 1);
        await rm(fileOf(sessionId), { force: true });
      });
    },
    publish: async (sessionId, title, html, now, options) => {
      fileOf(sessionId);
      return locked(sessionId, async () => {
        if (outdated(sessionId, options)) return null;
        const built = buildSnapshot(title, html, now);
        if (!built.ok) return rejectLocked(sessionId, built.message, now);
        const record: CanvasRecord = { sessionId, canvas: built.snapshot, error: null };
        await write(record);
        return record;
      });
    },
    reject: async (sessionId, message, now, options) => {
      fileOf(sessionId);
      return locked(sessionId, async () => (outdated(sessionId, options) ? null : rejectLocked(sessionId, message, now)));
    },
  };

  /** RN4: recusa não substitui o canvas vigente; só registra o erro. */
  async function rejectLocked(sessionId: string, message: string, now: number): Promise<CanvasRecord> {
    const previous = await readFileRecord(sessionId);
    const record: CanvasRecord = { sessionId, canvas: previous?.canvas ?? null, error: { at: now, message: message.slice(0, 300) } };
    await write(record);
    return record;
  }
}

function readError(value: unknown): CanvasRecord["error"] {
  if (typeof value !== "object" || value === null) return null;
  const error = value as { at?: unknown; message?: unknown };
  return typeof error.at === "number" && typeof error.message === "string" ? { at: error.at, message: error.message.slice(0, 300) } : null;
}
