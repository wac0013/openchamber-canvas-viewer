// Escrita do canvas livre em arquivo (lado do plugin): sessão raiz, publicar e editar.
// O arquivo é a fonte da verdade; o servidor só vigia. Escrita sempre atômica (temporário + rename).

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { LIMITS, SESSION_ID_PATTERN } from "./contract.ts";
import { aliasFile, aliasesDir, canvasFile, metaFile, sessionDir } from "./paths.ts";

type Env = Record<string, string | undefined>;

/** Quantos níveis de subagente o plugin sobe até a raiz. */
export const ROOT_MAX_DEPTH = 8;

export type SessionLookup = (sessionId: string) => Promise<unknown>;

/** O host pode devolver a sessão direto ou embrulhada em `{ data }`; só o `parentID` interessa. */
function parentOf(info: unknown): string | null {
  const record = info && typeof info === "object" ? (info as Record<string, unknown>) : null;
  const inner = record && record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const parent = inner?.parentID;
  return typeof parent === "string" && SESSION_ID_PATTERN.test(parent) ? parent : null;
}

/** Sobe a cadeia `parentID` até a raiz (limite de níveis). Falha de consulta: fica na sessão atual. */
export async function findRoot(sessionId: string, lookup: SessionLookup, cache: Map<string, string>): Promise<string> {
  const chain: string[] = [];
  let current = sessionId;
  let root: string | null = null;
  for (let depth = 0; depth < ROOT_MAX_DEPTH; depth += 1) {
    const known = cache.get(current);
    if (known) {
      root = known;
      break;
    }
    chain.push(current);
    let parent: string | null = null;
    try {
      parent = parentOf(await lookup(current));
    } catch {
      return current;
    }
    if (!parent || chain.includes(parent)) {
      root = current;
      break;
    }
    current = parent;
  }
  root ??= current;
  for (const id of chain) cache.set(id, root);
  return root;
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, target);
}

/** Grava o alias subagente → raiz (só quando são diferentes). */
export async function writeAlias(sessionId: string, rootId: string, env: Env = process.env): Promise<void> {
  if (sessionId === rootId) return;
  await mkdir(aliasesDir(env), { recursive: true, mode: 0o700 });
  await writeAtomic(aliasFile(sessionId, env), rootId);
}

async function readTitle(rootId: string, env: Env): Promise<string> {
  try {
    const meta: unknown = JSON.parse(await readFile(metaFile(rootId, env), "utf8"));
    const title = meta && typeof meta === "object" ? (meta as { title?: unknown }).title : undefined;
    return typeof title === "string" ? title : "";
  } catch {
    return "";
  }
}

export type WriteResult = { ok: true; file: string } | { ok: false; message: string };

/** Grava o HTML inteiro do canvas da raiz (e o título, se vier). Recusa vazio e acima de 1 MB. */
export async function writeCanvas(rootId: string, html: string, title: string | undefined, env: Env = process.env): Promise<WriteResult> {
  if (!html.trim()) return { ok: false, message: "html vazio" };
  if (Buffer.byteLength(html, "utf8") > LIMITS.canvasBytes) return { ok: false, message: `canvas maior que o limite (${LIMITS.canvasBytes} bytes)` };
  await mkdir(sessionDir(rootId, env), { recursive: true, mode: 0o700 });
  const cleanTitle = (title ?? (await readTitle(rootId, env))).slice(0, LIMITS.titleChars);
  await writeAtomic(metaFile(rootId, env), JSON.stringify({ title: cleanTitle, rootId, updatedAt: Date.now() }));
  const file = canvasFile(rootId, env);
  await writeAtomic(file, html);
  return { ok: true, file };
}

/** Troca **uma** ocorrência exata de `find` por `replace`; falha com zero ou várias. */
export async function editCanvas(rootId: string, find: string, replace: string, title: string | undefined, env: Env = process.env): Promise<WriteResult> {
  if (!find) return { ok: false, message: "`find` vazio" };
  let current: string;
  try {
    current = await readFile(canvasFile(rootId, env), "utf8");
  } catch {
    return { ok: false, message: "ainda não há canvas nesta conversa; use canvas_publish primeiro" };
  }
  const count = current.split(find).length - 1;
  if (count === 0) return { ok: false, message: "trecho `find` não encontrado no canvas" };
  if (count > 1) return { ok: false, message: `trecho \`find\` aparece ${count} vezes; inclua mais contexto para ele ser único` };
  return writeCanvas(rootId, current.replace(find, () => replace), title, env);
}
