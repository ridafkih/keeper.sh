import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../src/ics/utils/parse-ics-events";
import type { SourceEvent } from "../../src/core/types";
import {
  buildSourceEventStateIdsToRemove,
  buildSourceEventsToAdd,
} from "../../src/core/source/event-diff";
import type { ExistingSourceEventState } from "../../src/core/source/stored-event-state";
import { filterSourceEventsToSyncWindow } from "../../src/core/source/sync-diagnostics";
import { materializeRecurrenceEvents } from "../../src/core/events/recurrence-materializer";
import { normalizeCalDAVEvent } from "../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../src/providers/outlook/destination/normalize-event";

const SYNC_WINDOW = {
  timeMax: new Date("2027-04-08T00:00:00.000Z"),
  timeMin: new Date("2027-03-08T00:00:00.000Z"),
};

// RFC 5545 §3.6.1: a timed VEVENT with no DTEND has zero duration, a DATE-valued one covers its start day.
const FEED = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Adversary//EN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:bare-timed",
  "DTSTAMP:20270301T000000Z",
  "DTSTART:20270308T160000Z",
  "SUMMARY:Timed with no DTEND",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:bare-date",
  "DTSTAMP:20270301T000000Z",
  "DTSTART;VALUE=DATE:20270309",
  "SUMMARY:All-day with no DTEND",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:same-instant",
  "DTSTAMP:20270301T000000Z",
  "DTSTART:20270310T090000Z",
  "DTEND:20270310T090000Z",
  "SUMMARY:Explicitly zero duration",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:same-date",
  "DTSTAMP:20270301T000000Z",
  "DTSTART;VALUE=DATE:20270311",
  "DTEND;VALUE=DATE:20270311",
  "SUMMARY:All-day ending on its own start date",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:inverted-timed",
  "DTSTAMP:20270301T000000Z",
  "DTSTART:20270312T160000Z",
  "DTEND:20270312T150000Z",
  "SUMMARY:Ends before it starts",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:window-lower-edge",
  "DTSTAMP:20270301T000000Z",
  "DTSTART:20270308T000000Z",
  "SUMMARY:Zero duration exactly on the window lower edge",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:zero-duration-series",
  "DTSTAMP:20270301T000000Z",
  "DTSTART:20270309T120000Z",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "SUMMARY:Zero duration every week",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const toSourceEvents = (ics: string): SourceEvent[] =>
  parseIcsEvents(parseIcsCalendar({ icsString: ics })).map((slot) => ({ ...slot } as SourceEvent));

const byUid = (events: SourceEvent[]): Map<string, SourceEvent> =>
  new Map(events.map((event) => [event.uid, event]));

const toStoredState = (event: SourceEvent, index: number): ExistingSourceEventState => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: event.exceptionDates ?? null,
  id: `state-${index}`,
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  recurrenceDuration: event.recurrenceDuration ?? null,
  recurrenceId: event.recurrenceId ?? null,
  recurrenceRule: event.recurrenceRule ?? null,
  sourceEventId: event.sourceEventId ?? null,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone ?? null,
  title: event.title ?? null,
} as ExistingSourceEventState);

