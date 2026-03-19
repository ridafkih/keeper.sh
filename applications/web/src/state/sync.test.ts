import { describe, expect, it } from "bun:test";
import { createStore } from "jotai";
import {
  syncStateAtom,
  syncPendingAtom,
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
      pending: false,
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
      pending: false,
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

  it("shows pending when syncPendingAtom is true", () => {
    const store = createStore();
    store.set(syncStateAtom, {
      connected: true,
      hasReceivedAggregate: true,
      lastSyncedAt: "2026-03-08T12:00:00.000Z",
      pending: false,
      progressPercent: 100,
      seq: 4,
      state: "idle",
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
    });
    store.set(syncPendingAtom, true);

    expect(store.get(syncStatusLabelAtom)).toBe("Pending");
    expect(store.get(syncStatusShimmerAtom)).toBe(true);
  });

  it("shows pending when composite pending is true", () => {
    const store = createStore();
    store.set(syncStateAtom, {
      connected: true,
      hasReceivedAggregate: true,
      lastSyncedAt: "2026-03-08T12:00:00.000Z",
      pending: true,
      progressPercent: 100,
      seq: 4,
      state: "idle",
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
    });

    expect(store.get(syncStatusLabelAtom)).toBe("Pending");
    expect(store.get(syncStatusShimmerAtom)).toBe(true);
  });

  it("shows syncing instead of pending when actively syncing", () => {
    const store = createStore();
    store.set(syncStateAtom, {
      connected: true,
      hasReceivedAggregate: true,
      lastSyncedAt: "2026-03-08T12:00:00.000Z",
      pending: true,
      progressPercent: 50,
      seq: 5,
      state: "syncing",
      syncEventsProcessed: 5,
      syncEventsRemaining: 5,
      syncEventsTotal: 10,
    });
    store.set(syncPendingAtom, true);

    expect(store.get(syncStatusLabelAtom)).toBe("Syncing");
    expect(store.get(syncStatusShimmerAtom)).toBe(true);
  });
});
