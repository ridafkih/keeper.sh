import { describe, expect, it } from "vitest";
import { resolveGraphSlotIndex } from "../../src/state/event-graph-hover";

describe("resolveGraphSlotIndex", () => {
  it("maps today to the centre slot", () => {
    expect(resolveGraphSlotIndex(0)).toBe(7);
  });

  it("maps the window edges to the first and last slots", () => {
    expect(resolveGraphSlotIndex(-7)).toBe(0);
    expect(resolveGraphSlotIndex(7)).toBe(14);
  });

  it("returns null outside the window", () => {
    expect(resolveGraphSlotIndex(-8)).toBeNull();
    expect(resolveGraphSlotIndex(8)).toBeNull();
  });
});
