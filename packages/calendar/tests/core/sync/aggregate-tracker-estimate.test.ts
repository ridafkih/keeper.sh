import { describe, expect, it } from "vitest";
import { SyncAggregateTracker } from "../../../src/core/sync/aggregate-tracker";
import type { SyncProgressUpdate } from "../../../src/core/sync/types";

const processing = (
  calendarId: string,
  current: number,
  total: number,
  pace?: SyncProgressUpdate["pace"],
): SyncProgressUpdate => ({
  calendarId,
  inSync: false,
  localEventCount: total,
  remoteEventCount: 0,
  progress: { current, total },
  stage: "processing",
  status: "syncing",
  userId: "user-1",
  ...(pace && { pace }),
});

const GOOGLE = { lane: "google", operationsPerMinute: 350 };
const OUTLOOK = { lane: "outlook", operationsPerMinute: 300 };

describe("SyncAggregateTracker remaining-time estimate", () => {
  it("derives seconds left from the remaining operations and the destination's pace", () => {
    const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

    const message = tracker.trackProgress(processing("cal-1", 300, 1200, OUTLOOK));

    expect(message?.syncSecondsRemaining).toBe(180);
  });

  it("adds up calendars that share a lane and lets separate lanes run side by side", () => {
    const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

    tracker.trackProgress(processing("outlook-1", 0, 600, OUTLOOK));
    tracker.trackProgress(processing("outlook-2", 0, 300, OUTLOOK));
    const message = tracker.trackProgress(processing("google-1", 0, 350, GOOGLE));

    expect(message?.syncSecondsRemaining).toBe(180);
  });

  it("leaves the estimate out while a calendar without a known pace has not finished a chunk", () => {
    const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

    tracker.trackProgress(processing("outlook-1", 0, 600, OUTLOOK));
    const message = tracker.trackProgress(processing("caldav-1", 0, 100));

    expect(message).not.toBeNull();
    expect(message && "syncSecondsRemaining" in message).toBe(false);
  });

  it("paces a calendar without a known ceiling by the throughput it has shown so far", () => {
    const clock = { ms: 0 };
    const tracker = new SyncAggregateTracker({ now: () => clock.ms, progressThrottleMs: 0 });
    tracker.trackProgress(processing("caldav-1", 0, 500));

    clock.ms = 20_000;
    const message = tracker.trackProgress(processing("caldav-1", 100, 500));

    expect(message?.syncSecondsRemaining).toBe(80);
  });

  it("keeps the unfinished operations of a run that ended before finishing", () => {
    const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
    tracker.trackProgress(processing("cal-1", 900, 1200, OUTLOOK));

    const message = tracker.trackDestinationSync({
      calendarId: "cal-1",
      completedSuccessfully: false,
      localEventCount: 1200,
      remoteEventCount: 900,
      userId: "user-1",
    });

    expect(message?.syncEventsRemaining).toBe(300);
    expect(message?.syncSecondsRemaining).toBe(60);
    expect(message?.syncing).toBe(false);
  });

  it("fills a run that finished to its total", () => {
    const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
    tracker.trackProgress(processing("cal-1", 900, 1200, OUTLOOK));

    const message = tracker.trackDestinationSync({
      calendarId: "cal-1",
      completedSuccessfully: true,
      localEventCount: 1200,
      remoteEventCount: 1200,
      userId: "user-1",
    });

    expect(message?.syncEventsRemaining).toBe(0);
    expect(message && "syncSecondsRemaining" in message).toBe(false);
  });
});
