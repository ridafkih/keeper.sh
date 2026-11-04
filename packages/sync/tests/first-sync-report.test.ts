import { describe, expect, it } from "vitest";
import { countEventsBySource, describeFirstSync } from "../src/first-sync-report";
import type { FirstSyncReport } from "../src/first-sync-report";

const report = (overrides: Partial<FirstSyncReport>): FirstSyncReport => ({
  awaitingSourceCalendarIds: [],
  completedSourceCalendarIds: [],
  eventsAdded: 0,
  eventsAddFailed: 0,
  rejectedSourceCalendarIds: [],
  sourceEventCounts: new Map(),
  ...overrides,
});

describe("describeFirstSync", () => {
  it("reports the events a mapping's first sync copied", () => {
    expect(describeFirstSync(report({
      completedSourceCalendarIds: ["source-1"],
      eventsAdded: 12,
      sourceEventCounts: countEventsBySource(Array.from({ length: 12 }, () => ({ calendarId: "source-1" }))),
    }))).toEqual({
      "first_sync.completed_count": 1,
      "first_sync.completed_source_calendar_ids": "source-1",
      "first_sync.events_added": 12,
      "first_sync.outcome": "copied",
      "first_sync.source_events_in_window": 12,
    });
  });

  it("says a first sync copied nothing because its source had no events in the window", () => {
    expect(describeFirstSync(report({ completedSourceCalendarIds: ["source-1"] }))).toMatchObject({
      "first_sync.empty_source_calendar_ids": "source-1",
      "first_sync.outcome": "source-empty",
    });
  });

  it("says the destination rejected the first sync's writes", () => {
    expect(describeFirstSync(report({
      eventsAddFailed: 4,
      rejectedSourceCalendarIds: ["source-1"],
    }))).toEqual({
      "first_sync.events_add_failed": 4,
      "first_sync.outcome": "destination-rejected",
      "first_sync.rejected_count": 1,
      "first_sync.rejected_source_calendar_ids": "source-1",
    });
  });

  it("names the mapped sources a push could not copy yet because they were never read", () => {
    expect(describeFirstSync(report({ awaitingSourceCalendarIds: ["source-2"] }))).toEqual({
      "first_sync.awaiting_source_calendar_ids": "source-2",
      "first_sync.awaiting_source_count": 1,
    });
  });

  it("adds nothing for a destination whose mappings already had their first sync", () => {
    expect(describeFirstSync(report({}))).toEqual({});
  });
});
