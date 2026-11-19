// src/shared/contract.ts
var LIMITS = {
  titleChars: 120,
  /** Tamanho máximo do arquivo de canvas livre, em bytes (1 MB). */
  canvasBytes: 1e6,
  /** Quantidade de itens marcáveis (`data-canvas-item`) lidos do canvas. */
  items: 200,
  /** Texto máximo de um item marcável (limite do `host.attach`). */
  itemTextChars: 16e3,
  /** Texto máximo do canvas inteiro que o runtime devolve ao painel. */
  canvasTextChars: 2e5,
  /** Tamanho máximo de um link (`href`). */
  hrefChars: 2048,
  /** Filtros ativos e itens removidos guardados por canvas. */
  filters: 20
};
var SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
var UPDATE_REQUEST_MARKER = "[Painel Canvas \xB7 Atualizar]";
var UPDATE_REQUEST_TEXT = `${UPDATE_REQUEST_MARKER} Atualize agora o canvas desta conversa: publique de novo com canvas_publish, refletindo o estado atual do trabalho e mantendo os mesmos ids de elemento. N\xE3o repita a visualiza\xE7\xE3o no chat; responda s\xF3 com um resumo curto do que mudou.`;

// src/shared/canvas-files.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

// src/shared/paths.ts
import os from "node:os";
import path from "node:path";
function canvasHome(env = process.env) {
  if (env.OPENCHAMBER_CANVAS_HOME) return env.OPENCHAMBER_CANVAS_HOME;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "openchamber-canvas");
}
function safeId(id) {
  if (!SESSION_ID_PATTERN.test(id)) throw new Error("id de sess\xE3o inv\xE1lido");
  return id;
}
function sessionsDir(env = process.env) {
  return path.join(canvasHome(env), "sessions");
}
function aliasesDir(env = process.env) {
  return path.join(canvasHome(env), "aliases");
}
function sessionDir(rootId, env = process.env) {
  return path.join(sessionsDir(env), safeId(rootId));
}
function canvasFile(rootId, env = process.env) {
  return path.join(sessionDir(rootId, env), "index.html");
}
function metaFile(rootId, env = process.env) {
  return path.join(sessionDir(rootId, env), "meta.json");
}
function aliasFile(sessionId, env = process.env) {
  return path.join(aliasesDir(env), safeId(sessionId));
}

