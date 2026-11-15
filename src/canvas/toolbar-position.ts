/**
 * Posição da barra flutuante da seleção, sem DOM (testável). Fica acima do trecho, centralizada
 * nele e contida na janela; sem espaço acima, vai para baixo.
 */

export type Box = { top: number; bottom: number; left: number; right: number };
export type Size = { width: number; height: number };

export type Placement = { top: number; left: number; side: "above" | "below" };

const GAP = 6;
const EDGE = 4;

export function placeToolbar(selection: Box, viewport: Size, toolbar: Size): Placement {
  const centered = (selection.left + selection.right) / 2 - toolbar.width / 2;
  const left = Math.max(EDGE, Math.min(centered, viewport.width - toolbar.width - EDGE));
  const above = selection.top - toolbar.height - GAP;
  if (above >= EDGE) return { top: above, left, side: "above" };
  const below = selection.bottom + GAP;
  return { top: Math.max(EDGE, Math.min(below, viewport.height - toolbar.height - EDGE)), left, side: "below" };
}
