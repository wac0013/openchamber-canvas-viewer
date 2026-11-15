// Plugin do OpenCode que o OpenChamber carrega junto com a extensão. Registra a ferramenta
// `canvas_publish`: o agente entrega o HTML do canvas e o plugin — que sabe a sessão exata
// (context.sessionID) — deposita o arquivo na caixa de entrada que o serviço da extensão lê.
//
// O OpenCode importa este arquivo sem node_modules ao lado: o build embute tudo
// (só módulos "node:*" ficam de fora) e o tipo da API é declarado aqui mesmo.

import { mkdir, rename, writeFile } from "node:fs/promises";

import { buildSnapshot } from "../src/canvas/snapshot.ts";
import { INBOX_SCHEMA_VERSION, LIMITS, SESSION_ID_PATTERN, type InboxFile } from "../src/shared/contract.ts";
import { inboxDir, inboxFile } from "../service/paths.ts";

type ToolResult = { content: string };
type ToolDefinition = {
  name: string;
  description: string;
  options?: { codemode: boolean };
  input: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  execute: (input: unknown, context: { sessionID: string }) => Promise<ToolResult>;
};
type PluginContext = { tool: { transform: (edit: (tools: { add: (tool: ToolDefinition) => void }) => void) => Promise<void> } };

const DESCRIPTION = [
  "Publica ou atualiza o Canvas desta conversa: um painel lateral do OpenChamber que o usuário vê atualizar em tempo real.",
  "Cada chamada SUBSTITUI o canvas anterior (só existe um por conversa) — reenvie o HTML completo.",
  "`html` é um fragmento HTML estático. Tags permitidas: div, span, p, h1-h6, ul/ol/li, dl/dt/dd, table/thead/tbody/tr/th/td, blockquote, pre, code, strong/b, em/i, br, hr, section, article, details/summary, figure/figcaption.",
  "Atributos permitidos: class (nomes [a-z][a-z0-9-]; estilos prontos: card, row, grid, grid-2, grid-3, muted, ok, warn, err, info, badge, mono, small, big, center, right), title, colspan, rowspan e data-canvas-item=\"<id>\" para marcar um elemento que o usuário pode adicionar ao contexto ou comentar (id [a-z0-9-], único).",
  "Sem script, style, link, imagem, iframe, formulário nem atributo on*/href/src/style: isso é removido e informado no retorno. HTML malformado é recusado e o canvas anterior permanece.",
].join(" ");

export default {
  id: "openchamber-canvas-viewer",
  setup: async (ctx: PluginContext) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "canvas_publish",
        description: DESCRIPTION,
        // Oferecida direto ao modelo, fora do catálogo do Code Mode.
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            html: { type: "string", description: `HTML do canvas (até ${LIMITS.htmlChars} caracteres)` },
            title: { type: "string", description: `Título curto do canvas (até ${LIMITS.titleChars} caracteres)` },
          },
          required: ["html"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const { html, title } = (input && typeof input === "object" ? input : {}) as { html?: unknown; title?: unknown };
          if (!SESSION_ID_PATTERN.test(String(context?.sessionID ?? ""))) {
            return { content: "Canvas NÃO publicado: sessão desconhecida." };
          }
          // Cortesia ao agente: erro imediato e acionável. O serviço valida de novo.
          const built = buildSnapshot(title, html, Date.now());
          if (!built.ok) return { content: `Canvas NÃO publicado: ${built.message}. O canvas anterior foi mantido; corrija e publique de novo.` };

          const payload: InboxFile = { v: INBOX_SCHEMA_VERSION, sessionId: context.sessionID, title: built.snapshot.title, html: String(html) };
          const target = inboxFile(context.sessionID);
          await mkdir(inboxDir(), { recursive: true });
          const tmp = `${target}.tmp`;
          await writeFile(tmp, JSON.stringify(payload), "utf8");
          await rename(tmp, target); // atômico: o serviço nunca lê arquivo pela metade

          const blocked = built.snapshot.blocked.length ? ` Removido por segurança: ${built.snapshot.blocked.join(", ")}.` : "";
          return { content: `Canvas publicado e visível no painel.${blocked}` };
        },
      });
    });
  },
};
