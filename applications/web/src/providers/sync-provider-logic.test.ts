import { describe, expect, it } from "bun:test";
import type { CompositeSyncState, SyncAggregateData } from "@/state/sync";
import {
  parseIncomingSocketAction,
  shouldAcceptAggregatePayload,
} from "./sync-provider-logic";

const createCurrentState = (
  overrides: Partial<CompositeSyncState> = {},
): CompositeSyncState => ({
  connected: true,
  hasReceivedAggregate: true,
  lastSyncedAt: "2026-03-08T12:00:00.000Z",
  progressPercent: 30,
  seq: 8,
  state: "syncing",
  syncEventsProcessed: 3,
  syncEventsRemaining: 7,
  syncEventsTotal: 10,
  ...overrides,
});

const createAggregate = (
  overrides: Partial<SyncAggregateData> = {},
): SyncAggregateData => ({
  lastSyncedAt: "2026-03-08T12:01:00.000Z",
  progressPercent: 40,
  seq: 9,
  syncing: true,
  syncEventsProcessed: 4,
  syncEventsRemaining: 6,
  syncEventsTotal: 10,
  ...overrides,
});

describe("parseIncomingSocketAction", () => {
  it("returns reconnect for invalid json before first aggregate", () => {
    expect(parseIncomingSocketAction("{ bad")).toEqual({ kind: "reconnect" });
  });

  it("returns reconnect for invalid json after first aggregate has been received", () => {
    expect(parseIncomingSocketAction("{ bad")).toEqual({ kind: "reconnect" });
  });

  it("responds to ping frames with pong action", () => {
    expect(
      parseIncomingSocketAction(JSON.stringify({ event: "ping" })),
    ).toEqual({ kind: "pong" });
  });

  it("ignores unknown event frames", () => {
    expect(
      parseIncomingSocketAction(
        JSON.stringify({ data: { value: true }, event: "unrelated:event" }),
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("returns reconnect for invalid sync aggregate payload before initialization", () => {
    expect(
      parseIncomingSocketAction(
        JSON.stringify({ data: { seq: "bad" }, event: "sync:aggregate" }),
      ),
    ).toEqual({ kind: "reconnect" });
  });

  it("returns aggregate action for valid sync aggregate payload", () => {
    const payload = createAggregate();

    expect(
      parseIncomingSocketAction(
        JSON.stringify({ data: payload, event: "sync:aggregate" }),
      ),
    ).toEqual({
      data: payload,
      kind: "aggregate",
    });
  });
});

describe("shouldAcceptAggregatePayload", () => {
  it("accepts strictly newer sequence numbers", () => {
    const decision = shouldAcceptAggregatePayload(
      createCurrentState(),
      8,
      createAggregate({ seq: 9 }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.nextSeq).toBe(9);
  });

  it("accepts non-increasing sequence when it still shows forward progress", () => {
    const decision = shouldAcceptAggregatePayload(
      createCurrentState(),
      8,
      createAggregate({ seq: 8, syncEventsProcessed: 5, syncEventsRemaining: 5 }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.nextSeq).toBe(8);
  });

  it("accepts lower sequence when a new sync cycle starts", () => {
    const current = createCurrentState({
      progressPercent: 100,
      seq: 25,
      state: "idle",
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
    });

    const decision = shouldAcceptAggregatePayload(
      current,
      25,
      createAggregate({
        lastSyncedAt: current.lastSyncedAt,
        progressPercent: 0,
        seq: 1,
        syncing: true,
        syncEventsProcessed: 0,
        syncEventsRemaining: 12,
        syncEventsTotal: 12,
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.nextSeq).toBe(25);
  });

  it("accepts lower sequence when lastSyncedAt moves forward", () => {
    const current = createCurrentState({
      lastSyncedAt: "2026-03-08T12:00:00.000Z",
      seq: 30,
      state: "idle",
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
    });

    const decision = shouldAcceptAggregatePayload(
      current,
      30,
      createAggregate({
        lastSyncedAt: "2026-03-08T12:05:00.000Z",
        progressPercent: 100,
        seq: 2,
        syncing: false,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.nextSeq).toBe(30);
  });

  it("rejects non-increasing sequence with no forward progress", () => {
    const current = createCurrentState({
      progressPercent: 40,
      seq: 8,
      syncEventsProcessed: 4,
      syncEventsRemaining: 6,
    });

    const decision = shouldAcceptAggregatePayload(
      current,
      8,
      createAggregate({
        lastSyncedAt: current.lastSyncedAt,
        progressPercent: 40,
        seq: 8,
        syncEventsProcessed: 4,
        syncEventsRemaining: 6,
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.nextSeq).toBe(8);
  });

  it("rejects lower sequence with stale idle payload and no progress", () => {
    const current = createCurrentState({
      progressPercent: 100,
      seq: 50,
      state: "idle",
      syncEventsProcessed: 0,
      syncEventsRemaining: 0,
      syncEventsTotal: 0,
    });

    const decision = shouldAcceptAggregatePayload(
      current,
      50,
      createAggregate({
        lastSyncedAt: current.lastSyncedAt,
        progressPercent: 100,
        seq: 4,
        syncing: false,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.nextSeq).toBe(50);
  });
});
