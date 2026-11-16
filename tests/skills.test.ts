import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildChip, DATA_NOTICE, SELECTION_LINE } from "../src/canvas/context.ts";
import { parseEmbedsInput } from "../src/canvas/embeds.ts";
import { ALLOWED_TAGS, parseCanvasHtml } from "../src/canvas/sanitize.ts";
import { LIMITS, UPDATE_REQUEST_MARKER, UPDATE_REQUEST_TEXT } from "../src/shared/contract.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = path.join(root, "skills");

async function skillNames(): Promise<string[]> {
  return (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, "a skill precisa começar com frontmatter ---");
  const out: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const split = /^([a-z-]+):\s?(.*)$/.exec(line);
    if (split) out[split[1]!] = split[2]!;
  }
  return out;
}

/** Classes que o painel realmente estiliza (.cv-<nome> em panel/index.html). */
async function panelClasses(): Promise<Set<string>> {
  const html = await readFile(path.join(root, "panel", "index.html"), "utf8");
  return new Set([...html.matchAll(/\.cv-([a-z][a-z0-9-]*)/g)].map((match) => match[1]!));
}

describe("skills instaláveis por `npx skills add`", () => {
  it("há ao menos uma skill e cada uma tem SKILL.md com name = pasta e description válida (CA7)", async () => {
    const names = await skillNames();
    assert.ok(names.length >= 1);
    for (const name of names) {
      const text = await readFile(path.join(skillsDir, name, "SKILL.md"), "utf8");
      const meta = frontmatter(text);
      assert.equal(meta.name, name);
      assert.match(meta.name!, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(meta.description && meta.description.length > 40 && meta.description.length <= 1024, `description de ${name}`);
      assert.equal(/: /.test(meta.description!), false, "dois-pontos num valor YAML sem aspas quebra o frontmatter");
      assert.equal(/ #/.test(meta.description!), false);
    }
  });

  it("a skill cobre os pontos exigidos pela história", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    for (const expected of ["canvas_publish", "Quando usar", "Atualizar = publicar de novo", "data-canvas-item", "Não repita a visualização no chat", "frontend-design", "claro e escuro", "rolagem horizontal", "não acessa rede", "recuse"]) {
      assert.ok(text.includes(expected), `falta: ${expected}`);
    }
  });

  it("referencia as skills de front da Anthropic só por nome, sem copiar o conteúdo delas", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    assert.ok(text.length < 12_000);
    assert.match(text, /`frontend-design`/);
    assert.match(text, /`canvas`/);
    assert.equal(/^---\nname: (frontend-design|canvas)\n/m.test(text), false);
  });

  it("os formatos de chip descritos na skill são os que buildChip realmente produz", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    const parsed = parseCanvasHtml('<p data-canvas-item="x">oi</p>');
    if (!parsed.ok) throw new Error("fixture");
    const canvas = { title: "<título>", updatedAt: 0, tree: parsed.tree };
    const blocks = [...text.matchAll(/```\n(Canvas: [\s\S]*?)```/g)].map((match) => match[1]!.trim().split("\n"));
    assert.equal(blocks.length, 2, "a skill documenta o chip de elemento e o de trecho");
    const generic = (lines: string[]) => lines.map((line) => line.replace(/^(Canvas|Elemento): .*/, "$1: <…>"));
    const item = generic((buildChip(canvas, { kind: "item", id: "x" })?.chip.text ?? "").split("\n"));
    const selection = generic((buildChip(canvas, { kind: "selection", text: "oi", itemId: "x" })?.chip.text ?? "").split("\n"));
    assert.deepEqual(generic(blocks[0]!.slice(0, -1)), item.slice(0, -1));
    assert.deepEqual(generic(blocks[1]!.slice(0, -1)), selection.slice(0, -1));
    assert.ok(blocks[1]!.includes(SELECTION_LINE));
    assert.ok(blocks.every((lines) => lines.includes(DATA_NOTICE)));
  });

  it("o marcador do pedido do botão Atualizar na skill é o que o serviço realmente envia", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    assert.ok(UPDATE_REQUEST_TEXT.startsWith(UPDATE_REQUEST_MARKER));
    const documented = /```\n(\[Painel Canvas[^\n]*)\n```/.exec(text)?.[1] ?? "";
    assert.ok(documented.startsWith(UPDATE_REQUEST_MARKER), "a skill precisa citar o marcador exatamente");
    const intro = documented.replace(/ …$/, "");
    assert.ok(UPDATE_REQUEST_TEXT.startsWith(intro.slice(0, UPDATE_REQUEST_MARKER.length + 30)), "o início citado bate com o texto real");
    for (const rule of ["pedido formal do usuário", "mesmo que ache que nada mudou", "mesmos ids", "início de uma mensagem do próprio usuário"]) assert.ok(text.includes(rule), rule);
  });

  it("as tags documentadas na skill são exatamente as que o sanitizador aceita", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    const line = /\*\*Tags:\*\* `([^`]+)`/.exec(text)?.[1];
    assert.ok(line);
    const documented = new Set(line.split(" ").flatMap((tag) => (tag === "h1–h6" ? ["h1", "h2", "h3", "h4", "h5", "h6"] : [tag])));
    assert.deepEqual([...documented].sort(), [...ALLOWED_TAGS].sort());
  });

  it("as classes prontas documentadas (skill e descrição da ferramenta) são exatamente as que o painel estiliza", async () => {
    const css = [...(await panelClasses())].sort();
    const skill = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    const fromSkill = /\*\*Classes prontas\*\*[^:]*: ([^.]+)\./.exec(skill)?.[1]?.match(/`([a-z0-9-]+)`/g)?.map((value) => value.replaceAll("`", "")) ?? [];
    assert.deepEqual([...fromSkill].sort(), css);
    const plugin = await readFile(path.join(root, "plugin", "index.ts"), "utf8");
    const fromPlugin = /estilos prontos: ([^)]*)\)/.exec(plugin)?.[1]?.split(", ") ?? [];
    assert.deepEqual([...fromPlugin].sort(), css);
  });
});

