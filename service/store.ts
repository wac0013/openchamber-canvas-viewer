// Persistência do canvas: um arquivo por sessão em `<dados da extensão>/canvases/`.
// Só a última versão válida (RN1/RN2). Excluir a sessão apaga o arquivo (CA9).

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateTree } from "../src/canvas/sanitize.ts";
import { buildSnapshot } from "../src/canvas/snapshot.ts";
import { BLOCKED_NOTES_MAX, SESSION_ID_PATTERN, type CanvasRecord } from "../src/shared/contract.ts";

export type Store = {
  read(sessionId: string): Promise<CanvasRecord | null>;
  remove(sessionId: string): Promise<void>;
  publish(sessionId: string, title: unknown, html: unknown, now: number): Promise<CanvasRecord>;
};

export function createStore(dataDir: string): Store {
  const dir = path.join(dataDir, "canvases");
  const fileOf = (sessionId: string): string => {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("id de sessão inválido");
    return path.join(dir, `${sessionId}.json`);
  };

  const read = async (sessionId: string): Promise<CanvasRecord | null> => {
    const file = fileOf(sessionId); // id inválido lança, como em publish/remove
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
        // Arquivo em disco também é entrada não confiável: revalida a árvore.
        const tree = validateTree(canvas.tree);
        if (!tree || typeof canvas.updatedAt !== "number" || typeof canvas.title !== "string") return null;
        const blocked = Array.isArray(canvas.blocked) ? canvas.blocked.filter((n): n is string => typeof n === "string").slice(0, BLOCKED_NOTES_MAX) : [];
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
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(record), "utf8");
    await rename(tmp, target);
  };

  return {
    read,
    async remove(sessionId) {
      await rm(fileOf(sessionId), { force: true });
    },
    async publish(sessionId, title, html, now) {
      const previous = await read(sessionId);
      const built = buildSnapshot(title, html, now);
      // RN4: publicação recusada não substitui o canvas vigente; só registra o erro.
      const record: CanvasRecord = built.ok
        ? { sessionId, canvas: built.snapshot, error: null }
        : { sessionId, canvas: previous?.canvas ?? null, error: { at: now, message: built.message } };
      await write(record);
      return record;
    },
  };
}

function readError(value: unknown): CanvasRecord["error"] {
  if (typeof value !== "object" || value === null) return null;
  const error = value as { at?: unknown; message?: unknown };
  return typeof error.at === "number" && typeof error.message === "string" ? { at: error.at, message: error.message.slice(0, 300) } : null;
}
