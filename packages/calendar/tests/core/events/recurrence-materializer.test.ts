import { describe, expect, it } from "vitest";
import {
  assertSourceRecurrenceMaterializationWithinBudget,
  materializeRecurrenceEvents,
  RecurrenceMaterializationLimitError,
} from "../../../src/core/events/recurrence-materializer";
import type { SourceEvent, SyncableEvent } from "../../../src/core/types";

const WINDOW = {
  end: new Date("2026-02-01T00:00:00.000Z"),
  start: new Date("2026-01-01T00:00:00.000Z"),
};

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

  it("retains far-future one-offs for an unbounded destination write domain", () => {
    const farFuture = createEvent({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
      id: "far-future-one-off",
      sourceEventUid: "far-future-one-off",
      startTime: new Date("2040-03-15T09:00:00.000Z"),
    });

    expect(materializeRecurrenceEvents([farFuture], WINDOW)).toEqual([]);
    expect(materializeRecurrenceEvents([farFuture], WINDOW, {
      retainOneOffEventsAfterWindowEnd: true,
    })).toEqual([farFuture]);
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
    let thrown: unknown = null;
    try {
      materializeRecurrenceEvents([master], {
        end: new Date("2026-01-02T00:00:00.000Z"),
        start: new Date("2026-01-01T00:00:00.000Z"),
      });
    } catch (error) {
      thrown = error;
    }

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

  it("rejects a future source master before it can be persisted", () => {
    const sourceMaster: SourceEvent = {
      endTime: new Date("2040-01-01T00:00:01.000Z"),
      recurrenceRule: { frequency: "SECONDLY" },
      sourceEventId: "provider-master-id",
      startTime: new Date("2040-01-01T00:00:00.000Z"),
      uid: "future-pathological-series",
    };

    expect(() => assertSourceRecurrenceMaterializationWithinBudget(
      "source-calendar-id",
      [sourceMaster],
      {
      end: new Date("2026-01-02T00:00:00.000Z"),
      start: new Date("2026-01-01T00:00:00.000Z"),
      },
    )).toThrow(RecurrenceMaterializationLimitError);
  });

  it("rejects a pathological high-frequency series before scanning years of history", () => {
    expect(() => materializeRecurrenceEvents([
      createEvent({
        endTime: new Date("2020-01-01T00:00:01.000Z"),
        recurrenceRule: { frequency: "SECONDLY" },
        startTime: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ], WINDOW)).toThrow("exceeds the 10000 occurrence materialization limit");
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
