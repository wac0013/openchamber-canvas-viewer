// Sanitização do HTML publicado pelo agente. Entrada NÃO CONFIÁVEL.
//
// Em vez de "limpar" HTML e entregá-lo a um parser do navegador (risco de mutation XSS),
// este módulo lê um subconjunto estrito de HTML e produz uma ÁRVORE de dados. O painel só
// constrói DOM a partir dessa árvore (createElement/textContent), nunca com innerHTML.
//
// - Construção PROIBIDA (script, style, link, img, src/style/on*, href que não seja http/https…):
//   removida e anotada em `blocked`; o restante do canvas continua funcional (CA8).
// - HTML MALFORMADO ou acima dos limites: recusado por inteiro (RN4: o canvas vigente fica).
// Nenhuma mensagem reproduz o conteúdo do agente.

import { BLOCKED_NOTES_MAX, LIMITS, TONES, type CanvasElement, type CanvasNode } from "../shared/contract.ts";

export type ParseResult =
  | { ok: true; tree: CanvasNode[]; blocked: string[] }
  | { ok: false; message: string };

/** Tags aceitas no canvas; a skill e a descrição da ferramenta devem listar exatamente estas. */
export const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "a", "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "blockquote", "pre", "code",
  "strong", "b", "em", "i", "u", "s", "mark", "small", "sub", "sup", "kbd", "br", "hr",
  "section", "article", "header", "footer", "figure", "figcaption", "details", "summary",
]);

const VOID_TAGS = new Set(["br", "hr"]);

/** Removidos junto com TODO o conteúdo, até o fechamento (execução, estilo, mídia embutida). */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "svg", "math", "iframe", "object", "textarea", "noscript", "template", "title", "head", "select",
]);
/** Removidos sozinhos: não têm conteúdo nem fechamento. */
const DROP_VOID = new Set(["img", "input", "meta", "link", "base", "source", "track", "area", "embed", "param", "wbr"]);
/** Qualquer outra tag fora da lista permitida é "desembrulhada": some a tag, o texto fica. Fechamentos são ignorados. */

const CLASS_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Controles bidirecionais (U+202A–202E, U+2066–2069) permitem texto que parece outra coisa. */
const BIDI_CHARS = /[\u202a-\u202e\u2066-\u2069]/;
const BIDI_CHARS_ALL = /[\u202a-\u202e\u2066-\u2069]/g;

const TONE_SET: ReadonlySet<string> = new Set(TONES);
const DATA_VALUE = /^(?:100(?:\.0{1,2})?|[0-9]{1,2}(?:\.[0-9]{1,2})?)$/;
const DATA_HEIGHT = /^[0-9]{2,4}$/;
const HREF_FORBIDDEN = /[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

class Malformed extends Error {}

/**
 * Link aceito: só `http:`/`https:`, sem credenciais, sem espaço/controle/bidi e até `hrefChars`.
 * Devolve a forma normalizada (host em punycode, escapes) ou `null`. Idempotente: serve às duas
 * fronteiras (leitura do HTML e revalidação da árvore).
 */
export function cleanHref(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || value.length > LIMITS.hrefChars || HREF_FORBIDDEN.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.hostname === "") return null;
  return url.href.length <= LIMITS.hrefChars ? url.href : null;
}

/** Atributos sem unicidade: valor limpo ou `null` se inválido. Compartilhado pelo leitor e pela revalidação. */
const SIMPLE_ATTRIBUTES: ReadonlySet<string> = new Set(["title", "colspan", "rowspan", "href", "data-tone", "data-value", "data-group", "data-height"]);

