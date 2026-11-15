/**
 * Posição da barra flutuante da seleção, sem DOM (testável). Fica acima do trecho, centralizada
 * nele e sempre contida na janela; sem espaço acima, vai para baixo.
 */

export type Box = { top: number; bottom: number; left: number; right: number };
export type Size = { width: number; height: number };

export type Placement = { top: number; left: number; side: "above" | "below" };

const GAP = 6;
const EDGE = 4;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

export function placeToolbar(selection: Box, viewport: Size, toolbar: Size): Placement {
  const left = clamp((selection.left + selection.right) / 2 - toolbar.width / 2, EDGE, viewport.width - toolbar.width - EDGE);
  const maxTop = viewport.height - toolbar.height - EDGE;
  const above = selection.top - toolbar.height - GAP;
  if (above >= EDGE) return { top: Math.min(above, maxTop), left, side: "above" };
  return { top: clamp(selection.bottom + GAP, EDGE, maxTop), left, side: "below" };
}

/** A seleção só conta como "à vista" se alguma parte dela está dentro da área visível de rolagem. */
export function isInView(selection: Box, area: Box): boolean {
  return selection.bottom > area.top && selection.top < area.bottom;
}
