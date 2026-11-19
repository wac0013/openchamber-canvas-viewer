import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { tokenFile } from "../src/shared/paths.ts";
import { ensureToken, isValidToken, readToken, sameToken } from "../src/shared/token.ts";

let home = "";
let env: Record<string, string> = {};

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "ocv-token-"));
  env = { OPENCHAMBER_CANVAS_HOME: home };
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("token", () => {
  it("cria o token 0600 na primeira vez e reusa nas seguintes", async () => {
    const first = await ensureToken(env);
    const second = await ensureToken(env);
    assert.equal(first, second);
    assert.ok(isValidToken(first));
    assert.equal((await stat(tokenFile(env))).mode & 0o777, 0o600);
    assert.equal(await readToken(env), first);
  });

  it("readToken devolve null sem arquivo ou com conteúdo corrompido", async () => {
    assert.equal(await readToken(env), null);
    await writeFile(tokenFile(env), "curto\n");
    assert.equal(await readToken(env), null);
  });

  it("arquivo corrompido existente: ensureToken o substitui por um token válido", async () => {
    await writeFile(tokenFile(env), "lixo\n");
    const token = await ensureToken(env);
    assert.ok(isValidToken(token));
    assert.equal((await readFile(tokenFile(env), "utf8")).trim(), token);
  });

  it("cria a pasta de dados (0700) quando ela ainda não existe", async () => {
    const nested = { OPENCHAMBER_CANVAS_HOME: path.join(home, "a", "b") };
    const token = await ensureToken(nested);
    assert.ok(isValidToken(token));
    assert.equal((await stat(path.join(home, "a", "b"))).mode & 0o777, 0o700);
  });

  it("processos simultâneos convergem para o mesmo token", async () => {
    const tokens = await Promise.all(Array.from({ length: 8 }, () => ensureToken(env)));
    assert.equal(new Set(tokens).size, 1);
  });
});

describe("sameToken", () => {
  it("compara em tempo constante e rejeita tamanhos diferentes", () => {
    assert.equal(sameToken("abc", "abc"), true);
    assert.equal(sameToken("abc", "abd"), false);
    assert.equal(sameToken("abc", "abcd"), false);
    assert.equal(sameToken("", "abc"), false);
  });
});