describe("exemplos prontos (CA3/CA5)", () => {
  async function examples(): Promise<string[]> {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "references", "examples.md"), "utf8");
    return [...text.matchAll(/```html\n([\s\S]*?)```/g)].map((match) => match[1]!);
  }

  async function embedBlocks(): Promise<string[]> {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "references", "examples.md"), "utf8");
    return [...text.matchAll(/```embed\n([\s\S]*?)```/g)].map((match) => match[1]!);
  }

  it("são 5 (acompanhamento, comparação, fluxograma, painel com filtro, parte incorporada) e passam no sanitizador real sem nada bloqueado", async () => {
    const blocks = await examples();
    assert.equal(blocks.length, 5);
    for (const html of blocks) {
      const parsed = parseCanvasHtml(html);
      assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.message);
      if (parsed.ok) assert.deepEqual(parsed.blocked, []);
    }
  });

  it("cada exemplo marca blocos principais com ids válidos e únicos", async () => {
    for (const html of await examples()) {
      const ids = [...html.matchAll(/data-canvas-item="([^"]+)"/g)].map((match) => match[1]!);
      assert.ok(ids.length >= 2);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(ids.length <= LIMITS.items);
    }
  });

  it("só usam classes que o painel estiliza e nenhuma cor própria (legível nos dois temas)", async () => {
    const css = await panelClasses();
    for (const html of await examples()) {
      for (const match of html.matchAll(/class="([^"]+)"/g)) {
        for (const token of match[1]!.split(" ")) assert.ok(css.has(token), `classe sem estilo: ${token}`);
      }
      assert.doesNotMatch(html, /style=|color:|(?<![\w])#[0-9a-f]{3,6}\b/i);
    }
  });

  it("tabelas dos exemplos têm no máximo 4 colunas (sem rolagem horizontal)", async () => {
    for (const html of await examples()) {
      for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = row[1]!.match(/<t[dh]\b/g)?.length ?? 0;
        assert.ok(cells <= 4);
      }
    }
  });

  it("o exemplo de parte incorporada tem o HTML da parte, aceito pelo contrato, sem cor fixa", async () => {
    const blocks = await embedBlocks();
    assert.equal(blocks.length, 1);
    const parsed = parseEmbedsInput([{ id: "falhas", html: blocks[0]! }]);
    assert.equal(parsed.ok, true);
    assert.doesNotMatch(blocks[0]!, /#[0-9a-f]{3,6}\b|rgb\(|hsl\(|https?:/i);
    const html = (await examples())[4]!;
    assert.match(html, /data-embed="falhas"/);
  });

  it("o exemplo de painel mostra link, selo com tom, métrica, aviso e grupos (filtro)", async () => {
    const html = (await examples())[3]!;
    for (const expected of ['href="https://', 'class="badge" data-tone=', 'class="stat"', 'class="callout"', "data-group="]) assert.ok(html.includes(expected), expected);
  });
});

describe("referência de componentes", () => {
  async function snippets(): Promise<string[]> {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "references", "components.md"), "utf8");
    return [...text.matchAll(/```html\n([\s\S]*?)```/g)].map((match) => match[1]!);
  }

  it("todo trecho passa no sanitizador real sem nada bloqueado", async () => {
    const blocks = await snippets();
    assert.ok(blocks.length >= 10);
    for (const html of blocks) {
      const parsed = parseCanvasHtml(html);
      assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.message);
      if (parsed.ok) assert.deepEqual(parsed.blocked, []);
    }
  });

  it("só usa classes que o painel estiliza e nenhuma cor própria", async () => {
    const css = await panelClasses();
    for (const html of await snippets()) {
      for (const match of html.matchAll(/class="([^"]+)"/g)) {
        for (const token of match[1]!.split(" ")) assert.ok(css.has(token), `classe sem estilo: ${token}`);
      }
      assert.doesNotMatch(html, /style=|color:|(?<![\w])#[0-9a-f]{3,6}\b/i);
    }
  });

  it("cobre fluxograma e os três gráficos que a skill manda considerar", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "references", "components.md"), "utf8");
    for (const expected of ['class="flow"', 'class="flow-col"', 'class="chart"', 'class="stack"', 'class="columns"', "data-embed"]) assert.ok(text.includes(expected), expected);
  });

  it("a skill manda sempre considerar fluxograma e gráfico, e documenta links, filtro e embeds", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    for (const expected of ["Sempre considere um fluxograma ou um gráfico", "## Links", "## Filtro automático e grupos", "## Partes incorporadas", "data-embed", "oc-"]) assert.ok(text.includes(expected), expected);
  });
});
