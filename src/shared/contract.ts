// Contrato do Canvas: formato do payload agente→plugin→serviço→painel.
// Mudou o formato? Suba SERVICE_VERSION, a versão do package.json e o changelog do README.

/** Versão do contrato do serviço; o painel avisa quando o serviço rodando está desatualizado. */
export const SERVICE_VERSION = 3;

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
  /** Tamanho máximo de um link (`href`). */
  hrefChars: 2048,
  /** Tamanho máximo do valor de `data-group` (filtro por grupo). */
  groupChars: 60,
  /** Quantidade de itens marcáveis a partir da qual o painel oferece o filtro de texto. */
  filterMinItems: 6,
  /** Partes incorporadas (HTML completo em iframe isolado): quantidade, tamanho de cada uma e total. */
  embeds: 8,
  embedChars: 100_000,
  embedsTotalChars: 200_000,
  /** Altura de uma parte incorporada, em px. */
  embedHeightMin: 60,
  embedHeightMax: 1200,
} as const;

/** Tons aceitos em `data-tone` (as cores vêm do tema do OpenChamber). */
export const TONES = ["neutral", "info", "success", "warning", "error"] as const;

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
  /** O que o sanitizador removeu (script, estilo, handler, link inválido…); o resto do canvas segue funcional. */
  blocked: string[];
  /**
   * Partes incorporadas por id (HTML completo, com `<style>`/`<script>`): só o painel as desenha, em
   * iframe `sandbox="allow-scripts"` sem rede. Referenciadas na árvore por `<div data-embed="id">`.
   */
  embeds: Record<string, string>;
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
export type InboxFile = {
  v: typeof INBOX_SCHEMA_VERSION;
  sessionId: string;
  title: string;
  html: string;
  /** Opcional: ausente em arquivos de versões anteriores do plugin. */
  embeds?: Array<{ id: string; html: string }>;
};

/** Máximo de avisos de bloqueio guardados por canvas. */
export const BLOCKED_NOTES_MAX = 20;

/** Identidade dos chips no composer (`providerId` + `id` substitui o chip anterior). */
export const CHIP_PROVIDER_ID = "canvas-viewer";
/** O host exige um `url` não vazio no chip; esta página só descreve a extensão. */
export const CHIP_URL = "https://github.com/wac0013/openchamber-canvas-viewer";
/** Aviso final quando o contexto passa do limite do composer (RN4 da história de contexto). */
export const TRUNCATED_NOTICE = "\n[conteúdo truncado]";

/**
 * Marcador que abre a mensagem enviada pelo botão Atualizar. A skill ensina o agente a reconhecê-lo
 * (há teste que liga os dois): é o pedido formal do usuário para republicar o canvas.
 */
export const UPDATE_REQUEST_MARKER = "[Painel Canvas · Atualizar]";

/** Texto fixo do pedido. Nunca inclui conteúdo do canvas (gerado por agente). */
export const UPDATE_REQUEST_TEXT = `${UPDATE_REQUEST_MARKER} Atualize agora o canvas desta conversa: publique de novo com canvas_publish, refletindo o estado atual do trabalho e mantendo os mesmos ids de elemento. Não repita a visualização no chat; responda só com um resumo curto do que mudou.`;

/** Intervalo mínimo entre dois pedidos para a mesma sessão. */
export const UPDATE_MIN_INTERVAL_MS = 5000;

/** Por que o pedido de atualização não foi enviado. Só categorias: nunca eco de conteúdo. */
export type UpdateRequestCode = "busy" | "waiting" | "too-soon" | "not-granted" | "host-refused" | "invalid-session" | "unconfirmed";

export type UpdateRequestResponse = { ok: true } | { ok: false; code: UpdateRequestCode };
