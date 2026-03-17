import { describe, expect, it } from "bun:test";
import { SyncAggregateTracker } from "./aggregate-tracker";
import type { DestinationSyncResult, SyncProgressUpdate } from "./types";

const createProgressUpdate = (
  overrides: Partial<SyncProgressUpdate> = {},
): SyncProgressUpdate => ({
  calendarId: "cal-1",
  inSync: false,
  localEventCount: 0,
  remoteEventCount: 0,
  stage: "fetching",
  status: "syncing",
  userId: "user-1",
  ...overrides,
});

const createDestinationResult = (
  overrides: Partial<DestinationSyncResult> = {},
): DestinationSyncResult => ({
  calendarId: "cal-1",
  localEventCount: 5,
  remoteEventCount: 5,
  userId: "user-1",
  ...overrides,
});

const requireAggregateMessage = <
  TMessage extends ReturnType<SyncAggregateTracker["trackProgress"]>,
>(
  value: TMessage,
): NonNullable<TMessage> => {
  expect(value).not.toBeNull();
  if (!value) {
    throw new TypeError("Expected aggregate message");
  }
  return value;
};

describe("SyncAggregateTracker", () => {
  describe("getCurrentAggregate", () => {
    it("returns idle snapshot with 100% when no progress tracked", () => {
      const tracker = new SyncAggregateTracker();
      const result = tracker.getCurrentAggregate("user-1");

      expect(result).toEqual({
        progressPercent: 100,
        seq: 0,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
        syncing: false,
      });
    });

    it("uses fallback values when provided and no progress tracked", () => {
      const tracker = new SyncAggregateTracker();
      const result = tracker.getCurrentAggregate("user-1", {
        progressPercent: 50,
        syncEventsProcessed: 5,
        syncEventsRemaining: 5,
        syncEventsTotal: 10,
      });

      expect(result.progressPercent).toBe(50);
      expect(result.syncEventsTotal).toBe(10);
      expect(result.syncing).toBe(false);
    });
  });

  describe("trackProgress", () => {
    it("emits a message on first progress update", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
      const result = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 0, total: 10 } }),
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.syncing).toBe(true);
      expect(aggregateMessage.syncEventsTotal).toBe(10);
      expect(aggregateMessage.syncEventsProcessed).toBe(0);
      expect(aggregateMessage.syncEventsRemaining).toBe(10);
      expect(aggregateMessage.seq).toBe(1);
    });

    it("increments sequence number on each emitted message", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      tracker.trackProgress(
        createProgressUpdate({ progress: { current: 0, total: 10 } }),
      );
      const second = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 5, total: 10 } }),
      );

      const aggregateMessage = requireAggregateMessage(second);
      expect(aggregateMessage.seq).toBe(2);
    });

    it("aggregates progress across multiple calendars", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      tracker.trackProgress(
        createProgressUpdate({
          calendarId: "cal-1",
          progress: { current: 3, total: 10 },
        }),
      );

      const result = tracker.trackProgress(
        createProgressUpdate({
          calendarId: "cal-2",
          progress: { current: 2, total: 5 },
        }),
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.syncEventsProcessed).toBe(5);
      expect(aggregateMessage.syncEventsTotal).toBe(15);
      expect(aggregateMessage.syncEventsRemaining).toBe(10);
    });

    it("clamps processed count to not exceed total", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
      const result = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 15, total: 10 } }),
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.syncEventsProcessed).toBe(10);
      expect(aggregateMessage.syncEventsRemaining).toBe(0);
    });

    it("clamps negative processed count to zero", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
      const result = tracker.trackProgress(
        createProgressUpdate({ progress: { current: -5, total: 10 } }),
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.syncEventsProcessed).toBe(0);
    });

    it("returns null when payload is identical to last emission", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      tracker.trackProgress(
        createProgressUpdate({ progress: { current: 5, total: 10 } }),
      );
      const result = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 5, total: 10 } }),
      );

      expect(result).toBeNull();
    });

    it("throttles syncing progress updates within the throttle window", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 10_000 });

      const first = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 0, total: 10 } }),
      );
      const second = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 5, total: 10 } }),
      );

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("marks status as error when update status is error", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
      tracker.trackProgress(
        createProgressUpdate({
          progress: { current: 3, total: 10 },
          status: "error",
        }),
      );

      const aggregate = tracker.getCurrentAggregate("user-1");
      expect(aggregate.syncing).toBe(false);
    });

    it("shows up-to-date when syncing with zero total", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
      const result = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 0, total: 0 } }),
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.progressPercent).toBe(0);
      expect(aggregateMessage.syncing).toBe(false);
    });

    it("isolates progress between different users", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      tracker.trackProgress(
        createProgressUpdate({
          progress: { current: 5, total: 10 },
          userId: "user-1",
        }),
      );

      tracker.trackProgress(
        createProgressUpdate({
          progress: { current: 2, total: 8 },
          userId: "user-2",
        }),
      );

      const user1 = tracker.getCurrentAggregate("user-1");
      const user2 = tracker.getCurrentAggregate("user-2");

      expect(user1.syncEventsTotal).toBe(10);
      expect(user2.syncEventsTotal).toBe(8);
    });
  });

  describe("trackDestinationSync", () => {
    it("finalizes calendar progress to idle with full completion", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      tracker.trackProgress(
        createProgressUpdate({
          calendarId: "cal-1",
          progress: { current: 5, total: 10 },
        }),
      );

      const result = tracker.trackDestinationSync(
        createDestinationResult({ calendarId: "cal-1" }),
        "2026-03-08T12:00:00.000Z",
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.syncing).toBe(false);
      expect(aggregateMessage.syncEventsProcessed).toBe(10);
      expect(aggregateMessage.syncEventsRemaining).toBe(0);
      expect(aggregateMessage.lastSyncedAt).toBe("2026-03-08T12:00:00.000Z");
    });

    it("keeps syncing true when other calendars are still syncing", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      tracker.trackProgress(
        createProgressUpdate({
          calendarId: "cal-1",
          progress: { current: 5, total: 10 },
        }),
      );
      tracker.trackProgress(
        createProgressUpdate({
          calendarId: "cal-2",
          progress: { current: 2, total: 8 },
        }),
      );

      const result = tracker.trackDestinationSync(
        createDestinationResult({ calendarId: "cal-1" }),
        "2026-03-08T12:00:00.000Z",
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.syncing).toBe(true);
    });

    it("is not throttled like progress updates", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 10_000 });

      tracker.trackProgress(
        createProgressUpdate({
          calendarId: "cal-1",
          progress: { current: 5, total: 10 },
        }),
      );

      const result = tracker.trackDestinationSync(
        createDestinationResult({ calendarId: "cal-1" }),
        "2026-03-08T12:00:00.000Z",
      );

      expect(result).not.toBeNull();
    });
  });

  describe("calculatePercent", () => {
    it("returns 100% when not syncing and total is zero", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      tracker.trackProgress(
        createProgressUpdate({
          calendarId: "cal-1",
          progress: { current: 0, total: 0 },
        }),
      );

      const result = tracker.trackDestinationSync(
        createDestinationResult({ calendarId: "cal-1" }),
        "2026-03-08T12:00:00.000Z",
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.progressPercent).toBe(100);
      expect(aggregateMessage.syncing).toBe(false);
    });

    it("calculates correct percentage for partial progress", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
      const result = tracker.trackProgress(
        createProgressUpdate({ progress: { current: 3, total: 12 } }),
      );

      const aggregateMessage = requireAggregateMessage(result);
      expect(aggregateMessage.progressPercent).toBe(25);
    });
  });
});
