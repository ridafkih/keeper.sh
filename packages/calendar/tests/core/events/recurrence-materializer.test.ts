import { describe, expect, it } from "vitest";
import {
  findSourceEventsExceedingRecurrenceBudget,
  materializeRecurrenceEvents,
  RecurrenceMaterializationLimitError,
} from "../../../src/core/events/recurrence-materializer";
import type { SourceEvent, SyncableEvent } from "../../../src/core/types";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";
import {
  parseStoredRecurrenceForMaterialization,
  serializeStoredIcsRecurrenceRule,
} from "../../../src/core/events/stored-recurrence";

const WINDOW = {
  end: new Date("2026-02-01T00:00:00.000Z"),
  start: new Date("2026-01-01T00:00:00.000Z"),
};

const EXPIRED_SERIES_BUDGET_MS = 50;

const createEvent = (overrides: Partial<SyncableEvent> = {}): SyncableEvent => ({
  calendarId: "calendar-1",
  calendarName: "Primary",
  calendarUrl: null,
  endTime: new Date("2026-01-05T10:00:00.000Z"),
  id: "master-row-1",
  sourceEventUid: "series-1",
  startTime: new Date("2026-01-05T09:00:00.000Z"),
  summary: "Weekly meeting",
  ...overrides,
});

const createWeeklyMaster = (overrides: Partial<SyncableEvent> = {}): SyncableEvent => createEvent({
  recurrenceRule: { count: 4, frequency: "WEEKLY" },
  ...overrides,
});

const semanticOccurrences = (events: SyncableEvent[]): string[] => events.map((event) => [
  event.id,
  event.startTime.toISOString(),
  event.endTime.toISOString(),
  event.summary,
].join("|"));

const occurrenceStarts = (events: SyncableEvent[]): string[] =>
  events.map((event) => event.startTime.toISOString());

const expectOneOffEvents = (events: SyncableEvent[]): void => {
  for (const event of events) {
    expect(event).not.toHaveProperty("recurrenceRule");
    expect(event).not.toHaveProperty("exceptionDates");
    expect(event).not.toHaveProperty("recurrenceId");
  }
};

const parseAndMaterialize = (
  eventBody: string[],
  window: { start: Date; end: Date },
): SyncableEvent[] => {
  const calendar = parseIcsCalendar({
    icsString: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Keeper Test//EN",
      "BEGIN:VEVENT",
      "UID:duration-series",
      ...eventBody,
      "RRULE:FREQ=WEEKLY;COUNT=2",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
  });
  const [parsed] = parseIcsEvents(calendar);
  if (!parsed?.recurrenceRule) {
    throw new TypeError("Expected a parsed recurring event");
  }
  let storedExceptionDates: string | null = null;
  if (parsed.exceptionDates) {
    storedExceptionDates = JSON.stringify(parsed.exceptionDates);
  }
  const recurrence = parseStoredRecurrenceForMaterialization({
    eventId: "parsed-master",
    exceptionDates: storedExceptionDates,
    recurrenceId: parsed.recurrenceId ?? null,
    recurrenceRule: serializeStoredIcsRecurrenceRule(
      parsed.recurrenceRule,
      parsed.recurrenceDuration,
    ),
  });

  return materializeRecurrenceEvents([{
    calendarId: "calendar-1",
    calendarName: "Primary",
    calendarUrl: null,
    endTime: parsed.endTime,
    ...recurrence,
    id: "parsed-master",
    isAllDay: parsed.isAllDay,
    sourceEventUid: parsed.uid,
    startTime: parsed.startTime,
    startTimeZone: parsed.startTimeZone,
    summary: parsed.title ?? "",
  }], window);
};

