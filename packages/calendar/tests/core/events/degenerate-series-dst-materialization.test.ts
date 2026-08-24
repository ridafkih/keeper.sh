import { describe, expect, it } from "vitest";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import type { SyncableEvent } from "../../../src/core/types";

const WINDOW = {
  end: new Date("2027-11-10T00:00:00.000Z"),
  start: new Date("2027-03-01T00:00:00.000Z"),
};

const createEvent = (overrides: Partial<SyncableEvent> = {}): SyncableEvent => ({
  calendarId: "calendar-1",
  calendarName: "Primary",
  calendarUrl: null,
  endTime: new Date("2027-03-11T07:30:00.000Z"),
  id: "event-state-1",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2027-03-11T07:30:00.000Z"),
  startTimeZone: "America/New_York",
  summary: "Point in time",
  ...overrides,
});

const startsOf = (events: SyncableEvent[]): string[] =>
  events.map((event) => event.startTime.toISOString());

const durationsOf = (events: SyncableEvent[]): number[] =>
  events.map((event) => event.endTime.getTime() - event.startTime.getTime());

describe("a zero-duration series crossing a daylight transition", () => {
  it("shifts only the occurrence the spring-forward gap removes", () => {
    const events = materializeRecurrenceEvents([createEvent({
      recurrenceRule: { count: 6, frequency: "DAILY" },
    })], WINDOW);

    expect(startsOf(events)).toEqual([
      "2027-03-11T07:30:00.000Z",
      "2027-03-12T07:30:00.000Z",
      "2027-03-13T07:30:00.000Z",
      "2027-03-14T07:30:00.000Z",
      "2027-03-15T06:30:00.000Z",
      "2027-03-16T06:30:00.000Z",
    ]);
    expect(durationsOf(events)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("takes the earlier instant for the occurrence the fold repeats", () => {
    const events = materializeRecurrenceEvents([createEvent({
      endTime: new Date("2027-11-04T05:30:00.000Z"),
      recurrenceRule: { count: 6, frequency: "DAILY" },
      startTime: new Date("2027-11-04T05:30:00.000Z"),
    })], WINDOW);

    expect(startsOf(events)).toEqual([
      "2027-11-04T05:30:00.000Z",
      "2027-11-05T05:30:00.000Z",
      "2027-11-06T05:30:00.000Z",
      "2027-11-07T05:30:00.000Z",
      "2027-11-08T06:30:00.000Z",
      "2027-11-09T06:30:00.000Z",
    ]);
    expect(durationsOf(events)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("resolves an occurrence whose wall time the spring-forward gap removes", () => {
    const events = materializeRecurrenceEvents([createEvent({
      endTime: new Date("2027-03-13T07:30:00.000Z"),
      recurrenceRule: { count: 3, frequency: "DAILY" },
      startTime: new Date("2027-03-13T07:30:00.000Z"),
    })], WINDOW);

    expect(startsOf(events)).toHaveLength(3);
    for (const start of startsOf(events)) {
      expect(start).not.toContain("Invalid");
    }
    expect(durationsOf(events)).toEqual([0, 0, 0]);
  });

  it("produces the same occurrences when materialized twice", () => {
    const event = createEvent({ recurrenceRule: { count: 6, frequency: "DAILY" } });

    const first = materializeRecurrenceEvents([event], WINDOW);
    const second = materializeRecurrenceEvents([event], WINDOW);

    expect(startsOf(second)).toEqual(startsOf(first));
    expect(second.map((occurrence) => occurrence.id)).toEqual(
      first.map((occurrence) => occurrence.id),
    );
  });
});

describe("degenerate series with sparse or absent occurrences", () => {
  it("materializes a single occurrence when until names the start instant", () => {
    const events = materializeRecurrenceEvents([createEvent({
      recurrenceRule: {
        frequency: "DAILY",
        until: { date: new Date("2027-03-11T07:30:00.000Z") },
      },
    })], WINDOW);

    expect(startsOf(events)).toEqual(["2027-03-11T07:30:00.000Z"]);
  });

  it("materializes nothing when every zero-duration occurrence is excepted", () => {
    const events = materializeRecurrenceEvents([createEvent({
      exceptionDates: [
        new Date("2027-03-11T07:30:00.000Z"),
        new Date("2027-03-12T07:30:00.000Z"),
      ],
      recurrenceRule: { count: 2, frequency: "DAILY" },
    })], WINDOW);

    expect(events).toEqual([]);
  });

  it("keeps the surviving occurrence of a zero-duration series with one exception", () => {
    const events = materializeRecurrenceEvents([createEvent({
      exceptionDates: [new Date("2027-03-11T07:30:00.000Z")],
      recurrenceRule: { count: 2, frequency: "DAILY" },
    })], WINDOW);

    expect(startsOf(events)).toEqual(["2027-03-12T07:30:00.000Z"]);
  });

  it("materializes an inverted series onto the instants its starts name", () => {
    const events = materializeRecurrenceEvents([createEvent({
      endTime: new Date("2027-03-11T06:30:00.000Z"),
      recurrenceRule: { count: 3, frequency: "DAILY" },
      startTime: new Date("2027-03-11T07:30:00.000Z"),
    })], WINDOW);

    expect(startsOf(events)).toEqual([
      "2027-03-11T07:30:00.000Z",
      "2027-03-12T07:30:00.000Z",
      "2027-03-13T07:30:00.000Z",
    ]);
    for (const duration of durationsOf(events)) {
      expect(duration).toBeLessThan(0);
    }
  });

  it("handles an empty event list and a single-element list alike", () => {
    expect(materializeRecurrenceEvents([], WINDOW)).toEqual([]);
    expect(materializeRecurrenceEvents([createEvent({})], WINDOW)).toHaveLength(1);
  });
});
