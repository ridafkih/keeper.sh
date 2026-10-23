import { describe, expect, it } from "vitest";
import type { SyncRunRecord } from "@keeper.sh/data-schemas";
import { isWorthLogging, planSyncFailure, planSyncRun } from "../src/sync-run-recording";
import type { DestinationPair, SyncRunRecordingInput } from "../src/sync-run-recording";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const MINUTE_MS = 60 * 1000;

const pair = (overrides: Partial<DestinationPair> & Pick<DestinationPair, "sourceCalendarId" | "syncId">): DestinationPair => ({
  copiedCount: 0,
  failedCount: 0,
  id: `pair-${overrides.sourceCalendarId}`,
  lastErrorAt: null,
  lastSyncedAt: null,
  paused: false,
  skippedBy: [],
  skippedCount: 0,
  ...overrides,
});

const input = (overrides: Partial<SyncRunRecordingInput> = {}): SyncRunRecordingInput => ({
  destinationCalendarId: "family",
  pausedSourceCalendarIds: new Set(),
  readSourceCalendarIds: new Set(["work", "school"]),
  sourceOutcomes: {},
  sourceTallies: {},
  ...overrides,
});

const record = (overrides: Partial<SyncRunRecord> = {}): SyncRunRecord => ({
  added: 0,
  copied: 10,
  destinationCalendarId: "family",
  failed: 0,
  removed: 0,
  skipped: 0,
  skippedBy: [],
  ...overrides,
});

describe("planSyncRun", () => {
  // Work → {Personal, Family} and School → {Family}: two syncs share Family.
  const shared = [
    pair({ sourceCalendarId: "work", syncId: "work-sync" }),
    pair({ sourceCalendarId: "school", syncId: "school-sync" }),
  ];

  it("credits each sync on a shared destination with only what its own sources did", () => {
    const plan = planSyncRun(shared, input({
      sourceOutcomes: {
        school: { copied: 3, skipped: 0, skippedBy: {} },
        work: { copied: 7, skipped: 0, skippedBy: {} },
      },
      sourceTallies: {
        school: { added: 0, failed: 0, removed: 2, updated: 0 },
        work: { added: 12, failed: 0, removed: 0, updated: 5 },
      },
    }), NOW);

    expect(plan.runs).toEqual([
      { record: record({ added: 12, copied: 7 }), syncId: "work-sync" },
      { record: record({ copied: 3, removed: 2 }), syncId: "school-sync" },
    ]);
  });

  it("credits nobody for removals whose pair is already gone", () => {
    const plan = planSyncRun([pair({ sourceCalendarId: "school", syncId: "school-sync" })], input({
      sourceTallies: { work: { added: 0, failed: 0, removed: 40, updated: 0 } },
    }), NOW);

    expect(plan.runs).toEqual([]);
  });

  it("doesn't log updates as new copies", () => {
    const plan = planSyncRun(shared, input({
      sourceTallies: { work: { added: 0, failed: 0, removed: 0, updated: 500 } },
    }), NOW);

    expect(plan.runs).toEqual([]);
  });

  it("stores each pair's skip reasons next to its skip count, most frequent first", () => {
    const plan = planSyncRun(shared, input({
      sourceOutcomes: {
        work: {
          copied: 7,
          skipped: 5,
          skippedBy: {
            "skip:all_day": { count: 2, name: "All-day events" },
            "skip:keywords": { count: 3, name: "Titled words" },
          },
        },
      },
    }), NOW);

    expect(plan.pairUpdates.find(({ id }) => id === "pair-work")).toEqual({
      copiedCount: 7,
      failedCount: 0,
      id: "pair-work",
      lastSyncedAt: NOW,
      skippedBy: [
        { count: 3, name: "Titled words", ruleId: "skip:keywords" },
        { count: 2, name: "All-day events", ruleId: "skip:all_day" },
      ],
      skippedCount: 5,
    });
  });

  it("leaves pairs whose source wasn't read as they were", () => {
    const stored = pair({ copiedCount: 40, lastSyncedAt: new Date(NOW.getTime() - 60 * MINUTE_MS), sourceCalendarId: "work", syncId: "work-sync" });
    const plan = planSyncRun([stored], input({ readSourceCalendarIds: new Set() }), NOW);

    expect(plan.pairUpdates).toEqual([]);
  });

  it("stamps a read pair's lastSyncedAt every run, even when nothing else changed", () => {
    const recent = new Date(NOW.getTime() - MINUTE_MS);
    const plan = planSyncRun(
      [pair({ copiedCount: 7, lastSyncedAt: recent, sourceCalendarId: "work", syncId: "work-sync" })],
      input({ sourceOutcomes: { work: { copied: 7, skipped: 0, skippedBy: {} } } }),
      NOW,
    );

    expect(plan.pairUpdates).toMatchObject([{ copiedCount: 7, id: "pair-work", lastSyncedAt: NOW }]);
  });

  it("leaves paused syncs out entirely", () => {
    const plan = planSyncRun(
      [...shared, pair({ paused: true, sourceCalendarId: "camp", syncId: "camp-sync" })],
      input({
        pausedSourceCalendarIds: new Set(["school"]),
        readSourceCalendarIds: new Set(["work", "school", "camp"]),
        sourceTallies: {
          camp: { added: 0, failed: 0, removed: 3, updated: 0 },
          school: { added: 0, failed: 0, removed: 3, updated: 0 },
        },
      }),
      NOW,
    );

    expect(plan.pairUpdates.map(({ id }) => id)).toEqual(["pair-work"]);
    expect(plan.runs).toEqual([]);
  });

  it("logs a recovery once a failing pair's run completes cleanly", () => {
    const plan = planSyncRun(
      [pair({ lastErrorAt: new Date(NOW.getTime() - MINUTE_MS), sourceCalendarId: "work", syncId: "work-sync" })],
      input(),
      NOW,
    );

    expect(plan.pairUpdates).toMatchObject([{ failedCount: 0, id: "pair-work" }]);
    expect(plan.runs).toEqual([{ record: record({ copied: 0 }), syncId: "work-sync" }]);
  });
});

describe("planSyncFailure", () => {
  it("logs a failed run for each sync that wasn't already failing", () => {
    const runs = planSyncFailure("family", [
      pair({ copiedCount: 7, sourceCalendarId: "work", syncId: "work-sync" }),
      pair({ failedCount: 2, sourceCalendarId: "school", syncId: "school-sync" }),
    ]);

    expect(runs).toEqual([{ record: record({ copied: 7, failed: 1 }), syncId: "work-sync" }]);
  });
});

describe("isWorthLogging", () => {
  it("logs runs that changed the destination", () => {
    expect(isWorthLogging(record({ added: 1 }), false)).toBe(true);
    expect(isWorthLogging(record({ removed: 1 }), false)).toBe(true);
  });

  it("skips quiet runs", () => {
    expect(isWorthLogging(record(), false)).toBe(false);
  });

  it("logs the first failure and the recovery, not every failing run", () => {
    expect(isWorthLogging(record({ failed: 2 }), false)).toBe(true);
    expect(isWorthLogging(record({ failed: 2 }), true)).toBe(false);
    expect(isWorthLogging(record(), true)).toBe(true);
  });
});
