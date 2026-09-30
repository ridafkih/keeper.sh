import { describe, expect, it } from "vitest";
import type { SyncRunRecord } from "@keeper.sh/data-schemas";
import { buildSyncRunRecords, isWorthLogging } from "../src/sync-run-recording";

const NO_CHANGE = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

const record = (overrides: Partial<SyncRunRecord> = {}): SyncRunRecord => ({
  added: 0,
  copied: 10,
  destinationCalendarId: "personal",
  failed: 0,
  removed: 0,
  sharedDestination: false,
  skipped: 0,
  skippedBy: [],
  ...overrides,
});

describe("buildSyncRunRecords", () => {
  const pairs = [
    { id: "pair-work", sourceCalendarId: "work", syncId: "blocks" },
    { id: "pair-school", sourceCalendarId: "school", syncId: "blocks" },
    { id: "pair-family", sourceCalendarId: "family", syncId: "family" },
  ];
  const sourceOutcomes = {
    family: { copied: 4, skipped: 0, skippedBy: {} },
    school: { copied: 3, skipped: 1, skippedBy: { "skip:all_day": { count: 1, name: "All-day events" } } },
    work: {
      copied: 7,
      skipped: 5,
      skippedBy: {
        "skip:all_day": { count: 2, name: "All-day events" },
        "skip:keywords": { count: 3, name: "Titled words" },
      },
    },
  };

  it("sums each sync's sources and merges what skipped them, most frequent first", () => {
    const records = buildSyncRunRecords(pairs, {
      destinationCalendarId: "personal",
      pausedSourceCalendarIds: new Set(),
      result: { added: 2, addFailed: 0, removed: 1, removeFailed: 0 },
      sourceOutcomes,
    });

    expect(records.get("blocks")).toEqual({
      added: 2,
      copied: 10,
      destinationCalendarId: "personal",
      failed: 0,
      removed: 1,
      sharedDestination: true,
      skipped: 6,
      skippedBy: [
        { count: 3, name: "All-day events", ruleId: "skip:all_day" },
        { count: 3, name: "Titled words", ruleId: "skip:keywords" },
      ],
    });
    expect(records.get("family")).toMatchObject({ copied: 4, sharedDestination: true, skipped: 0 });
  });

  it("leaves paused syncs out of the run", () => {
    const records = buildSyncRunRecords(pairs, {
      destinationCalendarId: "personal",
      pausedSourceCalendarIds: new Set(["family"]),
      result: NO_CHANGE,
      sourceOutcomes,
    });

    expect([...records.keys()]).toEqual(["blocks"]);
    expect(records.get("blocks")?.sharedDestination).toBe(false);
  });
});

describe("isWorthLogging", () => {
  it("logs runs that changed the destination", () => {
    expect(isWorthLogging(record({ added: 1 }), null)).toBe(true);
    expect(isWorthLogging(record({ removed: 1 }), record())).toBe(true);
  });

  it("skips quiet runs", () => {
    expect(isWorthLogging(record(), null)).toBe(false);
    expect(isWorthLogging(record(), record())).toBe(false);
  });

  it("logs the first failure and the recovery, not every failing run", () => {
    expect(isWorthLogging(record({ failed: 2 }), record())).toBe(true);
    expect(isWorthLogging(record({ failed: 2 }), record({ failed: 1 }))).toBe(false);
    expect(isWorthLogging(record(), record({ failed: 1 }))).toBe(true);
  });
});
