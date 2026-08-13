import { describe, expect, it } from "vitest";
import { interpretFullDayTimedEventsAsAllDay } from "../../../src/ics/utils/interpret-full-day-timed-events";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import type { SourceEvent, SyncableEvent } from "../../../src/core/types";

const WINDOW = {
  end: new Date("2027-03-25T00:00:00.000Z"),
  start: new Date("2027-03-01T00:00:00.000Z"),
};

const buildSourceEvent = (overrides: Partial<SourceEvent>): SourceEvent => ({
  endTime: new Date("2027-03-13T05:00:00.000Z"),
  sourceEventId: "event-state-1",
  startTime: new Date("2027-03-12T05:00:00.000Z"),
  startTimeZone: "America/New_York",
  title: "Nightly rota",
  uid: "series-uid",
  ...overrides,
});

const toSyncableEvent = (event: SourceEvent): SyncableEvent => ({
  availability: event.availability,
  calendarId: "calendar-1",
  calendarName: "Feed",
  calendarUrl: null,
  endTime: event.endTime,
  eventStateId: event.sourceEventId,
  id: event.sourceEventId ?? event.uid,
  isAllDay: event.isAllDay,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone,
  summary: event.title ?? "",
  ...(event.exceptionDates && {
    exceptionDates: event.exceptionDates.map((exceptionDate) => exceptionDate.date),
  }),
  ...(event.recurrenceDuration && { recurrenceDuration: event.recurrenceDuration }),
  ...(event.recurrenceId && { recurrenceId: event.recurrenceId }),
  ...(event.recurrenceRule && { recurrenceRule: event.recurrenceRule }),
});

const occurrenceStarts = (events: SourceEvent[]): string[] =>
  materializeRecurrenceEvents(events.map((event) => toSyncableEvent(event)), WINDOW)
    .map((occurrence) => occurrence.startTime.toISOString())
    .toSorted();

const interpret = (events: SourceEvent[], calendarTimeZone?: string): SourceEvent[] =>
  interpretFullDayTimedEventsAsAllDay(events, {
    enabled: true,
    ...(calendarTimeZone && { calendarTimeZone }),
  });

describe("re-anchoring a recurring full-day timed series onto UTC midnight", () => {
  it("keeps a cancelled day cancelled", () => {
    const master = buildSourceEvent({
      exceptionDates: [{ date: new Date("2027-03-15T04:00:00.000Z") }],
      recurrenceRule: { count: 6, frequency: "DAILY" },
    });

    const starts = occurrenceStarts(interpret([master]));

    expect(starts).not.toContain("2027-03-15T00:00:00.000Z");
    expect(starts).toHaveLength(5);
  });

  it("keeps a cancelled day cancelled in a zone ahead of UTC", () => {
    const master = buildSourceEvent({
      endTime: new Date("2027-03-12T23:00:00.000Z"),
      exceptionDates: [{ date: new Date("2027-03-13T23:00:00.000Z") }],
      recurrenceRule: { count: 6, frequency: "DAILY" },
      startTime: new Date("2027-03-11T23:00:00.000Z"),
      startTimeZone: "Europe/Berlin",
    });

    const starts = occurrenceStarts(interpret([master]));

    expect(starts).not.toContain("2027-03-14T00:00:00.000Z");
    expect(starts).toHaveLength(5);
  });

  it("lets a detached instance replace the day it was moved from", () => {
    const master = buildSourceEvent({
      recurrenceRule: { count: 6, frequency: "DAILY" },
    });
    const override = buildSourceEvent({
      endTime: new Date("2027-03-21T04:00:00.000Z"),
      recurrenceId: new Date("2027-03-16T04:00:00.000Z"),
      sourceEventId: "event-state-2",
      startTime: new Date("2027-03-20T04:00:00.000Z"),
      title: "Nightly rota (moved)",
    });

    const starts = occurrenceStarts(interpret([master, override]));

    expect(starts).not.toContain("2027-03-16T00:00:00.000Z");
    expect(starts).toContain("2027-03-20T00:00:00.000Z");
    expect(starts).toHaveLength(6);
  });

  it("re-anchors the slot a timed detached instance replaces", () => {
    const master = buildSourceEvent({
      recurrenceRule: { count: 6, frequency: "DAILY" },
    });
    const override = buildSourceEvent({
      endTime: new Date("2027-03-16T19:00:00.000Z"),
      recurrenceId: new Date("2027-03-16T04:00:00.000Z"),
      sourceEventId: "event-state-2",
      startTime: new Date("2027-03-16T18:00:00.000Z"),
      title: "Nightly rota (rescheduled)",
    });

    const starts = occurrenceStarts(interpret([master, override]));

    expect(starts).not.toContain("2027-03-16T00:00:00.000Z");
    expect(starts).toContain("2027-03-16T18:00:00.000Z");
    expect(starts).toHaveLength(6);
  });

  it("stops on the day the series says it stops", () => {
    const master = buildSourceEvent({
      endTime: new Date("2027-03-12T23:00:00.000Z"),
      recurrenceRule: {
        frequency: "DAILY",
        until: { date: new Date("2027-03-16T23:00:00.000Z") },
      },
      startTime: new Date("2027-03-11T23:00:00.000Z"),
      startTimeZone: "Europe/Berlin",
    });

    const starts = occurrenceStarts(interpret([master]));

    expect(starts.at(-1)).toBe("2027-03-17T00:00:00.000Z");
  });

  it("re-anchors a series with no recurrence properties to touch", () => {
    const master = buildSourceEvent({
      recurrenceRule: { count: 3, frequency: "DAILY" },
    });

    expect(occurrenceStarts(interpret([master]))).toEqual([
      "2027-03-12T00:00:00.000Z",
      "2027-03-13T00:00:00.000Z",
      "2027-03-14T00:00:00.000Z",
    ]);
  });

  it("answers the same way when the same feed is ingested twice", () => {
    const master = buildSourceEvent({
      exceptionDates: [{ date: new Date("2027-03-15T04:00:00.000Z") }],
      recurrenceRule: { count: 6, frequency: "DAILY" },
    });
    const override = buildSourceEvent({
      endTime: new Date("2027-03-21T04:00:00.000Z"),
      recurrenceId: new Date("2027-03-16T04:00:00.000Z"),
      sourceEventId: "event-state-2",
      startTime: new Date("2027-03-20T04:00:00.000Z"),
      title: "Nightly rota (moved)",
    });

    const first = occurrenceStarts(interpret([master, override]));
    const second = occurrenceStarts(interpret(interpret([master, override])));

    expect(second).toEqual(first);
  });
});
