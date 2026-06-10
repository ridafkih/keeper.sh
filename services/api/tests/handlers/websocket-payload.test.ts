import { describe, expect, it } from "vitest";
import {
  type SyncAggregateFallbackPayload,
  type SyncAggregatePayload,
  resolveSyncAggregatePayload,
} from "../../src/handlers/websocket-payload";

const createFallbackPayload = (): SyncAggregateFallbackPayload => ({
  lastSyncedAt: "2026-03-08T10:00:00.000Z",
  progressPercent: 100,
  syncEventsProcessed: 0,
  syncEventsRemaining: 0,
  syncEventsTotal: 0,
});

describe("resolveSyncAggregatePayload", () => {
  it("prefers cached aggregate from Redis as cross-process source of truth", async () => {
    const fallbackPayload = createFallbackPayload();

    const resolvedPayload = await resolveSyncAggregatePayload("user-1", fallbackPayload, {
      getCachedSyncAggregate: () => Promise.resolve({
        progressPercent: 100,
        seq: 5,
        syncEventsProcessed: 10,
        syncEventsRemaining: 0,
        syncEventsTotal: 10,
        syncing: false,
      }),
      getCurrentSyncAggregate: () => ({
        progressPercent: 40,
        seq: 6,
        syncEventsProcessed: 4,
        syncEventsRemaining: 6,
        syncEventsTotal: 10,
        syncing: true,
      }),
      isValidSyncAggregate: (_value): _value is SyncAggregatePayload => true,
    });

    expect(resolvedPayload).toEqual({
      progressPercent: 100,
      seq: 5,
      syncEventsProcessed: 10,
      syncEventsRemaining: 0,
      syncEventsTotal: 10,
      syncing: false,
      lastSyncedAt: "2026-03-08T10:00:00.000Z",
    });
  });

  it("uses cached aggregate when current state is idle and cache is valid", async () => {
    const fallbackPayload = createFallbackPayload();

    const resolvedPayload = await resolveSyncAggregatePayload("user-1", fallbackPayload, {
      getCachedSyncAggregate: () => Promise.resolve({
        progressPercent: 90,
        seq: 18,
        syncEventsProcessed: 9,
        syncEventsRemaining: 1,
        syncEventsTotal: 10,
        syncing: false,
      }),
      getCurrentSyncAggregate: () => ({
        progressPercent: 100,
        seq: 19,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
        syncing: false,
      }),
      isValidSyncAggregate: (_value): _value is SyncAggregatePayload => true,
    });

    expect(resolvedPayload).toEqual({
      progressPercent: 90,
      seq: 18,
      syncEventsProcessed: 9,
      syncEventsRemaining: 1,
      syncEventsTotal: 10,
      syncing: false,
      lastSyncedAt: "2026-03-08T10:00:00.000Z",
    });
  });

  it("returns cached syncing aggregate so reconnecting users see active progress", async () => {
    const fallbackPayload = createFallbackPayload();

    const resolvedPayload = await resolveSyncAggregatePayload("user-1", fallbackPayload, {
      getCachedSyncAggregate: () => Promise.resolve({
        progressPercent: 1.6,
        seq: 7027,
        syncEventsProcessed: 47,
        syncEventsRemaining: 2890,
        syncEventsTotal: 2937,
        syncing: true,
      }),
      getCurrentSyncAggregate: () => ({
        progressPercent: 100,
        seq: 7028,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
        syncing: false,
      }),
      isValidSyncAggregate: (_value): _value is SyncAggregatePayload => true,
    });

    expect(resolvedPayload).toEqual({
      progressPercent: 1.6,
      seq: 7027,
      syncEventsProcessed: 47,
      syncEventsRemaining: 2890,
      syncEventsTotal: 2937,
      syncing: true,
      lastSyncedAt: "2026-03-08T10:00:00.000Z",
    });
  });

  it("falls back to current aggregate when cached data is invalid", async () => {
    const fallbackPayload = createFallbackPayload();

    const resolvedPayload = await resolveSyncAggregatePayload("user-1", fallbackPayload, {
      getCachedSyncAggregate: () => Promise.resolve({
        progressPercent: "100%",
      }),
      getCurrentSyncAggregate: () => ({
        progressPercent: 100,
        seq: 33,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
        syncing: false,
      }),
      isValidSyncAggregate: (_value): _value is SyncAggregatePayload => false,
    });

    expect(resolvedPayload).toEqual({
      progressPercent: 100,
      seq: 33,
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
      syncing: false,
    });
  });

  it("keeps cached lastSyncedAt when cache already includes it", async () => {
    const fallbackPayload = createFallbackPayload();

    const resolvedPayload = await resolveSyncAggregatePayload("user-1", fallbackPayload, {
      getCachedSyncAggregate: () => Promise.resolve({
        lastSyncedAt: "2026-03-08T11:00:00.000Z",
        progressPercent: 100,
        seq: 50,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
        syncing: false,
      }),
      getCurrentSyncAggregate: () => ({
        progressPercent: 100,
        seq: 51,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
        syncing: false,
      }),
      isValidSyncAggregate: (_value): _value is SyncAggregatePayload => true,
    });

    expect(resolvedPayload.lastSyncedAt).toBe("2026-03-08T11:00:00.000Z");
  });

  it("returns cached aggregate even when in-memory has remaining events", async () => {
    const fallbackPayload = createFallbackPayload();

    const resolvedPayload = await resolveSyncAggregatePayload("user-1", fallbackPayload, {
      getCachedSyncAggregate: () => Promise.resolve({
        progressPercent: 60,
        seq: 12,
        syncEventsProcessed: 6,
        syncEventsRemaining: 4,
        syncEventsTotal: 10,
        syncing: false,
      }),
      getCurrentSyncAggregate: () => ({
        progressPercent: 30,
        seq: 13,
        syncEventsProcessed: 3,
        syncEventsRemaining: 7,
        syncEventsTotal: 10,
        syncing: false,
      }),
      isValidSyncAggregate: (_value): _value is SyncAggregatePayload => true,
    });

    expect(resolvedPayload).toEqual({
      progressPercent: 60,
      seq: 12,
      syncEventsProcessed: 6,
      syncEventsRemaining: 4,
      syncEventsTotal: 10,
      syncing: false,
      lastSyncedAt: "2026-03-08T10:00:00.000Z",
    });
  });
});