function simpleAttribute(tag: string, name: string, value: string): string | null {
  switch (name) {
    case "title":
      return value.slice(0, 200);
    case "colspan":
    case "rowspan":
      return /^[1-9][0-9]?$/.test(value) ? value : null;
    case "href":
      return tag === "a" ? cleanHref(value) : null;
    case "data-tone":
      return TONE_SET.has(value) ? value : null;
    case "data-value":
      return DATA_VALUE.test(value) ? value : null;
    case "data-group": {
      if (BIDI_CHARS.test(value)) return null;
      const group = value.slice(0, LIMITS.groupChars).trim();
      return group === "" ? null : group;
    }
    case "data-height":
      return DATA_HEIGHT.test(value) && Number(value) >= LIMITS.embedHeightMin && Number(value) <= LIMITS.embedHeightMax ? value : null;
    default:
      return null;
  }
}

function blockedNote(tag: string, name: string): string {
  if (name === "href") return tag === "a" ? "link inválido (use http:// ou https://)" : "atributo href";
  return `atributo ${name} inválido`;
}

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const ok = Number.isInteger(code) && (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x10ffff && code !== 0x7f && !(code >= 0xd800 && code <= 0xdfff)));
      return ok ? String.fromCodePoint(code) : "\ufffd";
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body]! : whole;
  });
}

function position(html: string, index: number): string {
  const before = html.slice(0, index);
  return `linha ${before.split("\n").length}, coluna ${index - before.lastIndexOf("\n")}`;
}

