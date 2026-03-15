import { describe, expect, it } from "bun:test";
import { createStore } from "jotai";
import {
  syncStateAtom,
  syncStatusLabelAtom,
  syncStatusShimmerAtom,
} from "./sync";

describe("sync status atoms", () => {
  it("does not report up-to-date before first aggregate payload", () => {
    const store = createStore();
    store.set(syncStateAtom, {
      connected: true,
      hasReceivedAggregate: false,
      lastSyncedAt: null,
      progressPercent: 100,
      seq: 0,
      state: "idle",
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
    });

    expect(store.get(syncStatusLabelAtom)).toBe("Connecting");
    expect(store.get(syncStatusShimmerAtom)).toBe(true);
  });

  it("reports up-to-date only after a real aggregate payload", () => {
    const store = createStore();
    store.set(syncStateAtom, {
      connected: true,
      hasReceivedAggregate: true,
      lastSyncedAt: "2026-03-08T12:00:00.000Z",
      progressPercent: 100,
      seq: 4,
      state: "idle",
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
    });

    expect(store.get(syncStatusLabelAtom)).toBe("Up to Date");
    expect(store.get(syncStatusShimmerAtom)).toBe(false);
  });
});
