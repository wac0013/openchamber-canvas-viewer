// plugin/index.ts
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";

// src/shared/contract.ts
var INBOX_SCHEMA_VERSION = 1;
var LIMITS = {
  /** Tamanho máximo do HTML publicado pelo agente. */
  htmlChars: 2e5,
  titleChars: 120,
  depth: 32,
  nodes: 5e3,
  items: 200,
  /** Texto máximo de um item marcável (limite do `host.attach`). */
  itemTextChars: 16e3,
  /** Tamanho máximo de um link (`href`). */
  hrefChars: 2048,
  /** Tamanho máximo do valor de `data-group` (filtro por grupo). */
  groupChars: 60,
  /** Quantidade de itens marcáveis a partir da qual o painel oferece o filtro de texto. */
  filterMinItems: 6,
  /** Partes incorporadas (HTML completo em iframe isolado): quantidade, tamanho de cada uma e total. */
  embeds: 8,
  embedChars: 1e5,
  embedsTotalChars: 2e5,
  /** Altura de uma parte incorporada, em px. */
  embedHeightMin: 60,
  embedHeightMax: 1200
};
var TONES = ["neutral", "info", "success", "warning", "error"];
var SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
var BLOCKED_NOTES_MAX = 20;

// src/canvas/embeds.ts
var EMBED_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
var CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function isEmbedId(value) {
  return typeof value === "string" && EMBED_ID.test(value);
}
function parseEmbedsInput(value) {
  if (value === void 0 || value === null) return { ok: true, embeds: {} };
  if (!Array.isArray(value)) return { ok: false, message: "embeds deve ser uma lista de { id, html }" };
  if (value.length > LIMITS.embeds) return { ok: false, message: `mais de ${LIMITS.embeds} partes incorporadas` };
  const embeds = {};
  let total = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return { ok: false, message: "cada embed deve ser { id, html }" };
    const { id, html } = entry;
    if (!isEmbedId(id)) return { ok: false, message: "id de embed inv\xE1lido (use [a-z0-9][a-z0-9-], at\xE9 40)" };
    if (Object.hasOwn(embeds, id)) return { ok: false, message: `embed repetido: ${id}` };
    if (typeof html !== "string" || html.trim() === "") return { ok: false, message: `o embed ${id} est\xE1 vazio` };
    if (html.length > LIMITS.embedChars) return { ok: false, message: `o embed ${id} passa de ${LIMITS.embedChars} caracteres` };
    if (CONTROL_CHARS.test(html)) return { ok: false, message: `caractere de controle no embed ${id}` };
    total += html.length;
    if (total > LIMITS.embedsTotalChars) return { ok: false, message: `os embeds passam de ${LIMITS.embedsTotalChars} caracteres no total` };
    embeds[id] = html;
  }
  return { ok: true, embeds };
}