const TAG_OPEN = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const TAG_CLOSE = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseOrThrow(html: string, blocked: Set<string>): CanvasNode[] {
  if (html.length > LIMITS.htmlChars) throw new Malformed(`HTML maior que ${LIMITS.htmlChars} caracteres`);
  const root: CanvasNode[] = [];
  const stack: CanvasElement[] = [];
  const seenItems = new Set<string>();
  const seenEmbeds = new Set<string>();
  let nodes = 0;
  let index = 0;

  const block = (what: string): void => {
    if (blocked.size < BLOCKED_NOTES_MAX) blocked.add(what);
  };
  const children = (): CanvasNode[] => (stack.length ? stack[stack.length - 1]!.c : root);
  const count = (): void => {
    if (++nodes > LIMITS.nodes) throw new Malformed(`mais de ${LIMITS.nodes} nós`);
  };
  const pushText = (raw: string): void => {
    if (!raw) return;
    let value = decodeEntities(raw);
    if (CONTROL_CHARS.test(value)) throw new Malformed("caractere de controle no texto");
    if (BIDI_CHARS.test(value)) {
      block("controle bidirecional");
      value = value.replace(BIDI_CHARS_ALL, "");
    }
    count();
    children().push({ t: "text", v: value });
  };

  const readAttributes = (raw: string, tag: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (const match of raw.matchAll(ATTRIBUTE)) {
      const name = (match[1] ?? "").toLowerCase();
      const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
      if (CONTROL_CHARS.test(value)) throw new Malformed(`caractere inválido no atributo "${name}"`);
      switch (name) {
        case "class": {
          const tokens = value.split(/\s+/).filter(Boolean);
          const valid = tokens.filter((token) => CLASS_TOKEN.test(token)).slice(0, 8);
          if (valid.length !== tokens.length) block("classe inválida (use [a-z][a-z0-9-], até 8)");
          if (valid.length) attrs.class = valid.join(" ");
          break;
        }
        case "data-canvas-item":
          if (!ITEM_ID.test(value)) throw new Malformed("data-canvas-item inválido (use [a-z0-9][a-z0-9-], até 40)");
          if (seenItems.has(value)) throw new Malformed(`data-canvas-item repetido: ${value}`);
          if (seenItems.size >= LIMITS.items) throw new Malformed(`mais de ${LIMITS.items} itens marcáveis`);
          seenItems.add(value);
          attrs["data-canvas-item"] = value;
          break;
        case "data-embed":
          if (tag !== "div") {
            block("data-embed fora de <div>");
            break;
          }
          if (!ITEM_ID.test(value)) throw new Malformed("data-embed inválido (use [a-z0-9][a-z0-9-], até 40)");
          if (seenEmbeds.has(value)) throw new Malformed(`data-embed repetido: ${value}`);
          if (seenEmbeds.size >= LIMITS.embeds) throw new Malformed(`mais de ${LIMITS.embeds} partes incorporadas`);
          seenEmbeds.add(value);
          attrs["data-embed"] = value;
          break;
        default:
          if (SIMPLE_ATTRIBUTES.has(name)) {
            const clean = simpleAttribute(tag, name, value);
            if (clean === null) block(blockedNote(tag, name));
            else attrs[name] = clean;
          } else {
            block(`atributo ${name.startsWith("on") ? "on*" : name}`);
          }
      }
    }
    return attrs;
  };

  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }
    pushText(html.slice(index, lt));
    index = lt;

    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      if (end === -1) throw new Malformed(`comentário não fechado (${position(html, index)})`);
      index = end + 3;
      continue;
    }
    if (html.startsWith("<!", index) || html.startsWith("<?", index)) {
      const end = html.indexOf(">", index);
      if (end === -1) throw new Malformed(`declaração não fechada (${position(html, index)})`);
      block("declaração (<! ou <?)");
      index = end + 1;
      continue;
    }

    const closing = TAG_CLOSE.exec(html.slice(index, index + 64));
    if (closing) {
      const name = (closing[1] ?? "").toLowerCase();
      index += closing[0].length;
      if (!ALLOWED_TAGS.has(name)) continue;
      const top = stack.pop();
      if (!top || top.tag !== name) throw new Malformed(`fechamento </${name}> sem abertura correspondente (${position(html, index)})`);
      continue;
    }

    const opening = TAG_OPEN.exec(html.slice(index, index + 4096));
    if (!opening) throw new Malformed(`marcação malformada (${position(html, index)}); use &lt; para o caractere <`);
    const name = (opening[1] ?? "").toLowerCase();
    index += opening[0].length;

    if (DROP_WITH_CONTENT.has(name)) {
      block(`<${name}>`);
      if (opening[3] === "/") continue;
      const close = new RegExp(`</${name}\\s*>`, "i").exec(html.slice(index));
      if (!close) throw new Malformed(`<${name}> não foi fechada`);
      index += close.index + close[0].length;
      continue;
    }
    if (DROP_VOID.has(name)) {
      block(`<${name}>`);
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) {
      block(`<${name}>`);
      continue;
    }

    if (stack.length + 1 > LIMITS.depth) throw new Malformed(`aninhamento maior que ${LIMITS.depth}`);
    count();
    const element: CanvasElement = { t: "el", tag: name, attrs: readAttributes(opening[2] ?? "", name), c: [] };
    children().push(element);
    if (VOID_TAGS.has(name) || opening[3] === "/") continue;
    stack.push(element);
  }

  const open = stack[stack.length - 1];
  if (open) throw new Malformed(`tag <${open.tag}> não foi fechada`);
  return root;
}

/** Lê o HTML do agente. Remove o proibido; recusa o malformado sem tentar "consertar". */
export function parseCanvasHtml(html: unknown): ParseResult {
  if (typeof html !== "string") return { ok: false, message: "html deve ser texto" };
  const blocked = new Set<string>();
  try {
    const tree = parseOrThrow(html, blocked);
    return { ok: true, tree, blocked: [...blocked] };
  } catch (error) {
    if (error instanceof Malformed) return { ok: false, message: error.message };
    return { ok: false, message: "falha ao ler o HTML" };
  }
}

/**
 * Segunda fronteira de confiança: o painel revalida a árvore que recebe do serviço
 * (serviço antigo, arquivo corrompido ou adulterado não injeta nada) e usa só a cópia limpa.
 */
