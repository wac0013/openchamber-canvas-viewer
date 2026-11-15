// Contrato do Canvas: formato do payload agente→plugin→serviço→painel.
// Mudou o formato? Suba SERVICE_VERSION, a versão do package.json e o changelog do README.

/** Versão do contrato do serviço; o painel avisa quando o serviço rodando está desatualizado. */
export const SERVICE_VERSION = 1;

/** Versão do formato do arquivo da caixa de entrada (plugin → serviço). */
export const INBOX_SCHEMA_VERSION = 1;

export const LIMITS = {
  /** Tamanho máximo do HTML publicado pelo agente. */
  htmlChars: 200_000,
  titleChars: 120,
  depth: 32,
  nodes: 5000,
  items: 200,
  /** Texto máximo de um item marcável (limite do `host.attach`). */
  itemTextChars: 16_000,
} as const;

/** Id de sessão aceito em qualquer ponto de entrada (também vira nome de arquivo). */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type CanvasText = { t: "text"; v: string };
export type CanvasElement = { t: "el"; tag: string; attrs: Record<string, string>; c: CanvasNode[] };
export type CanvasNode = CanvasText | CanvasElement;

/** Publicação recusada (HTML malformado ou acima dos limites). Nunca reproduz o conteúdo do agente. */
export type CanvasError = { at: number; message: string };

export type CanvasSnapshot = {
  title: string;
  /** Epoch ms da publicação. */
  updatedAt: number;
  tree: CanvasNode[];
  /** O que o sanitizador removeu (script, link, estilo, handler…); o resto do canvas segue funcional. */
  blocked: string[];
};

/** Registro persistido por sessão: só a última versão válida + o último erro. */
export type CanvasRecord = {
  sessionId: string;
  canvas: CanvasSnapshot | null;
  error: CanvasError | null;
};

export type CanvasResponse =
  | { ok: true; version: number; canvas: CanvasSnapshot | null; error: CanvasError | null }
  | { ok: false; error: string };

/** Arquivo que o plugin do OpenCode deposita na caixa de entrada (um por sessão, o mais novo vence). */
export type InboxFile = { v: typeof INBOX_SCHEMA_VERSION; sessionId: string; title: string; html: string };

/** Máximo de avisos de bloqueio guardados por canvas. */
export const BLOCKED_NOTES_MAX = 20;
