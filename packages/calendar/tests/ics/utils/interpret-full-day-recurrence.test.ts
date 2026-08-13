import { describe, expect, it } from "vitest";
import { interpretFullDayTimedEventsAsAllDay } from "../../../src/ics/utils/interpret-full-day-timed-events";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import type { SourceEvent, SyncableEvent } from "../../../src/core/types";

const WINDOW = {
  end: new Date("2027-03-25T00:00:00.000Z"),
  start: new Date("2027-03-01T00:00:00.000Z"),
};

const buildSourceEvent = (overrides: Partial<SourceEvent>): SourceEvent => ({
  availability: "busy",
  calendarId: "calendar-1",
  calendarName: "Feed",
  calendarUrl: null,
  endTime: new Date("2027-03-13T05:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "series-uid",
  startTime: new Date("2027-03-12T05:00:00.000Z"),
  startTimeZone: "America/New_York",
  summary: "Nightly rota",
  ...overrides,
} as SourceEvent);

const occurrenceStarts = (events: SourceEvent[]): string[] =>
  materializeRecurrenceEvents(events as unknown as SyncableEvent[], WINDOW)
    .map((occurrence) => occurrence.startTime.toISOString())
    .toSorted();

const interpret = (events: SourceEvent[], calendarTimeZone?: string): SourceEvent[] =>
  interpretFullDayTimedEventsAsAllDay(events, {
    enabled: true,
    ...(calendarTimeZone && { calendarTimeZone }),
  });

/*
 * A feed that states a whole day as a timed span from local midnight to local midnight is
 * re-anchored onto UTC midnight so it reaches every destination as the day it names. The
 * recurrence properties the source states alongside it — the days it cancels, the slot a
 * detached instance replaces, the day it stops on — name the very same occurrences, so
 * re-anchoring the series has to carry them with it or the series stops matching itself.
 */
describe("re-anchoring a recurring full-day timed series onto UTC midnight", () => {
  it("keeps a cancelled day cancelled", () => {
    const master = buildSourceEvent({
      exceptionDates: [new Date("2027-03-15T04:00:00.000Z")],
      recurrenceRule: { count: 6, frequency: "DAILY" },
    } as Partial<SourceEvent>);

    const starts = occurrenceStarts(interpret([master]));

    expect(starts).not.toContain("2027-03-15T00:00:00.000Z");
    expect(starts).toHaveLength(5);
  });

  it("keeps a cancelled day cancelled in a zone ahead of UTC", () => {
    const master = buildSourceEvent({
      endTime: new Date("2027-03-12T23:00:00.000Z"),
      exceptionDates: [new Date("2027-03-13T23:00:00.000Z")],
      recurrenceRule: { count: 6, frequency: "DAILY" },
      startTime: new Date("2027-03-11T23:00:00.000Z"),
      startTimeZone: "Europe/Berlin",
    } as Partial<SourceEvent>);

    const starts = occurrenceStarts(interpret([master]));

    expect(starts).not.toContain("2027-03-14T00:00:00.000Z");
    expect(starts).toHaveLength(5);
  });

  it("lets a detached instance replace the day it was moved from", () => {
    const master = buildSourceEvent({
      recurrenceRule: { count: 6, frequency: "DAILY" },
    } as Partial<SourceEvent>);
    const override = buildSourceEvent({
      endTime: new Date("2027-03-21T04:00:00.000Z"),
      eventStateId: "event-state-2",
      id: "event-state-2",
      recurrenceId: new Date("2027-03-16T04:00:00.000Z"),
      startTime: new Date("2027-03-20T04:00:00.000Z"),
      summary: "Nightly rota (moved)",
    } as Partial<SourceEvent>);

    const starts = occurrenceStarts(interpret([master, override]));

    expect(starts).not.toContain("2027-03-16T00:00:00.000Z");
    expect(starts).toHaveLength(5);
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
    } as Partial<SourceEvent>);

    const starts = occurrenceStarts(interpret([master]));

    expect(starts.at(-1)).toBe("2027-03-17T00:00:00.000Z");
  });

  it("re-anchors a series with no recurrence properties to touch", () => {
    const master = buildSourceEvent({
      recurrenceRule: { count: 3, frequency: "DAILY" },
    } as Partial<SourceEvent>);

    expect(occurrenceStarts(interpret([master]))).toEqual([
      "2027-03-12T00:00:00.000Z",
      "2027-03-13T00:00:00.000Z",
      "2027-03-14T00:00:00.000Z",
    ]);
  });

  it("answers the same way when the same feed is ingested twice", () => {
    const master = buildSourceEvent({
      exceptionDates: [new Date("2027-03-15T04:00:00.000Z")],
      recurrenceRule: { count: 6, frequency: "DAILY" },
    } as Partial<SourceEvent>);

    const first = occurrenceStarts(interpret([master]));
    const second = occurrenceStarts(interpret(interpret([master])));

    expect(second).toEqual(first);
  });
});
