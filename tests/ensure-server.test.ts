import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSse, startBridge } from "../service/bridge.ts";
import { ensureServer, type EnsureDeps } from "../service/ensure-server.ts";
import type { CanvasEvent, HealthResponse } from "../src/shared/contract.ts";

/** Servidor falso: `version` null = fora do ar. `shutdown` derruba; `spawn` sobe na versão dada. */
function fake(initial: number | null, spawnsAs = 4) {
  const state = { version: initial, spawns: 0, shutdowns: [] as number[] };
  const deps: EnsureDeps = {
    health: async (): Promise<HealthResponse | null> => (state.version === null ? null : { ok: true, version: state.version }),
    shutdownBelow: async (v) => {
      state.shutdowns.push(v);
      if (state.version !== null && state.version < v) state.version = null;
    },
    spawnServer: () => {
      state.spawns += 1;
      state.version = spawnsAs;
    },
    sleep: async () => {},
  };
  return { state, deps };
}

describe("ensureServer", () => {
  it("reusa servidor de versão igual ou maior, sem spawn nem shutdown", async () => {
    for (const v of [4, 5]) {
      const { state, deps } = fake(v);
      assert.equal(await ensureServer(deps, 4), "reused");
      assert.equal(state.spawns, 0);
      assert.deepEqual(state.shutdowns, []);
    }
  });

  it("sobe um servidor quando não há nenhum", async () => {
    const { state, deps } = fake(null);
    assert.equal(await ensureServer(deps, 4), "started");
    assert.equal(state.spawns, 1);
  });

  it("troca o servidor de versão menor: shutdown e depois spawn", async () => {
    const { state, deps } = fake(3);
    assert.equal(await ensureServer(deps, 4), "replaced");
    assert.deepEqual(state.shutdowns, [4]);
    assert.equal(state.spawns, 1);
    assert.equal(state.version, 4);
  });

  it("se outro serviço já trocou durante a espera, não sobe um segundo", async () => {
    const { state, deps } = fake(3);
    deps.shutdownBelow = async () => {
      state.version = 4;
    };
    assert.equal(await ensureServer(deps, 4), "replaced");
    assert.equal(state.spawns, 0);
  });

  it("falha se o servidor antigo não encerra ou o novo não sobe", async () => {
    const stuck = fake(3);
    stuck.deps.shutdownBelow = async () => {};
    await assert.rejects(ensureServer(stuck.deps, 4), /não encerrou/);
    const dead = fake(null);
    dead.deps.spawnServer = () => {};
    await assert.rejects(ensureServer(dead.deps, 4), /não subiu/);
  });
});

describe("parseSse", () => {
  it("lê quadros completos, guarda o resto e ignora lixo", () => {
    const text = ': ping\n\ndata: {"rootId":"ses_a","updatedAt":1}\n\ndata: nao-json\n\ndata: {"rootId":"../x","updatedAt":1}\n\ndata: {"rootId":"ses_b"';
    const { events, rest } = parseSse(text);
    assert.deepEqual(events, [{ rootId: "ses_a", updatedAt: 1 }]);
    assert.equal(rest, 'data: {"rootId":"ses_b"');
  });
});

describe("startBridge", () => {
  it("repassa eventos, reconecta com backoff e para no stop", async () => {
    const frames = ['data: {"rootId":"ses_a","updatedAt":1}\n\n', 'data: {"rootId":"ses_a","updatedAt":2}\n\n'];
    let calls = 0;
    const seen: CanvasEvent[] = [];
    const sleeps: number[] = [];
    let bridge: { stop: () => void } = { stop() {} };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      assert.equal((init.headers as Record<string, string>).authorization, "Bearer tok");
      calls += 1;
      if (calls === 1) throw new Error("servidor fora");
      const chunk = new TextEncoder().encode(frames[calls - 2] ?? "");
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(chunk), c.close()) }));
    }) as unknown as typeof fetch;
    const done = new Promise<void>((resolve) => {
      bridge = startBridge({
        url: "http://x/events",
        token: async () => "tok",
        onEvent: (e) => {
          seen.push(e);
          if (seen.length === 2) {
            bridge.stop();
            resolve();
          }
        },
        fetchImpl,
        sleep: async (ms) => void sleeps.push(ms),
      });
    });
    await done;
    assert.deepEqual(seen.map((e) => e.updatedAt), [1, 2]);
    assert.deepEqual(sleeps.slice(0, 2), [500, 500]); // conexão bem-sucedida zera o backoff
  });
});
