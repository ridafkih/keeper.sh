import { describe, expect, it } from "bun:test";
import type { CompositeSyncState } from "@/state/sync";
import { resolveSyncPercent } from "../../../../src/features/dashboard/components/sync-status-helpers";

const createComposite = (
  overrides: Partial<CompositeSyncState> = {},
): CompositeSyncState => ({
  connected: true,
  hasReceivedAggregate: true,
  lastSyncedAt: "2026-03-08T12:00:00.000Z",
  progressPercent: 50,
  seq: 2,
  state: "syncing",
  syncEventsProcessed: 5,
  syncEventsRemaining: 5,
  syncEventsTotal: 10,
  ...overrides,
});

describe("resolveSyncPercent", () => {
  it("returns null before first aggregate is received", () => {
    const percent = resolveSyncPercent(
      createComposite({
        hasReceivedAggregate: false,
        progressPercent: 100,
        state: "idle",
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
      }),
    );

    expect(percent).toBeNull();
  });

  it("returns derived completion from processed/total when total is available", () => {
    const percent = resolveSyncPercent(
      createComposite({
        syncEventsProcessed: 2,
        syncEventsTotal: 8,
      }),
    );

    expect(percent).toBe(25);
  });

  it("returns 100 when idle and aggregate reports no remaining work", () => {
    const percent = resolveSyncPercent(
      createComposite({
        progressPercent: 100,
        state: "idle",
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
      }),
    );

    expect(percent).toBe(100);
  });
});
