import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  syncStateAtom,
  syncStatusLabelAtom,
  syncStatusShimmerAtom,
} from "../../src/state/sync";
import type { CompositeSyncState } from "../../src/state/sync";

const SETTLED_MAPPINGS = { failingCount: 0, pendingCount: 0, seq: 1 };

const compositeState = (overrides: Partial<CompositeSyncState>): CompositeSyncState => ({
  connected: true,
  hasReceivedAggregate: true,
  lastSyncedAt: "2026-03-08T12:00:00.000Z",
  mappings: SETTLED_MAPPINGS,
  progressPercent: 100,
  seq: 4,
  state: "idle",
  syncEventsProcessed: 0,
  syncEventsRemaining: 0,
  syncEventsTotal: 0,
  ...overrides,
});

const labelFor = (overrides: Partial<CompositeSyncState>): { label: string; shimmer: boolean } => {
  const store = createStore();
  store.set(syncStateAtom, compositeState(overrides));
  return { label: store.get(syncStatusLabelAtom), shimmer: store.get(syncStatusShimmerAtom) };
};

describe("sync status atoms", () => {
  it("does not report up to date before the first aggregate payload", () => {
    expect(labelFor({ hasReceivedAggregate: false })).toEqual({ label: "Connecting", shimmer: true });
  });

  it("does not report up to date before the mapping state arrives", () => {
    expect(labelFor({ mappings: null })).toEqual({ label: "Connecting", shimmer: true });
  });

  it("reports up to date once every mapping has had its first sync", () => {
    expect(labelFor({})).toEqual({ label: "Up to date", shimmer: false });
  });

  it("reports syncing while a new mapping waits for its first sync, though nothing is in flight", () => {
    expect(labelFor({ mappings: { ...SETTLED_MAPPINGS, pendingCount: 1 } }))
      .toEqual({ label: "Syncing", shimmer: true });
  });

  it("reports an error when a mapping cannot read its source or write its destination", () => {
    expect(labelFor({ mappings: { ...SETTLED_MAPPINGS, failingCount: 1, pendingCount: 1 } }))
      .toEqual({ label: "Error", shimmer: false });
  });

  it("reports paused when events remain and nothing is syncing", () => {
    expect(labelFor({ syncEventsRemaining: 3 })).toEqual({ label: "Paused", shimmer: false });
  });
});
