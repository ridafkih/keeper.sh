import { describe, expect, it } from "vitest";
import { resolvePanelPlacement, type PanelGeometry } from "../../src/lib/panel-placement";

// A 600px scrollport (8px margins already applied) over 2000px of content, scrolled 500px down.
const geometry = (overrides: Partial<PanelGeometry>): PanelGeometry => ({
  anchorBottom: 334,
  anchorScrolls: true,
  anchorTop: 300,
  height: 140,
  scrollable: 1400,
  scrolled: 500,
  visibleBottom: 600,
  visibleTop: 8,
  ...overrides,
});

describe("resolvePanelPlacement", () => {
  it("centres on the anchor without scrolling when the panel already fits", () => {
    expect(resolvePanelPlacement(geometry({}))).toEqual({ align: "center", delta: 0 });
  });

  it("scrolls just enough to centre the panel when the scroller can move that far", () => {
    expect(resolvePanelPlacement(geometry({ anchorBottom: 64, anchorTop: 30 }))).toEqual({ align: "center", delta: -31 });
    expect(resolvePanelPlacement(geometry({ anchorBottom: 594, anchorTop: 560 }))).toEqual({ align: "center", delta: 47 });
  });

  it("grows down from the anchor at the top of the content, where the scroller can't move up", () => {
    expect(resolvePanelPlacement(geometry({ anchorBottom: 64, anchorTop: 30, scrolled: 0 }))).toEqual({ align: "start", delta: 0 });
  });

  it("grows up from the anchor at the end of the content, where the scroller can't move down", () => {
    expect(resolvePanelPlacement(geometry({ anchorBottom: 594, anchorTop: 560, scrolled: 1400 }))).toEqual({ align: "end", delta: 0 });
  });

  it("clamps the scroll to what's left in that direction", () => {
    const placement = resolvePanelPlacement(geometry({ anchorBottom: 24, anchorTop: -10, height: 300, scrolled: 20 }));
    expect(placement.align).toBe("start");
    expect(placement.delta).toBe(-18);
  });

  it("never scrolls for an anchor a sticky bar holds in place, growing away from the edge instead", () => {
    expect(resolvePanelPlacement(geometry({ anchorBottom: 49, anchorScrolls: false, anchorTop: 15 })))
      .toEqual({ align: "start", delta: 0 });
    expect(resolvePanelPlacement(geometry({ anchorBottom: 596, anchorScrolls: false, anchorTop: 562 })))
      .toEqual({ align: "end", delta: 0 });
    expect(resolvePanelPlacement(geometry({ anchorScrolls: false }))).toEqual({ align: "center", delta: 0 });
  });

  it("picks the roomier side for a pinned anchor when neither side fits the whole panel", () => {
    expect(resolvePanelPlacement(geometry({ anchorBottom: 234, anchorScrolls: false, anchorTop: 200, height: 590 })).align).toBe("start");
    expect(resolvePanelPlacement(geometry({ anchorBottom: 434, anchorScrolls: false, anchorTop: 400, height: 590 })).align).toBe("end");
  });
});
