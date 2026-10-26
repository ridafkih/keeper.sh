import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SETTINGS, compileSyncRules } from "@keeper.sh/data-schemas";
import {
  excludeWithdrawnInstances,
  isEventInDestinationReconciliationWindow,
  projectDestinationEvents,
  projectSyncableEvent,
  shouldExcludeSyncEvent,
} from "../../../src/core/events/events";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import type { DestinationEventRow } from "../../../src/core/events/events";
import type { SyncableEvent } from "../../../src/core/types";

const createEvent = (overrides: Partial<{
  excludeAllDayEvents: boolean;
  excludeAvailabilities: string[];
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  excludeTitleKeywords: string[];
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
  title: string | null;
}> = {}) => ({
  availability: "busy",
  excludeAllDayEvents: false,
  excludeAvailabilities: [],
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeTitleKeywords: [],
  isAllDay: false,
  sourceEventType: "default",
  title: "Weekly planning",
  ...overrides,
});

describe("shouldExcludeSyncEvent", () => {
  it("always excludes working location events", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          sourceEventType: "workingLocation",
        }),
      ),
    ).toBe(true);
  });

  it("excludes focus time events when configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeFocusTime: true,
          sourceEventType: "focusTime",
        }),
      ),
    ).toBe(true);
  });

  it("excludes out of office events when configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeOutOfOffice: true,
          sourceEventType: "outOfOffice",
        }),
      ),
    ).toBe(true);
  });

  it("excludes all-day events when configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAllDayEvents: true,
          isAllDay: true,
        }),
      ),
    ).toBe(true);
  });

  it("keeps default events in sync", () => {
    expect(shouldExcludeSyncEvent(createEvent())).toBe(false);
  });

  it("treats legacy workingElsewhere rows as working location", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "workingElsewhere",
          sourceEventType: null,
        }),
      ),
    ).toBe(true);
  });

  it("excludes events whose availability is an excluded status", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "free",
          excludeAvailabilities: ["free"],
        }),
      ),
    ).toBe(true);
  });

  it("keeps events whose availability is not an excluded status", () => {
    expect(shouldExcludeSyncEvent(createEvent({ excludeAvailabilities: ["free"] }))).toBe(false);
  });

  it("treats events without a stored availability as busy", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: null,
          excludeAvailabilities: ["busy"],
        }),
      ),
    ).toBe(true);
  });

  it("excludes tentative events when tentative is an excluded status", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAvailabilities: ["tentative"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(true);
  });

  it("excludes free tentative events when only free is excluded", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "free",
          excludeAvailabilities: ["free"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(true);
  });

  it("keeps busy tentative events when only free is excluded", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAvailabilities: ["free"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(false);
  });

  it("keeps tentative events when only busy is excluded", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAvailabilities: ["busy"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(false);
  });

  it("excludes events whose title contains any of the keywords, ignoring case", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeTitleKeywords: ["placeholder", "ZOOM room"],
          title: "Daily Zoom ROOM",
        }),
      ),
    ).toBe(true);
  });

  it("keeps events whose title contains none of the keywords", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeTitleKeywords: ["zoom room", "placeholder"],
          title: "Weekly planning",
        }),
      ),
    ).toBe(false);
  });

  it("keeps untitled events when keywords are configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeTitleKeywords: ["zoom room"],
          title: null,
        }),
      ),
    ).toBe(false);
  });

  it("treats legacy oof rows as out of office", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "oof",
          excludeOutOfOffice: true,
          sourceEventType: null,
        }),
      ),
    ).toBe(true);
  });
});

describe("isEventInDestinationReconciliationWindow", () => {
  const timeMin = new Date("2026-07-10T00:00:00.000Z");

  it("includes an event that starts before the boundary but overlaps it", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-07-10T01:00:00.000Z"),
      startTime: new Date("2026-07-09T23:00:00.000Z"),
    }, timeMin)).toBe(true);
  });

  it("includes ordinary events arbitrarily far in the future", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
      startTime: new Date("2040-03-15T09:00:00.000Z"),
    }, timeMin)).toBe(true);
  });

  it("excludes events that ended before the boundary", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-07-09T23:59:59.999Z"),
      startTime: new Date("2026-07-09T22:00:00.000Z"),
    }, timeMin)).toBe(false);
  });

  it("includes an inverted event whose start is past the boundary but whose end is not", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-01-01T00:00:00.000Z"),
      startTime: new Date("2026-08-01T00:00:00.000Z"),
    }, timeMin)).toBe(true);
  });

  it("excludes an inverted event whose start is also before the boundary", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-01-01T00:00:00.000Z"),
      startTime: new Date("2026-02-01T00:00:00.000Z"),
    }, timeMin)).toBe(false);
  });
});