describe("ics feeds that state a degenerate range", () => {
  it("keeps the range the feed states rather than dropping the event", () => {
    const events = byUid(toSourceEvents(FEED));

    expect([...events.keys()].toSorted()).toEqual([
      "bare-date",
      "bare-timed",
      "inverted-timed",
      "same-date",
      "same-instant",
      "window-lower-edge",
      "zero-duration-series",
    ]);
    expect(events.get("bare-timed")?.startTime.toISOString())
      .toBe("2027-03-08T16:00:00.000Z");
    expect(events.get("bare-timed")?.endTime.toISOString())
      .toBe("2027-03-08T16:00:00.000Z");
    expect(events.get("bare-date")?.endTime.toISOString())
      .toBe("2027-03-10T00:00:00.000Z");
    expect(events.get("same-date")?.isAllDay).toBe(true);
    expect(events.get("same-date")?.endTime.toISOString())
      .toBe("2027-03-11T00:00:00.000Z");
    const inverted = events.get("inverted-timed");
    if (!inverted) {
      throw new Error("Expected the inverted event in the feed");
    }
    expect(inverted.endTime.getTime()).toBeLessThan(inverted.startTime.getTime());
  });

  it("re-reads an unchanged feed as no work at all", () => {
    const first = toSourceEvents(FEED);
    const stored = first.map((event, index) => toStoredState(event, index));
    const second = toSourceEvents(FEED);

    const toAdd = buildSourceEventsToAdd(stored, second, { isDeltaSync: false });
    const toRemove = buildSourceEventStateIdsToRemove(stored, second, { isDeltaSync: false });

    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it("admits every degenerate event whose instant lies inside the sync window", () => {
    const events = toSourceEvents(FEED);
    const { events: inWindow, filteredCount } = filterSourceEventsToSyncWindow(
      events,
      SYNC_WINDOW,
    );

    expect(filteredCount).toBe(0);
    expect(inWindow).toHaveLength(events.length);
    expect(inWindow.map(({ uid }) => uid)).toContain("window-lower-edge");
  });

  it("drops a degenerate event whose instant lies outside the sync window exactly once", () => {
    const events = toSourceEvents(FEED);
    const laterWindow = {
      timeMax: new Date("2027-05-08T00:00:00.000Z"),
      timeMin: new Date("2027-04-08T00:00:00.000Z"),
    };
    const { events: inWindow } = filterSourceEventsToSyncWindow(events, laterWindow);

    expect(inWindow).toEqual([]);
  });

  it("materializes every occurrence of a zero-duration series and widens each for a destination", () => {
    const events = byUid(toSourceEvents(FEED));
    const master = events.get("zero-duration-series");
    if (!master) {
      throw new Error("Expected the zero-duration series in the feed");
    }

    const occurrences = materializeRecurrenceEvents([{
      calendarId: "source-calendar",
      calendarName: "Source",
      calendarUrl: null,
      endTime: master.endTime,
      id: "state-series",
      recurrenceRule: master.recurrenceRule,
      sourceEventUid: master.uid,
      startTime: master.startTime,
      summary: master.title ?? "",
    }], { end: SYNC_WINDOW.timeMax, start: SYNC_WINDOW.timeMin });

    expect(occurrences.map((occurrence) => occurrence.startTime.toISOString())).toEqual([
      "2027-03-09T12:00:00.000Z",
      "2027-03-16T12:00:00.000Z",
      "2027-03-23T12:00:00.000Z",
    ]);
    for (const occurrence of occurrences) {
      expect(occurrence.endTime.getTime()).toBe(occurrence.startTime.getTime());
      for (const normalize of [normalizeCalDAVEvent, normalizeGoogleEvent, normalizeOutlookEvent]) {
        const normalized = normalize(occurrence);
        expect(normalized.startTime.toISOString()).toBe(occurrence.startTime.toISOString());
        expect(normalized.endTime.getTime()).toBeGreaterThanOrEqual(
          normalized.startTime.getTime(),
        );
      }
    }
  });

  it("does not treat a stored source row as changed after a destination widened its mirror", () => {
    const events = toSourceEvents(FEED);
    const stored = events.map((event, index) => toStoredState(event, index));

    for (const event of events) {
      normalizeCalDAVEvent({
        ...event,
        calendarId: "source-calendar",
        calendarName: "Source",
        calendarUrl: null,
        id: event.uid,
        sourceEventUid: event.uid,
        summary: event.title ?? "",
      } as never);
    }

    const toAdd = buildSourceEventsToAdd(stored, toSourceEvents(FEED), { isDeltaSync: false });
    const toRemove = buildSourceEventStateIdsToRemove(
      stored,
      toSourceEvents(FEED),
      { isDeltaSync: false },
    );

    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });
});
