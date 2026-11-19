// Plugin do OpenCode que o OpenChamber carrega junto com a extensão. Registra as ferramentas
// `canvas_publish` e `canvas_edit`: o agente entrega HTML livre e o plugin — que sabe a sessão exata
// (context.sessionID) — grava o arquivo da sessão RAIZ (subagentes escrevem no canvas da conversa
// principal). O servidor único vigia a pasta e o painel atualiza sozinho.
//
// O OpenCode importa este arquivo sem node_modules ao lado: o build embute tudo
// (só módulos "node:*" ficam de fora) e o tipo da API é declarado aqui mesmo.

import { LIMITS, SESSION_ID_PATTERN } from "../src/shared/contract.ts";
import { editCanvas, findRoot, writeAlias, writeCanvas, type SessionLookup } from "../src/shared/canvas-files.ts";

type ToolResult = { content: string };
type ToolDefinition = {
  name: string;
  description: string;
  options?: { codemode: boolean };
  input: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  execute: (input: unknown, context: { sessionID: string }) => Promise<ToolResult>;
};
type PluginContext = {
  tool: { transform: (edit: (tools: { add: (tool: ToolDefinition) => void }) => void) => Promise<void> };
  session: { get: (input: { sessionID: string }) => Promise<unknown> };
};

const PUBLISH_DESCRIPTION = [
  "Publica ou atualiza o Canvas desta conversa: um painel lateral do OpenChamber (e uma página no navegador) que o usuário vê atualizar em tempo real.",
  "O canvas é UM arquivo HTML livre por conversa (subagentes escrevem no canvas da conversa principal). Cada chamada SUBSTITUI o arquivo — reenvie o HTML inteiro. Para mudar só um trecho, use canvas_edit.",
  "O retorno traz o caminho do arquivo: depois de publicar, Write/Edit nesse caminho também atualiza o painel na hora.",
  "O HTML roda em iframe isolado, sem rede: CSS e JS inline valem, `<script>`, SVG inline e `<canvas>` também; fetch, imagens externas e links que saem do painel não funcionam. Links `<a href=\"https://…\">` abrem no navegador ao clicar.",
  "Para o visual pronto (cards, tabelas, steps, badges, barras, stats), inclua `<link data-kit>` no `<head>`: carrega as classes `ck-*` e as cores do tema do OpenChamber.",
  "Interação que o painel entende: `data-canvas-item=\"<id>\"` marca um elemento que o usuário pode adicionar ao contexto, comentar e remover; `data-filter=\"<chave>:<valor>\"` num elemento filtra, ao clicar, os que têm `data-tags` com o mesmo `<chave>:<valor>`.",
  "Prefira fluxogramas, tabelas e gráficos quando ajudarem a entender.",
].join("\n");

const EDIT_DESCRIPTION = [
  "Edita o Canvas desta conversa trocando UM trecho exato do HTML atual (`find` → `replace`), sem reenviar tudo.",
  "Falha se `find` não existir ou aparecer mais de uma vez: inclua contexto suficiente para ser único. O painel atualiza na hora.",
].join("\n");

const TITLE_PROPERTY = { type: "string", description: `Título curto do canvas (até ${LIMITS.titleChars} caracteres); omitido, mantém o atual` };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Falha de arquivo (permissão, disco): mensagem curta e sem caminho do sistema do usuário além do já exposto. */
function failed(error: unknown, verb: "publicado" | "editado"): ToolResult {
  return { content: `Canvas NÃO ${verb}: ${error instanceof Error ? error.message : "erro ao gravar o arquivo"}.` };
}

export default {
  id: "openchamber-canvas-viewer",
  async setup(ctx: PluginContext): Promise<void> {
    const lookup: SessionLookup = (sessionId) => ctx.session.get({ sessionID: sessionId });
    const roots = new Map<string, string>();

    /** Raiz da sessão + alias gravado, para o painel de um subagente achar o canvas da raiz. */
    const rootFor = async (sessionId: string): Promise<string> => {
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
            html: { type: "string", description: `Documento ou fragmento HTML do canvas (até ${LIMITS.canvasBytes} bytes)` },
            title: TITLE_PROPERTY,
          },
          required: ["html"],
          additionalProperties: false,
        },
        async execute(input, context) {
          if (!SESSION_ID_PATTERN.test(String(context?.sessionID ?? ""))) return { content: "Canvas NÃO publicado: sessão inválida." };
          const body = (input ?? {}) as Record<string, unknown>;
          try {
            const result = await writeCanvas(await rootFor(context.sessionID), text(body.html), typeof body.title === "string" ? body.title : undefined);
            if (!result.ok) return { content: `Canvas NÃO publicado: ${result.message}.` };
            return { content: `Canvas publicado e visível no painel. Arquivo: ${result.file} (Write/Edit nele também atualiza o painel).` };
          } catch (error) {
            return failed(error, "publicado");
          }
        },
      });

      tools.add({
        name: "canvas_edit",
        description: EDIT_DESCRIPTION,
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            find: { type: "string", description: "Trecho exato do HTML atual a trocar (precisa aparecer uma única vez)" },
            replace: { type: "string", description: "Texto que entra no lugar" },
            title: TITLE_PROPERTY,
          },
          required: ["find", "replace"],
          additionalProperties: false,
        },
        async execute(input, context) {
          if (!SESSION_ID_PATTERN.test(String(context?.sessionID ?? ""))) return { content: "Canvas NÃO editado: sessão inválida." };
          const body = (input ?? {}) as Record<string, unknown>;
          try {
            const result = await editCanvas(await rootFor(context.sessionID), text(body.find), text(body.replace), typeof body.title === "string" ? body.title : undefined);
            if (!result.ok) return { content: `Canvas NÃO editado: ${result.message}.` };
            return { content: `Canvas editado e visível no painel. Arquivo: ${result.file}.` };
          } catch (error) {
            return failed(error, "editado");
          }
        },
      });
    });
  },
};
