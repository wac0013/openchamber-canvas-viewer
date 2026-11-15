// Esvazia a caixa de entrada: cada `<sessionId>.json` depositado pelo plugin vira o canvas
// da sessão. O arquivo é entrada não confiável: tamanho, JSON, versão e id são conferidos,
// e o HTML passa de novo pelo sanitizador (a validação do plugin é só cortesia ao agente).

import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { INBOX_SCHEMA_VERSION, LIMITS } from "../src/shared/contract.ts";
import type { Store } from "./store.ts";

const FILE_NAME = /^([A-Za-z0-9_-]{1,128})\.json$/;
/** HTML no limite + margem do envelope JSON (escapes podem dobrar o tamanho). */
const MAX_FILE_BYTES = LIMITS.htmlChars * 4 + 4096;

/** Processa tudo o que está na caixa; devolve as sessões cujo canvas mudou. */
export async function drainInbox(inbox: string, store: Store, now: () => number): Promise<string[]> {
  await mkdir(inbox, { recursive: true });
  const changed: string[] = [];
  for (const name of await readdir(inbox)) {
    const match = FILE_NAME.exec(name);
    if (!match) continue; // .tmp em escrita e qualquer outro nome são ignorados
    const sessionId = match[1]!;
    const file = path.join(inbox, name);
    try {
      const size = (await stat(file)).size;
      let title: unknown = "";
      let html: unknown = null;
      if (size > MAX_FILE_BYTES) {
        html = null; // vira "html deve ser texto": recusado sem ler o arquivo
      } else {
        try {
          const payload = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
          if (payload.v === INBOX_SCHEMA_VERSION && payload.sessionId === sessionId) {
            title = payload.title;
            html = payload.html;
          }
        } catch {
          html = null;
        }
      }
      await store.publish(sessionId, title, html, now());
      changed.push(sessionId);
    } finally {
      await rm(file, { force: true });
    }
  }
  return changed;
}
