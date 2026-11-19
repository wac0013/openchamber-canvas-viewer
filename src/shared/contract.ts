// Contrato do Canvas: formato do payload agente→plugin→serviço→painel.
// Mudou o formato? Suba SERVICE_VERSION, a versão do package.json e o changelog do README.

/** Versão do contrato do serviço; o painel avisa quando o serviço rodando está desatualizado. */
export const SERVICE_VERSION = 4;

/** Porta fixa do servidor único (livre em 2026-11-17). Uma por máquina; o lock é a própria porta. */
export const SERVER_PORT = 57130;

/** Canvas livre (HTML inteiro) devolvido pelo servidor. `path` é o arquivo que o agente pode editar. */
export type CanvasDoc = { title: string; html: string; updatedAt: number; path: string };

/** Resposta de `GET /canvas?session=<id>`: `rootId` é a sessão raiz dona do canvas; `canvas` é null se ainda não há. */
export type CanvasDocResponse = { ok: true; rootId: string; canvas: CanvasDoc | null; version?: number } | { ok: false; error: string };

/** Resposta de `GET /info` do serviço: endereço para abrir o canvas no navegador (com token de primeira visita). */
export type InfoResponse = { ok: true; url: string } | { ok: false; error: string };

/** Resposta de `GET /health` (única rota aberta). */
export type HealthResponse = { ok: true; version: number };

/** Evento SSE do servidor: o canvas da sessão raiz mudou. */
export type CanvasEvent = { rootId: string; updatedAt: number };

export const LIMITS = {
  titleChars: 120,
  /** Tamanho máximo do arquivo de canvas livre, em bytes (1 MB). */
  canvasBytes: 1_000_000,
  /** Quantidade de itens marcáveis (`data-canvas-item`) lidos do canvas. */
  items: 200,
  /** Texto máximo de um item marcável (limite do `host.attach`). */
  itemTextChars: 16_000,
  /** Texto máximo do canvas inteiro que o runtime devolve ao painel. */
  canvasTextChars: 200_000,
  /** Tamanho máximo de um link (`href`). */
  hrefChars: 2048,
  /** Filtros ativos e itens removidos guardados por canvas. */
  filters: 20,
} as const;

/** Id de sessão aceito em qualquer ponto de entrada (também vira nome de arquivo). */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Id de um elemento marcável (`data-canvas-item`). */
export const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Filtro por clique: `<chave>:<valor>` (também é o token de `data-tags`). */
export const FILTER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}:[A-Za-z0-9_.-]{1,40}$/;

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
