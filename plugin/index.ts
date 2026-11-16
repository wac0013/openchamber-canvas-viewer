// Plugin do OpenCode que o OpenChamber carrega junto com a extensão. Registra a ferramenta
// `canvas_publish`: o agente entrega o HTML do canvas e o plugin — que sabe a sessão exata
// (context.sessionID) — deposita o arquivo na caixa de entrada que o serviço da extensão lê.
//
// O OpenCode importa este arquivo sem node_modules ao lado: o build embute tudo
// (só módulos "node:*" ficam de fora) e o tipo da API é declarado aqui mesmo.

import { randomUUID } from "node:crypto";
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
  "`html` é um fragmento HTML estático. Tags permitidas: a, div, span, p, h1-h6, ul/ol/li, dl/dt/dd, table/thead/tbody/tr/th/td, blockquote, pre, code, strong/b, em/i, br, hr, section, article, details/summary, figure/figcaption.",
  "Links: <a href=\"https://…\"> (só http/https, clicáveis; qualquer outro esquema é removido).",
  "Atributos permitidos: class (nomes [a-z][a-z0-9-]; estilos prontos: card, row, grid, grid-2, grid-3, muted, ok, warn, err, info, badge, mono, small, big, center, right, box, stat, stat-value, stat-label, callout, callout-title, chip, dot, rows, split, side, num, table, bar, chart, chart-row, chart-label, chart-value, stack, seg, columns, col, col-track, col-bar, col-label, flow, flow-col, step, step-title), com o prefixo oc- do render nativo do OpenChamber também valendo; data-tone (neutral|info|success|warning|error: colore badge, chip, stat, callout, step, bar, seg); data-value (0 a 100, para bar/seg/col-bar); title, colspan, rowspan e data-canvas-item=\"<id>\" para marcar um elemento que o usuário pode adicionar ao contexto, comentar e filtrar (id [a-z0-9-], único); data-group=\"<nome>\" agrupa itens para o filtro do painel.",
  "O painel mostra sozinho um filtro de texto/grupo quando há 6+ itens marcados. Prefira fluxogramas (flow/step) e gráficos (chart, stack, columns) quando ajudarem a entender.",
  "Visual que o HTML acima não cobre (gráfico de linhas, SVG, diagrama complexo, interatividade): passe `embeds` ([{ id, html }]; HTML completo com style/script/svg, em iframe isolado sem rede, até 8 partes) e use <div data-embed=\"<id>\" data-height=\"<px opcional>\">texto equivalente</div> no html.",
  "Sem script, style, link, imagem, iframe, formulário nem atributo on*/src/style no `html`: isso é removido e informado no retorno. HTML malformado é recusado e o canvas anterior permanece.",
].join(" ");

export default {
  id: "openchamber-canvas-viewer",
  setup: async (ctx: PluginContext) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "canvas_publish",
        description: DESCRIPTION,
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            html: { type: "string", description: `HTML do canvas (até ${LIMITS.htmlChars} caracteres)` },
            title: { type: "string", description: `Título curto do canvas (até ${LIMITS.titleChars} caracteres)` },
            embeds: {
              type: "array",
              description: `Partes incorporadas (até ${LIMITS.embeds}): HTML completo, desenhado num iframe isolado sem rede; referenciado no html por <div data-embed="id">`,
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Id [a-z0-9-], até 40 caracteres, igual ao data-embed do html" },
                  html: { type: "string", description: `HTML da parte (até ${LIMITS.embedChars} caracteres; style, script e svg valem)` },
                },
                required: ["id", "html"],
                additionalProperties: false,
              },
            },
          },
          required: ["html"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const { html, title, embeds } = (input && typeof input === "object" ? input : {}) as { html?: unknown; title?: unknown; embeds?: unknown };
          if (!SESSION_ID_PATTERN.test(String(context?.sessionID ?? ""))) {
            return { content: "Canvas NÃO publicado: sessão desconhecida." };
          }
          const built = buildSnapshot(title, html, Date.now(), embeds);
          if (!built.ok) return { content: `Canvas NÃO publicado: ${built.message}. O canvas anterior foi mantido; corrija e publique de novo.` };

          const payload: InboxFile = {
            v: INBOX_SCHEMA_VERSION,
            sessionId: context.sessionID,
            title: built.snapshot.title,
            html: String(html),
            ...(Object.keys(built.snapshot.embeds).length ? { embeds: Object.entries(built.snapshot.embeds).map(([id, body]) => ({ id, html: body })) } : {}),
          };
          const target = inboxFile(context.sessionID);
          await mkdir(inboxDir(), { recursive: true });
          const tmp = `${target}.${randomUUID()}.tmp`;
          await writeFile(tmp, JSON.stringify(payload), "utf8");
          await rename(tmp, target);

          const blocked = built.snapshot.blocked.length ? ` Avisos (removido por segurança ou ajustado): ${built.snapshot.blocked.join(", ")}.` : "";
          return { content: `Canvas publicado e visível no painel.${blocked}` };
        },
      });
    });
  },
};