export function validateTree(value: unknown): CanvasNode[] | null {
  let nodes = 0;
  let items = 0;
  const seen = new Set<string>();
  const embeds = new Set<string>();

  /** `depth` conta só elementos aninhados, igual ao parser: texto folha não é um nível. */
  const walk = (raw: unknown, depth: number): CanvasNode | null => {
    if (++nodes > LIMITS.nodes || typeof raw !== "object" || raw === null) return null;
    const node = raw as Record<string, unknown>;
    if (node.t === "text") {
      return typeof node.v === "string" && node.v.length <= LIMITS.htmlChars && !CONTROL_CHARS.test(node.v) && !BIDI_CHARS.test(node.v) ? { t: "text", v: node.v } : null;
    }
    if (depth > LIMITS.depth) return null;
    if (node.t !== "el" || typeof node.tag !== "string" || !ALLOWED_TAGS.has(node.tag)) return null;
    if (typeof node.attrs !== "object" || node.attrs === null || !Array.isArray(node.c)) return null;
    const attrs: Record<string, string> = {};
    for (const [name, attr] of Object.entries(node.attrs as Record<string, unknown>)) {
      if (typeof attr !== "string") return null;
      if (name === "class") {
        const tokens = attr.split(/\s+/).filter(Boolean);
        if (tokens.length > 8 || !tokens.every((token) => CLASS_TOKEN.test(token))) return null;
        attrs.class = tokens.join(" ");
      } else if (name === "data-canvas-item") {
        if (!ITEM_ID.test(attr) || seen.has(attr) || ++items > LIMITS.items) return null;
        seen.add(attr);
        attrs[name] = attr;
      } else if (name === "data-embed") {
        if (node.tag !== "div" || !ITEM_ID.test(attr) || embeds.has(attr) || embeds.size >= LIMITS.embeds) return null;
        embeds.add(attr);
        attrs[name] = attr;
      } else if (SIMPLE_ATTRIBUTES.has(name)) {
        if (simpleAttribute(node.tag, name, attr) !== attr) return null;
        attrs[name] = attr;
      } else {
        return null;
      }
    }
    if (VOID_TAGS.has(node.tag) && node.c.length > 0) return null;
    const c: CanvasNode[] = [];
    for (const child of node.c) {
      const clean = walk(child, depth + 1);
      if (!clean) return null;
      c.push(clean);
    }
    return { t: "el", tag: node.tag, attrs, c };
  };

  if (!Array.isArray(value)) return null;
  const tree: CanvasNode[] = [];
  for (const child of value) {
    const clean = walk(child, 1);
    if (!clean) return null;
    tree.push(clean);
  }
  return tree;
}

/** Ids das partes incorporadas referenciadas na árvore (`data-embed`), na ordem do documento. */
export function embedIds(nodes: readonly CanvasNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly CanvasNode[]): void => {
    for (const node of list) {
      if (node.t !== "el") continue;
      const id = node.attrs["data-embed"];
      if (id) ids.push(id);
      walk(node.c);
    }
  };
  walk(nodes);
  return ids;
}

/** Texto visível de um conjunto de nós (usado por itens marcáveis); limitado a `max` caracteres. */
export function textOf(nodes: readonly CanvasNode[], max: number = LIMITS.itemTextChars): string {
  let out = "";
  const walk = (list: readonly CanvasNode[]): void => {
    for (const node of list) {
      if (out.length >= max) return;
      if (node.t === "text") out += node.v;
      else {
        if (node.tag === "br") out += "\n";
        walk(node.c);
      }
    }
  };
  walk(nodes);
  return out.slice(0, max);
}

/** Assinatura estrutural (sequência de tags): igual = mesma estrutura, o scroll pode ser preservado. */
export function structureSignature(nodes: readonly CanvasNode[]): string {
  const parts: string[] = [];
  const walk = (list: readonly CanvasNode[]): void => {
    for (const node of list) {
      if (node.t !== "el") continue;
      parts.push(node.tag);
      walk(node.c);
      parts.push("/");
    }
  };
  walk(nodes);
  return parts.join(",");
}