describe("destination reconciliation source selection", () => {
  it("never narrows the mapped source calendars by availability", async () => {
    const source = await Bun.file(
      `${import.meta.dirname}/../../../src/core/events/events.ts`,
    ).text();

    expect(source).toContain("getMappedSourceCalendarIds");
    expect(source).not.toContain("unavailableSince");
  });
});

const busyOnly = compileSyncRules(DEFAULT_SYNC_SETTINGS).at(-1);
if (!busyOnly) {
  throw new Error("compileSyncRules always ends with Share As");
}

const createRow = (overrides: Partial<Parameters<typeof projectSyncableEvent>[0]> = {}) => ({
  availability: "busy",
  calendarName: "Work",
  description: "Agenda",
  isAllDay: false,
  location: "Room 4",
  sourceEventType: "default",
  title: "Daily Standup",
  ...overrides,
});

describe("projectSyncableEvent", () => {

  it("skips events by status the way per-calendar exclusions did", () => {
    const rules = compileSyncRules({ ...DEFAULT_SYNC_SETTINGS, skipAvailabilities: ["free", "tentative"] });
    expect(projectSyncableEvent(createRow({ availability: "free" }), rules))
      .toEqual({ outcome: "skipped", ruleId: "skip:availability" });
    expect(projectSyncableEvent(createRow({ sourceEventType: "tentative" }), rules))
      .toEqual({ outcome: "skipped", ruleId: "skip:availability" });
    expect(projectSyncableEvent(createRow({ availability: null }), rules))
      .toEqual({ outcome: "copy", summary: "Work" });
  });

  it("doesn't count a tentative event as busy", () => {
    const rules = compileSyncRules({ ...DEFAULT_SYNC_SETTINGS, skipAvailabilities: ["busy"] });
    expect(projectSyncableEvent(createRow({ sourceEventType: "tentative" }), rules))
      .toEqual({ outcome: "copy", summary: "Work" });
    expect(projectSyncableEvent(createRow({ availability: null }), rules))
      .toEqual({ outcome: "skipped", ruleId: "skip:availability" });
  });

  it("copies nothing when no rule is assigned to the source", () => {
    expect(projectSyncableEvent(createRow(), [])).toEqual({ outcome: "unmatched" });
  });

  it("still drops working location events before consulting rules", () => {
    expect(projectSyncableEvent(createRow({ sourceEventType: "workingLocation" }), [busyOnly]))
      .toEqual({ outcome: "working_location" });
  });

  it("reproduces the legacy default projection with the default rule", () => {
    expect(projectSyncableEvent(createRow(), [busyOnly])).toEqual({
      outcome: "copy",
      summary: "Work",
    });
  });

  it("applies the first matching rule and reports skips", () => {
    const rules = [
      { actions: [{ kind: "skip" as const }], conditions: [{ kind: "focus_time" as const }], id: "rule-skip", match: "all" as const, name: "Skip focus time" },
      {
        actions: [{ kind: "rename" as const, template: "OOO" }, { kind: "mark_private" as const }],
        conditions: [{ kind: "title_contains" as const, value: "standup" }],
        id: "rule-ooo",
        match: "all" as const,
        name: "Standup to OOO",
      },
      busyOnly,
    ];

    expect(projectSyncableEvent(createRow({ sourceEventType: "focusTime" }), rules)).toEqual({ outcome: "skipped", ruleId: "rule-skip" });
    expect(projectSyncableEvent(createRow(), rules)).toEqual({
      description: "Agenda",
      isPrivate: true,
      location: "Room 4",
      outcome: "copy",
      summary: "OOO",
    });
    expect(projectSyncableEvent(createRow({ title: "Lunch" }), rules)).toEqual({ outcome: "copy", summary: "Work" });
  });
});