describe("materializeRecurrenceEvents", () => {
  it("gives each occurrence a stable logical ID while retaining its physical master row", () => {
    const result = materializeRecurrenceEvents([createWeeklyMaster()], WINDOW);

    expect(new Set(result.map((event) => event.id)).size).toBe(4);
    expect(result.every((event) => event.id.startsWith("recurrence-"))).toBe(true);
    expect(result.map((event) => event.eventStateId)).toEqual([
      "master-row-1",
      "master-row-1",
      "master-row-1",
      "master-row-1",
    ]);
  });

  it("replaces the original slot when the same detached occurrence is moved repeatedly", () => {
    const master = createWeeklyMaster();
    const firstMove = createEvent({
      endTime: new Date("2026-01-13T15:00:00.000Z"),
      id: "override-jan-12",
      recurrenceId: new Date("2026-01-12T09:00:00.000Z"),
      startTime: new Date("2026-01-13T14:00:00.000Z"),
      summary: "First move",
    });
    const secondMove = {
      ...firstMove,
      endTime: new Date("2026-01-14T17:00:00.000Z"),
      startTime: new Date("2026-01-14T16:00:00.000Z"),
      summary: "Second move",
    };

    const firstResult = materializeRecurrenceEvents([master, firstMove], WINDOW);
    const secondResult = materializeRecurrenceEvents([master, secondMove], WINDOW);

    expect(occurrenceStarts(firstResult)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-13T14:00:00.000Z",
      "2026-01-19T09:00:00.000Z",
      "2026-01-26T09:00:00.000Z",
    ]);
    expect(occurrenceStarts(secondResult)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-14T16:00:00.000Z",
      "2026-01-19T09:00:00.000Z",
      "2026-01-26T09:00:00.000Z",
    ]);
    expect(secondResult.some((event) => event.startTime.getTime()
      === new Date("2026-01-12T09:00:00.000Z").getTime())).toBe(false);
    expectOneOffEvents(secondResult);
  });

  it("suppresses exception dates without trusting the recurrence library as the oracle", () => {
    const result = materializeRecurrenceEvents([
      createWeeklyMaster({
        exceptionDates: [new Date("2026-01-19T09:00:00.000Z")],
      }),
    ], WINDOW);

    expect(occurrenceStarts(result)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-12T09:00:00.000Z",
      "2026-01-26T09:00:00.000Z",
    ]);
  });

  it("preserves colliding overrides while suppressing both original slots", () => {
    const firstOverride = createEvent({
      endTime: new Date("2026-01-15T16:00:00.000Z"),
      id: "override-first",
      recurrenceId: new Date("2026-01-12T09:00:00.000Z"),
      startTime: new Date("2026-01-15T15:00:00.000Z"),
      summary: "First collision",
    });
    const secondOverride = createEvent({
      endTime: new Date("2026-01-15T16:00:00.000Z"),
      id: "override-second",
      recurrenceId: new Date("2026-01-19T09:00:00.000Z"),
      startTime: new Date("2026-01-15T15:00:00.000Z"),
      summary: "Second collision",
    });

    const result = materializeRecurrenceEvents([
      createWeeklyMaster(),
      secondOverride,
      firstOverride,
    ], WINDOW);

    expect(semanticOccurrences(result)).toEqual([
      expect.stringContaining("2026-01-05T09:00:00.000Z"),
      "override-first|2026-01-15T15:00:00.000Z|2026-01-15T16:00:00.000Z|First collision",
      "override-second|2026-01-15T15:00:00.000Z|2026-01-15T16:00:00.000Z|Second collision",
      expect.stringContaining("2026-01-26T09:00:00.000Z"),
    ]);
  });

  it("is deterministic for reordered mixed input and keeps unrelated same-UID rows", () => {
    const master = createWeeklyMaster();
    const override = createEvent({
      endTime: new Date("2026-01-13T12:00:00.000Z"),
      id: "override",
      recurrenceId: new Date("2026-01-12T09:00:00.000Z"),
      startTime: new Date("2026-01-13T11:00:00.000Z"),
      summary: "Moved",
    });
    const expandedProviderRow = createEvent({
      endTime: new Date("2026-01-08T19:00:00.000Z"),
      id: "google-instance",
      sourceEventUid: "google-expanded",
      startTime: new Date("2026-01-08T18:00:00.000Z"),
      summary: "Provider-expanded",
    });
    const unrelatedSameUid = createEvent({
      endTime: new Date("2026-01-09T21:00:00.000Z"),
      id: "unrelated-same-uid",
      startTime: new Date("2026-01-09T20:00:00.000Z"),
      summary: "Unrelated same UID",
    });
    const input = [master, override, expandedProviderRow, unrelatedSameUid];

    const forward = materializeRecurrenceEvents(input, WINDOW);
    const reversed = materializeRecurrenceEvents(input.toReversed(), WINDOW);

    expect(reversed).toEqual(forward);
    expect(forward.find((event) => event.id === "google-instance")?.summary)
      .toBe("Provider-expanded");
    expect(forward.find((event) => event.id === "unrelated-same-uid")?.summary)
      .toBe("Unrelated same UID");
  });

  it("replaces the handwritten occurrence set after a recurrence rule edit", () => {
    const weekly = materializeRecurrenceEvents([createWeeklyMaster()], WINDOW);
    const daily = materializeRecurrenceEvents([
      createWeeklyMaster({ recurrenceRule: { count: 3, frequency: "DAILY" } }),
    ], WINDOW);

    expect(occurrenceStarts(weekly)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-12T09:00:00.000Z",
      "2026-01-19T09:00:00.000Z",
      "2026-01-26T09:00:00.000Z",
    ]);
    expect(occurrenceStarts(daily)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-06T09:00:00.000Z",
      "2026-01-07T09:00:00.000Z",
    ]);
    expect(daily[0]?.id).toBe(weekly[0]?.id);
  });

  it("is replay-idempotent and does not bind generated IDs to transient row IDs", () => {
    const firstMaster = createWeeklyMaster({ id: "row-before-reingest" });
    const reingestedMaster = createWeeklyMaster({ id: "row-after-reingest" });
    const first = materializeRecurrenceEvents([firstMaster], WINDOW);
    const replay = materializeRecurrenceEvents([firstMaster], WINDOW);
    const afterReingest = materializeRecurrenceEvents([reingestedMaster], WINDOW);

    expect(replay).toEqual(first);
    expect(afterReingest.map((event) => event.id)).toEqual(first.map((event) => event.id));
    expect(afterReingest.map(({ eventStateId: _eventStateId, ...event }) => event))
      .toEqual(first.map(({ eventStateId: _eventStateId, ...event }) => event));
    expect(afterReingest.every((event) => event.eventStateId === "row-after-reingest"))
      .toBe(true);
    expect(materializeRecurrenceEvents(first, WINDOW)).toEqual(first);
  });

  it("keeps orphan overrides and refuses to attach them to ambiguous masters", () => {
    const firstMaster = createWeeklyMaster({ id: "master-a" });
    const secondMaster = createWeeklyMaster({
      endTime: new Date("2026-01-06T13:00:00.000Z"),
      id: "master-b",
      startTime: new Date("2026-01-06T12:00:00.000Z"),
    });
    const orphanOverride = createEvent({
      endTime: new Date("2026-01-12T18:00:00.000Z"),
      id: "ambiguous-override",
      recurrenceId: new Date("2026-01-12T09:00:00.000Z"),
      startTime: new Date("2026-01-12T17:00:00.000Z"),
    });

    const result = materializeRecurrenceEvents([
      firstMaster,
      secondMaster,
      orphanOverride,
    ], WINDOW);

    expect(result.some((event) => event.id === "ambiguous-override")).toBe(true);
    expect(occurrenceStarts(result)).toContain("2026-01-12T09:00:00.000Z");
  });

  it("does not attach same-UID overrides across source calendars", () => {
    const master = createWeeklyMaster();
    const otherCalendarOverride = createEvent({
      calendarId: "calendar-2",
      endTime: new Date("2026-01-14T13:00:00.000Z"),
      id: "other-calendar-override",
      recurrenceId: new Date("2026-01-12T09:00:00.000Z"),
      startTime: new Date("2026-01-14T12:00:00.000Z"),
    });

    const result = materializeRecurrenceEvents([master, otherCalendarOverride], WINDOW);

    expect(result.some((event) => event.id === "other-calendar-override")).toBe(true);
    expect(occurrenceStarts(result)).toContain("2026-01-12T09:00:00.000Z");
  });

  it("uses a half-open finite window for generated and standalone events", () => {
    const overlapsStart = createEvent({
      endTime: new Date("2026-01-01T00:30:00.000Z"),
      id: "overlaps-start",
      sourceEventUid: "standalone-a",
      startTime: new Date("2025-12-31T23:30:00.000Z"),
    });
    const startsAtEnd = createEvent({
      endTime: new Date("2026-02-01T01:00:00.000Z"),
      id: "starts-at-end",
      sourceEventUid: "standalone-b",
      startTime: new Date("2026-02-01T00:00:00.000Z"),
    });

    const result = materializeRecurrenceEvents([startsAtEnd, overlapsStart], WINDOW);

    expect(result.map((event) => event.id)).toEqual(["overlaps-start"]);
  });

  it("drops far-future one-offs that start after the window end", () => {
    const farFuture = createEvent({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
      id: "far-future-one-off",
      sourceEventUid: "far-future-one-off",
      startTime: new Date("2040-03-15T09:00:00.000Z"),
    });

    expect(materializeRecurrenceEvents([farFuture], WINDOW)).toEqual([]);
  });

  it("keeps the source wall time across DST independently of the host timezone", () => {
    const result = materializeRecurrenceEvents([
      createWeeklyMaster({
        endTime: new Date("2026-03-02T17:00:00.000Z"),
        recurrenceRule: { count: 3, frequency: "WEEKLY" },
        startTime: new Date("2026-03-02T16:00:00.000Z"),
        startTimeZone: "America/Edmonton",
      }),
    ], {
      end: new Date("2026-03-31T00:00:00.000Z"),
      start: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(occurrenceStarts(result)).toEqual([
      "2026-03-02T16:00:00.000Z",
      "2026-03-09T15:00:00.000Z",
      "2026-03-16T15:00:00.000Z",
    ]);
    expect(result.map((event) => event.endTime.toISOString())).toEqual([
      "2026-03-02T17:00:00.000Z",
      "2026-03-09T16:00:00.000Z",
      "2026-03-16T16:00:00.000Z",
    ]);
  });

  it.each([
    {
      endProperty: "DTEND;TZID=America/New_York:20260302T003000",
      expectedEnd: "2026-03-09T05:30:00.000Z",
      expectedHours: 24,
      label: "exact DTEND across the spring gap",
      start: "DTSTART;TZID=America/New_York:20260301T003000",
      windowEnd: "2026-03-10T00:00:00.000Z",
    },
    {
      endProperty: "DURATION:P1D",
      expectedEnd: "2026-03-09T04:30:00.000Z",
      expectedHours: 23,
      label: "nominal DURATION across the spring gap",
      start: "DTSTART;TZID=America/New_York:20260301T003000",
      windowEnd: "2026-03-10T00:00:00.000Z",
    },
    {
      endProperty: "DURATION:PT24H",
      expectedEnd: "2026-03-09T05:30:00.000Z",
      expectedHours: 24,
      label: "accurate DURATION across the spring gap",
      start: "DTSTART;TZID=America/New_York:20260301T003000",
      windowEnd: "2026-03-10T00:00:00.000Z",
    },
    {
      endProperty: "DTEND;TZID=America/New_York:20261026T003000",
      expectedEnd: "2026-11-02T04:30:00.000Z",
      expectedHours: 24,
      label: "exact DTEND across the fall fold",
      start: "DTSTART;TZID=America/New_York:20261025T003000",
      windowEnd: "2026-11-03T00:00:00.000Z",
    },
    {
      endProperty: "DURATION:P1D",
      expectedEnd: "2026-11-02T05:30:00.000Z",
      expectedHours: 25,
      label: "nominal DURATION across the fall fold",
      start: "DTSTART;TZID=America/New_York:20261025T003000",
      windowEnd: "2026-11-03T00:00:00.000Z",
    },
    {
      endProperty: "DURATION:PT24H",
      expectedEnd: "2026-11-02T04:30:00.000Z",
      expectedHours: 24,
      label: "accurate DURATION across the fall fold",
      start: "DTSTART;TZID=America/New_York:20261025T003000",
      windowEnd: "2026-11-03T00:00:00.000Z",
    },
  ])("preserves $label through ICS parsing and materialization", ({
    endProperty,
    expectedEnd,
    expectedHours,
    start,
    windowEnd,
  }) => {
    let windowStart = "2026-03-01T00:00:00.000Z";
    if (!start.includes("202603")) {
      windowStart = "2026-10-25T00:00:00.000Z";
    }
    const occurrences = parseAndMaterialize([start, endProperty], {
      end: new Date(windowEnd),
      start: new Date(windowStart),
    });
    const [, secondOccurrence] = occurrences;
    if (!secondOccurrence) {
      throw new TypeError("Expected the second recurrence occurrence");
    }

    expect(secondOccurrence.endTime.toISOString()).toBe(expectedEnd);
    expect((secondOccurrence.endTime.getTime() - secondOccurrence.startTime.getTime()) / 3_600_000)
      .toBe(expectedHours);
    expectOneOffEvents(occurrences);
  });

  it("does not truncate an unbounded series two years after its original DTSTART", () => {
    const result = materializeRecurrenceEvents([
      createWeeklyMaster({
        endTime: new Date("2020-01-06T10:00:00.000Z"),
        recurrenceRule: { frequency: "WEEKLY" },
        startTime: new Date("2020-01-06T09:00:00.000Z"),
      }),
    ], WINDOW);

    expect(result).toHaveLength(4);
    expect(occurrenceStarts(result)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-12T09:00:00.000Z",
      "2026-01-19T09:00:00.000Z",
      "2026-01-26T09:00:00.000Z",
    ]);
  });

  it("rejects recurrence series that exceed the materialization budget", () => {
    const master = createEvent({
      endTime: new Date("2026-01-01T00:00:01.000Z"),
      eventStateId: "persisted-master-row",
      recurrenceRule: { frequency: "SECONDLY" },
      startTime: new Date("2026-01-01T00:00:00.000Z"),
    });
    const reported: RecurrenceMaterializationLimitError[] = [];
    const result = materializeRecurrenceEvents([master], {
      end: new Date("2026-01-02T00:00:00.000Z"),
      start: new Date("2026-01-01T00:00:00.000Z"),
    }, { onSeriesOverBudget: (error) => reported.push(error) });

    expect(result).toEqual([]);
    const [thrown] = reported;

    expect(thrown).toBeInstanceOf(RecurrenceMaterializationLimitError);
    if (!(thrown instanceof RecurrenceMaterializationLimitError)) {
      throw new Error("Expected a recurrence materialization limit error");
    }
    expect(thrown).toMatchObject({
      calendarId: master.calendarId,
      eventId: master.id,
      eventStateId: master.eventStateId,
      limit: 10_000,
      sourceEventUid: master.sourceEventUid,
    });
  });

  it("does not flag a series whose occurrences all fall outside the window", () => {
    const sourceMaster: SourceEvent = {
      endTime: new Date("2040-01-01T00:00:01.000Z"),
      recurrenceRule: { frequency: "SECONDLY" },
      sourceEventId: "provider-master-id",
      startTime: new Date("2040-01-01T00:00:00.000Z"),
      uid: "future-pathological-series",
    };

    expect(findSourceEventsExceedingRecurrenceBudget(
      "source-calendar-id",
      [sourceMaster],
      {
        end: new Date("2026-01-02T00:00:00.000Z"),
        start: new Date("2026-01-01T00:00:00.000Z"),
      },
    )).toEqual([]);
  });

  it("isolates an over-budget series without condemning its healthy siblings", () => {
    const pathological: SourceEvent = {
      endTime: new Date("2026-01-01T00:00:01.000Z"),
      recurrenceRule: { frequency: "SECONDLY" },
      sourceEventId: "pathological-id",
      startTime: new Date("2026-01-01T00:00:00.000Z"),
      uid: "pathological-series",
    };
    const healthy: SourceEvent = {
      endTime: new Date("2026-01-01T10:00:00.000Z"),
      recurrenceRule: { frequency: "WEEKLY" },
      sourceEventId: "healthy-id",
      startTime: new Date("2026-01-01T09:00:00.000Z"),
      uid: "healthy-series",
    };

    expect(findSourceEventsExceedingRecurrenceBudget(
      "source-calendar-id",
      [pathological, healthy],
      {
        end: new Date("2028-01-01T00:00:00.000Z"),
        start: new Date("2026-01-01T00:00:00.000Z"),
      },
    )).toEqual([pathological]);
  });

  it("brings a series over budget only once the window is widened", () => {
    const hourlyWorkday: SourceEvent = {
      endTime: new Date("2026-01-01T00:30:00.000Z"),
      recurrenceRule: { frequency: "HOURLY" },
      sourceEventId: "hourly-id",
      startTime: new Date("2026-01-01T00:00:00.000Z"),
      uid: "hourly-series",
    };
    const findOverBudget = (end: Date): SourceEvent[] =>
      findSourceEventsExceedingRecurrenceBudget("source-calendar-id", [hourlyWorkday], {
        end,
        start: new Date("2026-01-01T00:00:00.000Z"),
      });

    expect(findOverBudget(new Date("2026-06-01T00:00:00.000Z"))).toEqual([]);
    expect(findOverBudget(new Date("2030-01-01T00:00:00.000Z"))).toEqual([hourlyWorkday]);
  });

  it("skips a pathological high-frequency series instead of failing the whole read", () => {
    const healthy = createWeeklyMaster({ sourceEventUid: "healthy-series" });
    const reported: RecurrenceMaterializationLimitError[] = [];

    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2020-01-01T00:00:01.000Z"),
        recurrenceRule: { frequency: "SECONDLY" },
        sourceEventUid: "pathological-series",
        startTime: new Date("2020-01-01T00:00:00.000Z"),
      }),
      healthy,
    ], WINDOW, { onSeriesOverBudget: (error) => reported.push(error) });

    expect(reported.map((error) => error.sourceEventUid)).toEqual(["pathological-series"]);
    expect(result).toHaveLength(4);
    expect(result.every((event) => event.sourceEventUid === "healthy-series")).toBe(true);
  });

  it("drops the detached occurrences of a skipped series rather than stranding them", () => {
    const reported: RecurrenceMaterializationLimitError[] = [];
    const movedOccurrence = createEvent({
      endTime: new Date("2026-01-15T16:00:00.000Z"),
      id: "moved-occurrence",
      recurrenceId: new Date("2026-01-12T00:00:00.000Z"),
      sourceEventUid: "pathological-series",
      startTime: new Date("2026-01-15T15:00:00.000Z"),
      summary: "Dragged to a new time",
    });

    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2026-01-01T00:00:01.000Z"),
        recurrenceRule: { frequency: "SECONDLY" },
        sourceEventUid: "pathological-series",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
      }),
      movedOccurrence,
    ], WINDOW, { onSeriesOverBudget: (error) => reported.push(error) });

    expect(reported.map((error) => error.sourceEventUid)).toEqual(["pathological-series"]);
    expect(result).toEqual([]);
  });

  it("accepts sparse hourly rules whose actual output remains within the budget", () => {
    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2020-01-01T09:30:00.000Z"),
        recurrenceRule: { byHour: [9], frequency: "HOURLY" },
        startTime: new Date("2020-01-01T09:00:00.000Z"),
      }),
    ], WINDOW);

    expect(result).toHaveLength(31);
    expect(result.every((event) => event.startTime.getUTCHours() === 9)).toBe(true);
  });

  it("accepts counted sparse hourly rules when the requested output remains within budget", () => {
    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2020-01-01T09:30:00.000Z"),
        recurrenceRule: { byHour: [9], count: 20_000, frequency: "HOURLY" },
        startTime: new Date("2020-01-01T09:00:00.000Z"),
      }),
    ], WINDOW);

    expect(result).toHaveLength(31);
    expect(result.every((event) => event.startTime.getUTCHours() === 9)).toBe(true);
  });

  it("does not reject a counted high-frequency series that ended before the window", () => {
    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2020-01-01T00:00:00.500Z"),
        recurrenceRule: { count: 20_000, frequency: "SECONDLY" },
        startTime: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ], WINDOW);

    expect(result).toEqual([]);
  });

  it("does not walk a pathological series whose UNTIL precedes the window", () => {
    const expired = createEvent({
      endTime: new Date("2019-01-01T09:05:00.000Z"),
      recurrenceRule: {
        byDay: [{ day: "MO" }, { day: "TU" }, { day: "WE" }, { day: "TH" }, { day: "FR" }],
        frequency: "MINUTELY",
        until: { date: new Date("2021-01-01T00:00:00.000Z"), type: "DATE-TIME" },
      },
      sourceEventUid: "expired-minutely-series",
      startTime: new Date("2019-01-01T09:00:00.000Z"),
    });

    const readStarted = performance.now();
    const result = materializeRecurrenceEvents([expired], WINDOW);
    const readElapsed = performance.now() - readStarted;

    const source: SourceEvent = {
      endTime: expired.endTime,
      recurrenceRule: expired.recurrenceRule,
      sourceEventId: expired.id,
      startTime: expired.startTime,
      uid: expired.sourceEventUid,
    };
    const scanStarted = performance.now();
    const overBudget = findSourceEventsExceedingRecurrenceBudget(
      "source-calendar-id",
      [source],
      WINDOW,
    );
    const scanElapsed = performance.now() - scanStarted;

    expect(result).toEqual([]);
    expect(overBudget).toEqual([]);
    expect(readElapsed).toBeLessThan(EXPIRED_SERIES_BUDGET_MS);
    expect(scanElapsed).toBeLessThan(EXPIRED_SERIES_BUDGET_MS);
  });

  it("keeps an override inside the window when its master's rule has already expired", () => {
    const expiredMaster = createEvent({
      recurrenceRule: {
        frequency: "WEEKLY",
        until: { date: new Date("2025-06-01T09:00:00.000Z"), type: "DATE-TIME" },
      },
      sourceEventUid: "expired-weekly-series",
    });
    const override = createEvent({
      endTime: new Date("2026-01-15T15:00:00.000Z"),
      id: "override-row-1",
      recurrenceId: new Date("2025-05-05T09:00:00.000Z"),
      sourceEventUid: "expired-weekly-series",
      startTime: new Date("2026-01-15T14:00:00.000Z"),
      summary: "Moved into the window",
    });

    const result = materializeRecurrenceEvents([expiredMaster, override], WINDOW);

    expect(semanticOccurrences(result)).toEqual([
      "override-row-1|2026-01-15T14:00:00.000Z|2026-01-15T15:00:00.000Z|Moved into the window",
    ]);
  });

  it("materializes an occurrence that starts before the window and ends inside it", () => {
    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2025-12-21T01:00:00.000Z"),
        recurrenceRule: {
          frequency: "DAILY",
          until: { date: new Date("2025-12-31T23:00:00.000Z"), type: "DATE-TIME" },
        },
        startTime: new Date("2025-12-20T23:00:00.000Z"),
      }),
    ], WINDOW);

    expect(occurrenceStarts(result)).toEqual(["2025-12-31T23:00:00.000Z"]);
  });

  it("compares a zoned UNTIL in the same wall time the expansion runs in", () => {
    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2025-12-28T01:00:00.000Z"),
        recurrenceRule: {
          frequency: "DAILY",
          until: { date: new Date("2026-01-01T01:00:00.000Z"), type: "DATE-TIME" },
        },
        startTime: new Date("2025-12-28T00:00:00.000Z"),
        startTimeZone: "Pacific/Kiritimati",
      }),
    ], WINDOW);

    expect(occurrenceStarts(result)).toEqual(["2026-01-01T00:00:00.000Z"]);
  });

  it("still expands a COUNT-bounded series that ran out before the window", () => {
    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2025-01-06T10:00:00.000Z"),
        recurrenceRule: { count: 4, frequency: "WEEKLY" },
        startTime: new Date("2025-01-06T09:00:00.000Z"),
      }),
    ], WINDOW);

    expect(result).toEqual([]);
  });

  it("translates ts-ics zero-based BYMONTH values without shifting the month", () => {
    const result = materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2026-01-01T10:00:00.000Z"),
        recurrenceRule: {
          byMonth: [0, 6],
          byMonthday: [1],
          count: 2,
          frequency: "YEARLY",
        },
        startTime: new Date("2026-01-01T09:00:00.000Z"),
      }),
    ], {
      end: new Date("2027-01-01T00:00:00.000Z"),
      start: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(occurrenceStarts(result)).toEqual([
      "2026-01-01T09:00:00.000Z",
      "2026-07-01T09:00:00.000Z",
    ]);
  });
});
