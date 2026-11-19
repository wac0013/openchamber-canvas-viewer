import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildChip } from "../src/canvas/context.ts";
import { buildFrameDocument } from "../src/canvas/frame-doc.ts";
import { KIT_CSS } from "../src/canvas/kit.ts";
import { FILTER_PATTERN, ITEM_ID_PATTERN, LIMITS, UPDATE_REQUEST_MARKER, UPDATE_REQUEST_TEXT } from "../src/shared/contract.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = path.join(root, "skills");
const skillFile = path.join(skillsDir, "openchamber-canvas", "SKILL.md");

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

/** Blocos ```html das referências: cada um é um canvas completo. */
async function htmlBlocks(): Promise<string[]> {
  const blocks: string[] = [];
  for (const file of ["kit.md", "examples.md"]) {
    const text = await readFile(path.join(skillsDir, "openchamber-canvas", "references", file), "utf8");
    for (const match of text.matchAll(/```html\n([\s\S]*?)```/g)) blocks.push(match[1]!);
  }
  return blocks;
}

describe("skills instaláveis por `npx skills add`", () => {
  it("cada skill tem SKILL.md com name = pasta e description válida", async () => {
    const names = (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    assert.ok(names.length >= 1);
    for (const name of names) {
      const meta = frontmatter(await readFile(path.join(skillsDir, name, "SKILL.md"), "utf8"));
      assert.equal(meta.name, name);
      assert.match(meta.name!, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(meta.description && meta.description.length > 40 && meta.description.length <= 1024, `description de ${name}`);
      assert.equal(/: /.test(meta.description!), false, "dois-pontos num valor YAML sem aspas quebra o frontmatter");
      assert.equal(/ #/.test(meta.description!), false);
    }
  });

  it("cobre publicar, editar, kit, filtros, itens e a regra de não repetir no chat", async () => {
    const text = await readFile(skillFile, "utf8");
    for (const expected of ["canvas_publish", "canvas_edit", "Quando usar", "data-canvas-item", "data-kit", "data-filter", "data-tags", "Não repita a visualização no chat", "frontend-design", "sem rede", "mesmos ids"]) {
      assert.ok(text.includes(expected), `falta: ${expected}`);
    }
    assert.ok(text.length < 12_000);
  });

  it("os formatos de chip descritos na skill são os que buildChip realmente produz", async () => {
    const text = await readFile(skillFile, "utf8");
    const canvas = { title: "<título>", updatedAt: 0, text: "oi", items: [{ id: "x", text: "oi" }] };
    const blocks = [...text.matchAll(/```\n(Canvas: [\s\S]*?)```/g)].map((match) => match[1]!.trim().split("\n"));
    assert.equal(blocks.length, 2, "a skill documenta o chip de elemento e o de trecho");
    const generic = (lines: string[]) => lines.map((line) => line.replace(/^(Canvas|Elemento): .*/, "$1: <…>"));
    const item = generic((buildChip(canvas, { kind: "item", id: "x" })?.chip.text ?? "").split("\n"));
    const selection = generic((buildChip(canvas, { kind: "selection", text: "oi", itemId: "x" })?.chip.text ?? "").split("\n"));
    assert.deepEqual(blocks[0]!.slice(0, 3), ["Canvas: <título>", "Elemento: <id>", item[2]]);
    assert.deepEqual(blocks[1]!.slice(0, 4), ["Canvas: <título>", "Elemento: <id>", selection[2], selection[3]]);
  });

  it("o marcador do pedido de atualização citado na skill é o do contrato", async () => {
    const text = await readFile(skillFile, "utf8");
    const documented = /```\n(\[Painel Canvas[^\n]*)\n```/.exec(text)?.[1] ?? "";
    assert.ok(documented.startsWith(UPDATE_REQUEST_MARKER));
    assert.ok(UPDATE_REQUEST_TEXT.startsWith(documented.replace(/ …$/, "").slice(0, UPDATE_REQUEST_MARKER.length + 30)));
    for (const rule of ["pedido formal do usuário", "mesmo que ache que nada mudou", "início de uma mensagem do próprio usuário"]) assert.ok(text.includes(rule), rule);
  });

  it("as classes ck-* citadas na skill e nas referências existem no kit", async () => {
    const skill = await readFile(skillFile, "utf8");
    const cited = new Set<string>();
    for (const text of [skill, ...(await htmlBlocks())]) for (const match of text.matchAll(/\bck-[a-z][a-z-]*/g)) cited.add(match[0]);
    assert.ok(cited.size >= 8);
    for (const name of cited) assert.ok(KIT_CSS.includes(`.${name}`), `.${name} não existe no kit`);
  });

  it("todo bloco html das referências monta um documento com CSP, kit e runtime; ids e filtros válidos", async () => {
    const blocks = await htmlBlocks();
    assert.ok(blocks.length >= 8);
    for (const html of blocks) {
      assert.ok(html.length < LIMITS.canvasBytes);
      if (html.includes("<link data-kit>")) {
        const doc = buildFrameDocument({ html, theme: {}, colorScheme: "dark", mode: "panel", state: { filters: [], removed: [], scroll: 0 } });
        assert.ok(doc.includes(".ck-card{"), "o kit entrou inline");
        assert.equal(doc.includes("data-kit"), false, "o <link> foi trocado pelo kit");
      }
      const ids = [...html.matchAll(/data-canvas-item="([^"]+)"/g)].map((match) => match[1]!);
      assert.equal(new Set(ids).size, ids.length);
      for (const id of ids) assert.match(id, ITEM_ID_PATTERN);
      for (const match of html.matchAll(/data-(?:filter|tags)="([^"]+)"/g)) for (const token of match[1]!.split(/\s+/)) assert.match(token, FILTER_PATTERN);
    }
  });
});
