import { describe, expect, it } from "vitest";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import type { SyncableEvent } from "../../../src/core/types";

const WINDOW_START = new Date("2027-03-08T00:00:00.000Z");
const WINDOW_END = new Date("2027-06-01T00:00:00.000Z");
const WINDOW = { end: WINDOW_END, start: WINDOW_START };

const createEvent = (overrides: Partial<SyncableEvent> = {}): SyncableEvent => ({
  calendarId: "calendar-1",
  calendarName: "Primary",
  calendarUrl: null,
  endTime: new Date("2027-03-09T10:00:00.000Z"),
  id: "event-state-1",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2027-03-09T09:00:00.000Z"),
  summary: "Point in time",
  ...overrides,
});

const startsOf = (events: SyncableEvent[]): string[] =>
  events.map((event) => event.startTime.toISOString());

describe("materializing degenerate ranges at the local read window edge", () => {
  it("keeps a zero-duration one-off event that sits exactly on the window lower edge", () => {
    const events = materializeRecurrenceEvents([createEvent({
      endTime: WINDOW_START,
      startTime: WINDOW_START,
    })], WINDOW);

    expect(startsOf(events)).toEqual([WINDOW_START.toISOString()]);
  });

  it("keeps a zero-duration one-off event one millisecond inside the lower edge", () => {
    const inside = new Date(WINDOW_START.getTime() + 1);

    const events = materializeRecurrenceEvents([createEvent({
      endTime: inside,
      startTime: inside,
    })], WINDOW);

    expect(startsOf(events)).toEqual([inside.toISOString()]);
  });

  it("keeps an inverted one-off event whose start is inside the window", () => {
    const start = new Date("2027-03-10T09:00:00.000Z");

    const events = materializeRecurrenceEvents([createEvent({
      endTime: new Date("2027-03-05T09:00:00.000Z"),
      startTime: start,
    })], WINDOW);

    expect(startsOf(events)).toEqual([start.toISOString()]);
  });

  it("keeps a zero-duration all-day event on the window's first day", () => {
    const events = materializeRecurrenceEvents([createEvent({
      endTime: WINDOW_START,
      isAllDay: true,
      startTime: WINDOW_START,
    })], WINDOW);

    expect(startsOf(events)).toEqual([WINDOW_START.toISOString()]);
  });

  it("keeps the zero-duration occurrence of a series that starts on the lower edge", () => {
    const events = materializeRecurrenceEvents([createEvent({
      endTime: WINDOW_START,
      recurrenceRule: { count: 3, frequency: "DAILY" },
      startTime: WINDOW_START,
    })], WINDOW);

    expect(startsOf(events)).toEqual([
      "2027-03-08T00:00:00.000Z",
      "2027-03-09T00:00:00.000Z",
      "2027-03-10T00:00:00.000Z",
    ]);
  });

  it("still excludes a zero-duration event that ends before the window opens", () => {
    const before = new Date(WINDOW_START.getTime() - 1);

    const events = materializeRecurrenceEvents([createEvent({
      endTime: before,
      startTime: before,
    })], WINDOW);

    expect(events).toEqual([]);
  });

  it("still excludes a zero-duration event that sits exactly on the window upper edge", () => {
    const events = materializeRecurrenceEvents([createEvent({
      endTime: WINDOW_END,
      startTime: WINDOW_END,
    })], WINDOW);

    expect(events).toEqual([]);
  });
});
