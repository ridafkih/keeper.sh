import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  calendarHighlightSlotAtom,
  eventGraphHoverIndexAtom,
  eventGraphPointerAtom,
  resolveGraphSlotIndex,
} from "../../src/state/event-graph-hover";

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

describe("calendarHighlightSlotAtom", () => {
  it("ignores a hover index the sidebar graph is not pointing at", () => {
    const store = createStore();
    store.set(eventGraphHoverIndexAtom, 9);
    expect(store.get(calendarHighlightSlotAtom)).toBeNull();
  });

  it("follows the hover index only while the pointer is over the graph", () => {
    const store = createStore();
    store.set(eventGraphHoverIndexAtom, 9);
    store.set(eventGraphPointerAtom, true);
    expect(store.get(calendarHighlightSlotAtom)).toBe(9);
    store.set(eventGraphPointerAtom, false);
    expect(store.get(calendarHighlightSlotAtom)).toBeNull();
  });
});
