// Caminhos em disco, comuns ao plugin, ao servidor único e ao serviço da extensão.
// Independem da instância do OpenChamber: é isso que acaba com a disputa da caixa de entrada.

import os from "node:os";
import path from "node:path";

import { SESSION_ID_PATTERN } from "./contract.ts";

type Env = Record<string, string | undefined>;

/** Raiz dos dados: `OPENCHAMBER_CANVAS_HOME` (testes e override), senão `$XDG_DATA_HOME/openchamber-canvas`. */
export function canvasHome(env: Env = process.env): string {
  if (env.OPENCHAMBER_CANVAS_HOME) return env.OPENCHAMBER_CANVAS_HOME;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "openchamber-canvas");
}

function safeId(id: string): string {
  if (!SESSION_ID_PATTERN.test(id)) throw new Error("id de sessão inválido");
  return id;
}

export function sessionsDir(env: Env = process.env): string {
  return path.join(canvasHome(env), "sessions");
}

export function aliasesDir(env: Env = process.env): string {
  return path.join(canvasHome(env), "aliases");
}

/** Pasta do canvas de uma sessão raiz. */
export function sessionDir(rootId: string, env: Env = process.env): string {
  return path.join(sessionsDir(env), safeId(rootId));
}

/** O HTML livre do canvas: é o arquivo que o agente também pode editar com Write/Edit. */
export function canvasFile(rootId: string, env: Env = process.env): string {
  return path.join(sessionDir(rootId, env), "index.html");
}

export function metaFile(rootId: string, env: Env = process.env): string {
  return path.join(sessionDir(rootId, env), "meta.json");
}

/** Alias subagente → raiz: o conteúdo do arquivo é o id da raiz. */
export function aliasFile(sessionId: string, env: Env = process.env): string {
  return path.join(aliasesDir(env), safeId(sessionId));
}

/** `{ pid, port, version }` do servidor no ar. */
export function serverFile(env: Env = process.env): string {
  return path.join(canvasHome(env), "server.json");
}

/** Segredo de acesso ao servidor (navegador e serviços). */
export function tokenFile(env: Env = process.env): string {
  return path.join(canvasHome(env), "token");
}
