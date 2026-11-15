// Caixa de entrada compartilhada entre o plugin (roda dentro do OpenCode) e o serviço
// (roda no host). Os dois são processos Node do mesmo usuário e não se conhecem por porta,
// então combinam um diretório fixo. `OPENCHAMBER_CANVAS_INBOX` sobrescreve (testes/ambientes).

import os from "node:os";
import path from "node:path";

import { SESSION_ID_PATTERN } from "../src/shared/contract.ts";

export function inboxDir(env: Record<string, string | undefined> = process.env): string {
  if (env.OPENCHAMBER_CANVAS_INBOX) return env.OPENCHAMBER_CANVAS_INBOX;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "openchamber", "canvas-viewer", "inbox");
}

/** Caminho do arquivo de publicação de uma sessão; recusa ids que não sejam nome de arquivo seguro. */
export function inboxFile(sessionId: string, env: Record<string, string | undefined> = process.env): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("id de sessão inválido");
  return path.join(inboxDir(env), `${sessionId}.json`);
}