// src/canvas/sanitize.ts
var ALLOWED_TAGS = /* @__PURE__ */ new Set([
  "a",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "blockquote",
  "pre",
  "code",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "mark",
  "small",
  "sub",
  "sup",
  "kbd",
  "br",
  "hr",
  "section",
  "article",
  "header",
  "footer",
  "figure",
  "figcaption",
  "details",
  "summary"
]);
var VOID_TAGS = /* @__PURE__ */ new Set(["br", "hr"]);
var DROP_WITH_CONTENT = /* @__PURE__ */ new Set([
  "script",
  "style",
  "svg",
  "math",
  "iframe",
  "object",
  "textarea",
  "noscript",
  "template",
  "title",
  "head",
  "select"
]);
var DROP_VOID = /* @__PURE__ */ new Set(["img", "input", "meta", "link", "base", "source", "track", "area", "embed", "param", "wbr"]);
var CLASS_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
var ITEM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
var NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xA0" };
var CONTROL_CHARS2 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
var BIDI_CHARS = /[\u202a-\u202e\u2066-\u2069]/;
var BIDI_CHARS_ALL = /[\u202a-\u202e\u2066-\u2069]/g;
var TONE_SET = new Set(TONES);
var DATA_VALUE = /^(?:100(?:\.0{1,2})?|[0-9]{1,2}(?:\.[0-9]{1,2})?)$/;
var DATA_HEIGHT = /^[0-9]{2,4}$/;
var HREF_FORBIDDEN = /[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
var Malformed = class extends Error {
};
function cleanHref(raw) {
  const value = raw.trim();
  if (value === "" || value.length > LIMITS.hrefChars || HREF_FORBIDDEN.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.hostname === "") return null;
  return url.href.length <= LIMITS.hrefChars ? url.href : null;
}
var SIMPLE_ATTRIBUTES = /* @__PURE__ */ new Set(["title", "colspan", "rowspan", "href", "data-tone", "data-value", "data-group", "data-height"]);
function simpleAttribute(tag, name, value) {
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
function blockedNote(tag, name) {
  if (name === "href") return tag === "a" ? "link inv\xE1lido (use http:// ou https://)" : "atributo href";
  return `atributo ${name} inv\xE1lido`;
}
function decodeEntities(raw) {
  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const ok = Number.isInteger(code) && (code === 9 || code === 10 || code === 13 || code >= 32 && code <= 1114111 && code !== 127 && !(code >= 55296 && code <= 57343));
      return ok ? String.fromCodePoint(code) : "\uFFFD";
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}
function position(html, index) {
  const before = html.slice(0, index);
  return `linha ${before.split("\n").length}, coluna ${index - before.lastIndexOf("\n")}`;
}
var TAG_OPEN = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
var TAG_CLOSE = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/;
var ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseOrThrow(html, blocked) {
  if (html.length > LIMITS.htmlChars) throw new Malformed(`HTML maior que ${LIMITS.htmlChars} caracteres`);
  const root = [];
  const stack = [];
  const seenItems = /* @__PURE__ */ new Set();
  const seenEmbeds = /* @__PURE__ */ new Set();
  let nodes = 0;
  let index = 0;
  const block = (what) => {
    if (blocked.size < BLOCKED_NOTES_MAX) blocked.add(what);
  };
  const children = () => stack.length ? stack[stack.length - 1].c : root;
  const count = () => {
    if (++nodes > LIMITS.nodes) throw new Malformed(`mais de ${LIMITS.nodes} n\xF3s`);
  };
  const pushText = (raw) => {
    if (!raw) return;
    let value = decodeEntities(raw);
    if (CONTROL_CHARS2.test(value)) throw new Malformed("caractere de controle no texto");
    if (BIDI_CHARS.test(value)) {
      block("controle bidirecional");
      value = value.replace(BIDI_CHARS_ALL, "");
    }
    count();
    children().push({ t: "text", v: value });
  };
  const readAttributes = (raw, tag) => {
    const attrs = {};
    for (const match of raw.matchAll(ATTRIBUTE)) {
      const name = (match[1] ?? "").toLowerCase();
      const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
      if (CONTROL_CHARS2.test(value)) throw new Malformed(`caractere inv\xE1lido no atributo "${name}"`);
      switch (name) {
        case "class": {
          const tokens = value.split(/\s+/).filter(Boolean);
          const valid = tokens.filter((token) => CLASS_TOKEN.test(token)).slice(0, 8);
          if (valid.length !== tokens.length) block("classe inv\xE1lida (use [a-z][a-z0-9-], at\xE9 8)");
          if (valid.length) attrs.class = valid.join(" ");
          break;
        }
        case "data-canvas-item":
          if (!ITEM_ID.test(value)) throw new Malformed("data-canvas-item inv\xE1lido (use [a-z0-9][a-z0-9-], at\xE9 40)");
          if (seenItems.has(value)) throw new Malformed(`data-canvas-item repetido: ${value}`);
          if (seenItems.size >= LIMITS.items) throw new Malformed(`mais de ${LIMITS.items} itens marc\xE1veis`);
          seenItems.add(value);
          attrs["data-canvas-item"] = value;
          break;
        case "data-embed":
          if (tag !== "div") {
            block("data-embed fora de <div>");
            break;
          }
          if (!ITEM_ID.test(value)) throw new Malformed("data-embed inv\xE1lido (use [a-z0-9][a-z0-9-], at\xE9 40)");
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
      if (end === -1) throw new Malformed(`coment\xE1rio n\xE3o fechado (${position(html, index)})`);
      index = end + 3;
      continue;
    }
    if (html.startsWith("<!", index) || html.startsWith("<?", index)) {
      const end = html.indexOf(">", index);
      if (end === -1) throw new Malformed(`declara\xE7\xE3o n\xE3o fechada (${position(html, index)})`);
      block("declara\xE7\xE3o (<! ou <?)");
      index = end + 1;
      continue;
    }
    const closing = TAG_CLOSE.exec(html.slice(index, index + 64));
    if (closing) {
      const name2 = (closing[1] ?? "").toLowerCase();
      index += closing[0].length;
      if (!ALLOWED_TAGS.has(name2)) continue;
      const top = stack.pop();
      if (!top || top.tag !== name2) throw new Malformed(`fechamento </${name2}> sem abertura correspondente (${position(html, index)})`);
      continue;
    }
    const opening = TAG_OPEN.exec(html.slice(index, index + 4096));
    if (!opening) throw new Malformed(`marca\xE7\xE3o malformada (${position(html, index)}); use &lt; para o caractere <`);
    const name = (opening[1] ?? "").toLowerCase();
    index += opening[0].length;
    if (DROP_WITH_CONTENT.has(name)) {
      block(`<${name}>`);
      if (opening[3] === "/") continue;
      const close = new RegExp(`</${name}\\s*>`, "i").exec(html.slice(index));
      if (!close) throw new Malformed(`<${name}> n\xE3o foi fechada`);
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
    const element = { t: "el", tag: name, attrs: readAttributes(opening[2] ?? "", name), c: [] };
    children().push(element);
    if (VOID_TAGS.has(name) || opening[3] === "/") continue;
    stack.push(element);
  }
  const open = stack[stack.length - 1];
  if (open) throw new Malformed(`tag <${open.tag}> n\xE3o foi fechada`);
  return root;
}
function parseCanvasHtml(html) {
  if (typeof html !== "string") return { ok: false, message: "html deve ser texto" };
  const blocked = /* @__PURE__ */ new Set();
  try {
    const tree = parseOrThrow(html, blocked);
    return { ok: true, tree, blocked: [...blocked] };
  } catch (error) {
    if (error instanceof Malformed) return { ok: false, message: error.message };
    return { ok: false, message: "falha ao ler o HTML" };
  }
}
function validateTree(value) {
  let nodes = 0;
  let items = 0;
  const seen = /* @__PURE__ */ new Set();
  const embeds = /* @__PURE__ */ new Set();
  const walk = (raw, depth) => {
    if (++nodes > LIMITS.nodes || typeof raw !== "object" || raw === null) return null;
    const node = raw;
    if (node.t === "text") {
      return typeof node.v === "string" && node.v.length <= LIMITS.htmlChars && !CONTROL_CHARS2.test(node.v) && !BIDI_CHARS.test(node.v) ? { t: "text", v: node.v } : null;
    }
    if (depth > LIMITS.depth) return null;
    if (node.t !== "el" || typeof node.tag !== "string" || !ALLOWED_TAGS.has(node.tag)) return null;
    if (typeof node.attrs !== "object" || node.attrs === null || !Array.isArray(node.c)) return null;
    const attrs = {};
    for (const [name, attr] of Object.entries(node.attrs)) {
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
    const c = [];
    for (const child of node.c) {
      const clean = walk(child, depth + 1);
      if (!clean) return null;
      c.push(clean);
    }
    return { t: "el", tag: node.tag, attrs, c };
  };
  if (!Array.isArray(value)) return null;
  const tree = [];
  for (const child of value) {
    const clean = walk(child, 1);
    if (!clean) return null;
    tree.push(clean);
  }
  return tree;
}
function embedIds(nodes) {
  const ids = [];
  const walk = (list) => {
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

// src/canvas/snapshot.ts
var TITLE_STRIP = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;
function buildSnapshot(title, html, now, embedsInput) {
  const cleanTitle = typeof title === "string" ? title.replace(TITLE_STRIP, " ").trim().slice(0, LIMITS.titleChars) : "";
  const parsed = parseCanvasHtml(html);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const sent = parseEmbedsInput(embedsInput);
  if (!sent.ok) return { ok: false, message: sent.message };
  if (parsed.tree.length === 0) return { ok: false, message: "o canvas est\xE1 vazio" };
  const tree = validateTree(parsed.tree);
  if (!tree) return { ok: false, message: "o canvas excede os limites de estrutura" };
  const used = new Set(embedIds(tree));
  const embeds = {};
  const blocked = [...parsed.blocked];
  for (const [id, body] of Object.entries(sent.embeds)) {
    if (used.has(id)) embeds[id] = body;
    else blocked.push(`embed sem uso: ${id}`);
  }
  for (const id of used) if (!Object.hasOwn(embeds, id)) blocked.push(`data-embed sem conte\xFAdo: ${id}`);
  return { ok: true, snapshot: { title: cleanTitle, updatedAt: now, tree, blocked: blocked.slice(0, BLOCKED_NOTES_MAX), embeds } };
}

// service/paths.ts
import os from "node:os";
import path from "node:path";
function inboxDir(env = process.env) {
  if (env.OPENCHAMBER_CANVAS_INBOX) return env.OPENCHAMBER_CANVAS_INBOX;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "openchamber", "canvas-viewer", "inbox");
}
function inboxFile(sessionId, env = process.env) {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("id de sess\xE3o inv\xE1lido");
  return path.join(inboxDir(env), `${sessionId}.json`);
}

// plugin/index.ts
var DESCRIPTION = [
  "Publica ou atualiza o Canvas desta conversa: um painel lateral do OpenChamber que o usu\xE1rio v\xEA atualizar em tempo real.",
  "Cada chamada SUBSTITUI o canvas anterior (s\xF3 existe um por conversa) \u2014 reenvie o HTML completo.",
  "`html` \xE9 um fragmento HTML est\xE1tico. Tags permitidas: a, div, span, p, h1-h6, ul/ol/li, dl/dt/dd, table/thead/tbody/tr/th/td, blockquote, pre, code, strong/b, em/i, br, hr, section, article, details/summary, figure/figcaption.",
  'Links: <a href="https://\u2026"> (s\xF3 http/https, clic\xE1veis; qualquer outro esquema \xE9 removido).',
  'Atributos permitidos: class (nomes [a-z][a-z0-9-]; estilos prontos: card, row, grid, grid-2, grid-3, muted, ok, warn, err, info, badge, mono, small, big, center, right, box, stat, stat-value, stat-label, callout, callout-title, chip, dot, rows, split, side, num, table, bar, chart, chart-row, chart-label, chart-value, stack, seg, columns, col, col-track, col-bar, col-label, flow, flow-col, step, step-title), com o prefixo oc- do render nativo do OpenChamber tamb\xE9m valendo; data-tone (neutral|info|success|warning|error: colore badge, chip, stat, callout, step, bar, seg); data-value (0 a 100, para bar/seg/col-bar); title, colspan, rowspan e data-canvas-item="<id>" para marcar um elemento que o usu\xE1rio pode adicionar ao contexto, comentar e filtrar (id [a-z0-9-], \xFAnico); data-group="<nome>" agrupa itens para o filtro do painel.',
  "O painel mostra sozinho um filtro de texto/grupo quando h\xE1 6+ itens marcados. Prefira fluxogramas (flow/step) e gr\xE1ficos (chart, stack, columns) quando ajudarem a entender.",
  'Visual que o HTML acima n\xE3o cobre (gr\xE1fico de linhas, SVG, diagrama complexo, interatividade): passe `embeds` ([{ id, html }]; HTML completo com style/script/svg, em iframe isolado sem rede, at\xE9 8 partes) e use <div data-embed="<id>" data-height="<px opcional>">texto equivalente</div> no html.',
  "Sem script, style, link, imagem, iframe, formul\xE1rio nem atributo on*/src/style no `html`: isso \xE9 removido e informado no retorno. HTML malformado \xE9 recusado e o canvas anterior permanece."
].join(" ");
var index_default = {
  id: "openchamber-canvas-viewer",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "canvas_publish",
        description: DESCRIPTION,
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            html: { type: "string", description: `HTML do canvas (at\xE9 ${LIMITS.htmlChars} caracteres)` },
            title: { type: "string", description: `T\xEDtulo curto do canvas (at\xE9 ${LIMITS.titleChars} caracteres)` },
            embeds: {
              type: "array",
              description: `Partes incorporadas (at\xE9 ${LIMITS.embeds}): HTML completo, desenhado num iframe isolado sem rede; referenciado no html por <div data-embed="id">`,
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Id [a-z0-9-], at\xE9 40 caracteres, igual ao data-embed do html" },
                  html: { type: "string", description: `HTML da parte (at\xE9 ${LIMITS.embedChars} caracteres; style, script e svg valem)` }
                },
                required: ["id", "html"],
                additionalProperties: false
              }
            }
          },
          required: ["html"],
          additionalProperties: false
        },
        async execute(input, context) {
          const { html, title, embeds } = input && typeof input === "object" ? input : {};
          if (!SESSION_ID_PATTERN.test(String(context?.sessionID ?? ""))) {
            return { content: "Canvas N\xC3O publicado: sess\xE3o desconhecida." };
          }
          const built = buildSnapshot(title, html, Date.now(), embeds);
          if (!built.ok) return { content: `Canvas N\xC3O publicado: ${built.message}. O canvas anterior foi mantido; corrija e publique de novo.` };
          const payload = {
            v: INBOX_SCHEMA_VERSION,
            sessionId: context.sessionID,
            title: built.snapshot.title,
            html: String(html),
            ...Object.keys(built.snapshot.embeds).length ? { embeds: Object.entries(built.snapshot.embeds).map(([id, body]) => ({ id, html: body })) } : {}
          };
          const target = inboxFile(context.sessionID);
          await mkdir(inboxDir(), { recursive: true });
          const tmp = `${target}.${randomUUID()}.tmp`;
          await writeFile(tmp, JSON.stringify(payload), "utf8");
          await rename(tmp, target);
          const blocked = built.snapshot.blocked.length ? ` Avisos (removido por seguran\xE7a ou ajustado): ${built.snapshot.blocked.join(", ")}.` : "";
          return { content: `Canvas publicado e vis\xEDvel no painel.${blocked}` };
        }
      });
    });
  }
};
export {
  index_default as default
};
