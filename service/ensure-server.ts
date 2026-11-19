// Garante que o servidor único esteja no ar e na versão certa. Chamado pelo serviço de cada instância
// do OpenChamber; várias podem chamar ao mesmo tempo: quem manda é a porta (o segundo servidor sai).

import { spawn } from "node:child_process";

import { SERVER_PORT, type HealthResponse } from "../src/shared/contract.ts";

export type EnsureDeps = {
  /** `null` se não houver servidor respondendo. */
  health: () => Promise<HealthResponse | null>;
  /** Pede que um servidor mais antigo que `version` se encerre. */
  shutdownBelow: (version: number) => Promise<void>;
  spawnServer: () => void;
  sleep: (ms: number) => Promise<void>;
};

export type EnsureResult = "reused" | "started" | "replaced";

const WAIT_STEP_MS = 50;
const WAIT_STEPS = 100;

async function waitFor(deps: EnsureDeps, done: (health: HealthResponse | null) => boolean): Promise<boolean> {
  for (let i = 0; i < WAIT_STEPS; i += 1) {
    if (done(await deps.health())) return true;
    await deps.sleep(WAIT_STEP_MS);
  }
  return false;
}

/** Reusa servidor de versão igual ou maior; troca o mais antigo; sobe um se não houver. */
export async function ensureServer(deps: EnsureDeps, version: number): Promise<EnsureResult> {
  const current = await deps.health();
  if (current && current.version >= version) return "reused";

  if (current) {
    await deps.shutdownBelow(version);
    if (!(await waitFor(deps, (h) => h === null || h.version >= version))) throw new Error("servidor antigo não encerrou");
    // Outro serviço pode ter feito a troca antes: se já há um servidor compatível, acabou.
    const now = await deps.health();
    if (now && now.version >= version) return "replaced";
  }

  deps.spawnServer();
  if (!(await waitFor(deps, (h) => h !== null && h.version >= version))) throw new Error("servidor não subiu");
  return current ? "replaced" : "started";
}

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Dependências reais: HTTP no loopback e `spawn` destacado do `server/main.js`. */
export function realDeps(options: { serverScript: string; token: () => Promise<string | null>; port?: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv }): EnsureDeps {
  const port = options.port ?? SERVER_PORT;
  const doFetch = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  return {
    async health() {
      try {
        const response = await doFetch(`${baseUrl(port)}/health`, { signal: AbortSignal.timeout(1000) });
        const body: unknown = await response.json();
        if (response.ok && body && typeof body === "object" && (body as { ok?: unknown }).ok === true && typeof (body as { version?: unknown }).version === "number") {
          return body as HealthResponse;
        }
      } catch {
        // sem servidor
      }
      return null;
    },
    async shutdownBelow(version) {
      const token = await options.token();
      if (!token) return;
      await doFetch(`${baseUrl(port)}/shutdown?below=${version}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) }).catch(() => {});
    },
    spawnServer() {
      // Ambiente mínimo: o servidor não precisa dos segredos do serviço da extensão.
      const passthrough = ["PATH", "HOME", "XDG_DATA_HOME", "OPENCHAMBER_CANVAS_HOME", "OPENCHAMBER_CANVAS_PORT", "OPENCHAMBER_CANVAS_HOST", "OPENCHAMBER_CANVAS_IDLE_MS"];
      // O host roda o serviço com o binário do Electron em modo Node; o filho herda o mesmo executável.
      const childEnv: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
      for (const key of passthrough) {
        const value = env[key];
        if (value !== undefined) childEnv[key] = value;
      }
      spawn(process.execPath, [options.serverScript], { detached: true, stdio: "ignore", env: childEnv }).unref();
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