describe("excludeWithdrawnInstances", () => {
  const window = { end: new Date("2026-02-01T00:00:00.000Z"), start: new Date("2026-01-01T00:00:00.000Z") };
  const master: SyncableEvent = {
    calendarId: "calendar-1",
    calendarName: "Work",
    calendarUrl: null,
    endTime: new Date("2026-01-05T10:00:00.000Z"),
    id: "master",
    recurrenceRule: { count: 4, frequency: "WEEKLY" },
    sourceEventUid: "team-sync",
    startTime: new Date("2026-01-05T09:00:00.000Z"),
    summary: "Team sync",
  };
  // The edited 12 January instance ("Team sync – HR review") was skipped by a title rule.
  const skippedEdit = { calendarId: "calendar-1", recurrenceId: new Date("2026-01-12T09:00:00.000Z"), sourceEventUid: "team-sync" };
  const starts = (events: SyncableEvent[]) =>
    materializeRecurrenceEvents(events, window).map((event) => event.startTime.toISOString());

  it("keeps the series from filling a skipped edit's slot with its original occurrence", () => {
    expect(starts([master])).toContain("2026-01-12T09:00:00.000Z");
    expect(starts(excludeWithdrawnInstances([master], [skippedEdit]))).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-19T09:00:00.000Z",
      "2026-01-26T09:00:00.000Z",
    ]);
  });

  it("leaves other series and other calendars' series alone", () => {
    const otherSeries = { ...master, id: "other", sourceEventUid: "standup" };
    const otherCalendar = { ...master, calendarId: "calendar-2", id: "elsewhere" };
    const [, untouchedSeries, untouchedCalendar] = excludeWithdrawnInstances([master, otherSeries, otherCalendar], [skippedEdit]);

    expect(untouchedSeries).toBe(otherSeries);
    expect(untouchedCalendar).toBe(otherCalendar);
  });
});

const row = (overrides: Partial<DestinationEventRow> & Pick<DestinationEventRow, "id">): DestinationEventRow => ({
  availability: "busy",
  calendarId: "work",
  calendarName: "Work",
  calendarUrl: null,
  description: null,
  endTime: new Date("2026-01-05T13:00:00.000Z"),
  exceptionDates: null,
  isAllDay: false,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventType: "default",
  sourceEventUid: `uid-${overrides.id}`,
  startTime: new Date("2026-01-05T12:00:00.000Z"),
  startTimeZone: null,
  title: "Planning",
  ...overrides,
});

describe("projectDestinationEvents", () => {
  const syncWindow = { timeMax: new Date("2026-02-01T00:00:00.000Z"), timeMin: new Date("2026-01-01T00:00:00.000Z") };
  const skipLunch = {
    actions: [{ kind: "skip" as const }],
    conditions: [{ kind: "title_contains" as const, value: "lunch" }],
    id: "skip:keywords",
    match: "all" as const,
    name: "Titled words",
  };
  const rules = new Map([["work", [skipLunch, busyOnly]]]);
  const daily = JSON.stringify({ count: 10, frequency: "DAILY" });

  it("counts skips in the same units as copies: occurrences inside the window", () => {
    const { diagnostics, events } = projectDestinationEvents([
      row({ id: "standup", recurrenceRule: daily, title: "Standup" }),
      row({ id: "lunch", recurrenceRule: daily, title: "Lunch" }),
      row({ endTime: new Date("2026-06-01T13:00:00.000Z"), id: "lunch-later", startTime: new Date("2026-06-01T12:00:00.000Z"), title: "Lunch" }),
      row({ endTime: new Date("2025-06-01T13:00:00.000Z"), id: "lunch-earlier", startTime: new Date("2025-06-01T12:00:00.000Z"), title: "Lunch" }),
    ], rules, syncWindow);

    expect(events).toHaveLength(10);
    expect(diagnostics.sourceOutcomes).toEqual({
      work: { copied: 10, skipped: 10, skippedBy: { "skip:keywords": { count: 10, name: "Titled words" } } },
    });
  });

  it("doesn't count a skipped series' slot that a copied edit took over", () => {
    const { diagnostics, events } = projectDestinationEvents([
      row({ id: "lunch", recurrenceRule: daily, title: "Lunch" }),
      row({
        endTime: new Date("2026-01-07T14:00:00.000Z"),
        id: "lunch-moved",
        recurrenceId: new Date("2026-01-07T12:00:00.000Z"),
        sourceEventUid: "uid-lunch",
        startTime: new Date("2026-01-07T13:00:00.000Z"),
        title: "Customer visit",
      }),
    ], rules, syncWindow);

    expect(events).toHaveLength(1);
    expect(diagnostics.sourceOutcomes.work).toMatchObject({ copied: 1, skipped: 9 });
  });
});