// src/shared/canvas-files.ts
var ROOT_MAX_DEPTH = 8;
function parentOf(info) {
  const record = info && typeof info === "object" ? info : null;
  const inner = record && record.data && typeof record.data === "object" ? record.data : record;
  const parent = inner?.parentID;
  return typeof parent === "string" && SESSION_ID_PATTERN.test(parent) ? parent : null;
}
async function findRoot(sessionId, lookup, cache) {
  const chain = [];
  let current = sessionId;
  let root = null;
  for (let depth = 0; depth < ROOT_MAX_DEPTH; depth += 1) {
    const known = cache.get(current);
    if (known) {
      root = known;
      break;
    }
    chain.push(current);
    let parent = null;
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
async function writeAtomic(target, content) {
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, { encoding: "utf8", mode: 384 });
  await rename(tmp, target);
}
async function writeAlias(sessionId, rootId, env = process.env) {
  if (sessionId === rootId) return;
  await mkdir(aliasesDir(env), { recursive: true, mode: 448 });
  await writeAtomic(aliasFile(sessionId, env), rootId);
}
async function readTitle(rootId, env) {
  try {
    const meta = JSON.parse(await readFile(metaFile(rootId, env), "utf8"));
    const title = meta && typeof meta === "object" ? meta.title : void 0;
    return typeof title === "string" ? title : "";
  } catch {
    return "";
  }
}
async function writeCanvas(rootId, html, title, env = process.env) {
  if (!html.trim()) return { ok: false, message: "html vazio" };
  if (Buffer.byteLength(html, "utf8") > LIMITS.canvasBytes) return { ok: false, message: `canvas maior que o limite (${LIMITS.canvasBytes} bytes)` };
  await mkdir(sessionDir(rootId, env), { recursive: true, mode: 448 });
  const cleanTitle = (title ?? await readTitle(rootId, env)).slice(0, LIMITS.titleChars);
  await writeAtomic(metaFile(rootId, env), JSON.stringify({ title: cleanTitle, rootId, updatedAt: Date.now() }));
  const file = canvasFile(rootId, env);
  await writeAtomic(file, html);
  return { ok: true, file };
}
async function editCanvas(rootId, find, replace, title, env = process.env) {
  if (!find) return { ok: false, message: "`find` vazio" };
  let current;
  try {
    current = await readFile(canvasFile(rootId, env), "utf8");
  } catch {
    return { ok: false, message: "ainda n\xE3o h\xE1 canvas nesta conversa; use canvas_publish primeiro" };
  }
  const count = current.split(find).length - 1;
  if (count === 0) return { ok: false, message: "trecho `find` n\xE3o encontrado no canvas" };
  if (count > 1) return { ok: false, message: `trecho \`find\` aparece ${count} vezes; inclua mais contexto para ele ser \xFAnico` };
  return writeCanvas(rootId, current.replace(find, () => replace), title, env);
}

// plugin/index.ts
var PUBLISH_DESCRIPTION = [
  "Publica ou atualiza o Canvas desta conversa: um painel lateral do OpenChamber (e uma p\xE1gina no navegador) que o usu\xE1rio v\xEA atualizar em tempo real.",
  "O canvas \xE9 UM arquivo HTML livre por conversa (subagentes escrevem no canvas da conversa principal). Cada chamada SUBSTITUI o arquivo \u2014 reenvie o HTML inteiro. Para mudar s\xF3 um trecho, use canvas_edit.",
  "O retorno traz o caminho do arquivo: depois de publicar, Write/Edit nesse caminho tamb\xE9m atualiza o painel na hora.",
  'O HTML roda em iframe isolado, sem rede: CSS e JS inline valem, `<script>`, SVG inline e `<canvas>` tamb\xE9m; fetch, imagens externas e links que saem do painel n\xE3o funcionam. Links `<a href="https://\u2026">` abrem no navegador ao clicar.',
  "Para o visual pronto (cards, tabelas, steps, badges, barras, stats), inclua `<link data-kit>` no `<head>`: carrega as classes `ck-*` e as cores do tema do OpenChamber.",
  'Intera\xE7\xE3o que o painel entende: `data-canvas-item="<id>"` marca um elemento que o usu\xE1rio pode adicionar ao contexto, comentar e remover; `data-filter="<chave>:<valor>"` num elemento filtra, ao clicar, os que t\xEAm `data-tags` com o mesmo `<chave>:<valor>`.',
  "Prefira fluxogramas, tabelas e gr\xE1ficos quando ajudarem a entender."
].join("\n");
var EDIT_DESCRIPTION = [
  "Edita o Canvas desta conversa trocando UM trecho exato do HTML atual (`find` \u2192 `replace`), sem reenviar tudo.",
  "Falha se `find` n\xE3o existir ou aparecer mais de uma vez: inclua contexto suficiente para ser \xFAnico. O painel atualiza na hora."
].join("\n");
var TITLE_PROPERTY = { type: "string", description: `T\xEDtulo curto do canvas (at\xE9 ${LIMITS.titleChars} caracteres); omitido, mant\xE9m o atual` };
function text(value) {
  return typeof value === "string" ? value : "";
}
function failed(error, verb) {
  return { content: `Canvas N\xC3O ${verb}: ${error instanceof Error ? error.message : "erro ao gravar o arquivo"}.` };
}
var index_default = {
  id: "openchamber-canvas-viewer",
  async setup(ctx) {
    const lookup = (sessionId) => ctx.session.get({ sessionID: sessionId });
    const roots = /* @__PURE__ */ new Map();
    const rootFor = async (sessionId) => {
      const root = await findRoot(sessionId, lookup, roots);
      await writeAlias(sessionId, root);
      return root;
    };
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "canvas_publish",
        description: PUBLISH_DESCRIPTION,
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            html: { type: "string", description: `Documento ou fragmento HTML do canvas (at\xE9 ${LIMITS.canvasBytes} bytes)` },
            title: TITLE_PROPERTY
          },
          required: ["html"],
          additionalProperties: false
        },
        async execute(input, context) {
          if (!SESSION_ID_PATTERN.test(String(context?.sessionID ?? ""))) return { content: "Canvas N\xC3O publicado: sess\xE3o inv\xE1lida." };
          const body = input ?? {};
          try {
            const result = await writeCanvas(await rootFor(context.sessionID), text(body.html), typeof body.title === "string" ? body.title : void 0);
            if (!result.ok) return { content: `Canvas N\xC3O publicado: ${result.message}.` };
            return { content: `Canvas publicado e vis\xEDvel no painel. Arquivo: ${result.file} (Write/Edit nele tamb\xE9m atualiza o painel).` };
          } catch (error) {
            return failed(error, "publicado");
          }
        }
      });
      tools.add({
        name: "canvas_edit",
        description: EDIT_DESCRIPTION,
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            find: { type: "string", description: "Trecho exato do HTML atual a trocar (precisa aparecer uma \xFAnica vez)" },
            replace: { type: "string", description: "Texto que entra no lugar" },
            title: TITLE_PROPERTY
          },
          required: ["find", "replace"],
          additionalProperties: false
        },
        async execute(input, context) {
          if (!SESSION_ID_PATTERN.test(String(context?.sessionID ?? ""))) return { content: "Canvas N\xC3O editado: sess\xE3o inv\xE1lida." };
          const body = input ?? {};
          try {
            const result = await editCanvas(await rootFor(context.sessionID), text(body.find), text(body.replace), typeof body.title === "string" ? body.title : void 0);
            if (!result.ok) return { content: `Canvas N\xC3O editado: ${result.message}.` };
            return { content: `Canvas editado e vis\xEDvel no painel. Arquivo: ${result.file}.` };
          } catch (error) {
            return failed(error, "editado");
          }
        }
      });
    });
  }
};
export {
  index_default as default
};
