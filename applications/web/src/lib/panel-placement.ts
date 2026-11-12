export type PanelAlign = "start" | "center" | "end";

export interface PanelGeometry {
  anchorTop: number;
  anchorBottom: number;
  height: number;
  visibleTop: number;
  visibleBottom: number;
  scrolled: number;
  scrollable: number;
  // False when a sticky or fixed ancestor keeps the anchor in place while its scroller moves.
  anchorScrolls: boolean;
}

export interface PanelPlacement {
  align: PanelAlign;
  delta: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const placeInPlace = ({ anchorTop, anchorBottom, height, visibleTop, visibleBottom }: PanelGeometry): PanelAlign => {
  const centredTop = (anchorTop + anchorBottom) / 2 - height / 2;
  if (centredTop >= visibleTop && centredTop + height <= visibleBottom) return "center";
  const roomBelow = visibleBottom - anchorTop;
  const roomAbove = anchorBottom - visibleTop;
  if (roomBelow >= height) return "start";
  if (roomAbove >= height) return "end";
  if (roomBelow >= roomAbove) return "start";
  return "end";
};

// The panel grows out from the anchor's centre, or away from an edge the scroller can't move far enough from.
export function resolvePanelPlacement(geometry: PanelGeometry): PanelPlacement {
  if (!geometry.anchorScrolls) return { align: placeInPlace(geometry), delta: 0 };

  const { anchorTop, anchorBottom, height, visibleTop, visibleBottom, scrolled, scrollable } = geometry;

  const scrollNeeded = (top: number): number => {
    const overTop = top - visibleTop;
    const overBottom = top + height - visibleBottom;
    if (overTop < 0) return overTop;
    return Math.max(0, Math.min(overBottom, overTop));
  };

  const centred = scrollNeeded((anchorTop + anchorBottom) / 2 - height / 2);
  const reachable = centred >= -scrolled && centred <= scrollable - scrolled;

  if (reachable) return { align: "center", delta: clamp(centred, -scrolled, scrollable - scrolled) };
  if (centred < 0) return { align: "start", delta: clamp(scrollNeeded(anchorTop), -scrolled, scrollable - scrolled) };
  return { align: "end", delta: clamp(scrollNeeded(anchorBottom - height), -scrolled, scrollable - scrolled) };
}

// Scrolling only moves the anchor if nothing between it and the scroller pins it in place.
export function anchorMovesWithScroll(anchor: HTMLElement, scroller: HTMLElement | null): boolean {
  for (let node: HTMLElement | null = anchor; node && node !== scroller; node = node.parentElement) {
    const { position } = getComputedStyle(node);
    if (position === "sticky" || position === "fixed") return false;
  }
  return true;
}
