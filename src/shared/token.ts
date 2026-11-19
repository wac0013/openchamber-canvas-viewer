// Segredo de acesso ao servidor único: um arquivo 0600 na pasta de dados (pasta 0700).
// O servidor cria; o serviço da extensão lê. Nunca vai para log nem para o repositório.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

import { canvasHome, tokenFile } from "./paths.ts";

type Env = Record<string, string | undefined>;

/** 32 bytes em base64url (43 caracteres). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** Lê o token existente; `null` se ainda não houver (ou se o arquivo estiver corrompido). */
export async function readToken(env: Env = process.env): Promise<string | null> {
  try {
    const value = (await readFile(tokenFile(env), "utf8")).trim();
    return isValidToken(value) ? value : null;
  } catch {
    return null;
  }
}

/** Devolve o token, criando-o (0600) na primeira vez. Dois processos simultâneos convergem pelo `wx`. */
export async function ensureToken(env: Env = process.env): Promise<string> {
  const existing = await readToken(env);
  if (existing) return existing;
  await mkdir(canvasHome(env), { recursive: true, mode: 0o700 });
  const fresh = randomBytes(32).toString("base64url");
  // Conteúdo completo num temporário e `link` (atômico e exclusivo): ninguém lê o token pela metade.
  const temp = `${tokenFile(env)}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await writeFile(temp, `${fresh}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await link(temp, tokenFile(env));
    return fresh;
  } catch {
    // Outro processo criou primeiro: usa o dele; arquivo corrompido é substituído.
    const winner = await readToken(env);
    if (winner) return winner;
    await rename(temp, tokenFile(env));
    return fresh;
  } finally {
    await unlink(temp).catch(() => {});
  }
}

/** Comparação em tempo constante. */
export function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
