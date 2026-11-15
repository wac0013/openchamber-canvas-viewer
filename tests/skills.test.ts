import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ALLOWED_TAGS, parseCanvasHtml } from "../src/canvas/sanitize.ts";
import { LIMITS } from "../src/shared/contract.ts";

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

  it("não copia conteúdo das skills de front da Anthropic (só referencia por nome)", async () => {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "SKILL.md"), "utf8");
    assert.ok(text.length < 12_000);
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

  it("são 3 (acompanhamento, comparação, fluxo) e passam no sanitizador real sem nada bloqueado", async () => {
    const blocks = await examples();
    assert.equal(blocks.length, 3);
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
      assert.doesNotMatch(html, /style=|color:|#[0-9a-f]{3,6}\b/i);
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
});
