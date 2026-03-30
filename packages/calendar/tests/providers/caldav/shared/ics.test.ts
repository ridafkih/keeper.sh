import { describe, expect, it } from "bun:test";
import { eventToICalString, parseICalToRemoteEvent, parseICalToRemoteEvents } from "../../../../src/providers/caldav/shared/ics";
import { buildSourceEventsToAdd, buildSourceEventStateIdsToRemove } from "../../../../src/core/source/event-diff";
import type { SourceEvent } from "../../../../src/core/types";

const buildIcs = (vevents: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  ...vevents,
  "END:VCALENDAR",
].join("\r\n");

const buildVevent = (fields: Record<string, string>): string => [
  "BEGIN:VEVENT",
  ...Object.entries(fields).map(([key, value]) => `${key}:${value}`),
  "END:VEVENT",
].join("\r\n");

const toSourceEvent = (parsed: ReturnType<typeof parseICalToRemoteEvents>[number]): SourceEvent => ({
  availability: parsed.availability,
  description: parsed.description,
  endTime: parsed.endTime,
  exceptionDates: parsed.exceptionDates,
  isAllDay: parsed.isAllDay,
  location: parsed.location,
  recurrenceRule: parsed.recurrenceRule,
  startTime: parsed.startTime,
  startTimeZone: parsed.startTimeZone,
  title: parsed.title,
  uid: parsed.uid,
});

describe("eventToICalString", () => {
  it("serializes all-day free events as transparent DATE events", () => {
    const icsString = eventToICalString(
      {
        availability: "free",
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-03-09T00:00:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-03-08T00:00:00.000Z"),
        summary: "WFH",
      },
      "destination-uid",
    );

    expect(icsString).toContain("DTSTART;VALUE=DATE:20260308");
    expect(icsString).toContain("DTEND;VALUE=DATE:20260309");
    expect(icsString).toContain("TRANSP:TRANSPARENT");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.availability).toBe("free");
    expect(parsedEvent?.startTime.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(parsedEvent?.endTime.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});

describe("parseICalToRemoteEvents", () => {
  it("returns both master and modified occurrence from a recurring event", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "recurring-abc",
        SUMMARY: "Weekly Sync",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
        RRULE: "FREQ=WEEKLY;BYDAY=TU",
      }),
      buildVevent({
        UID: "recurring-abc",
        SUMMARY: "Weekly Sync (rescheduled)",
        DTSTART: "20260303T140000Z",
        DTEND: "20260303T150000Z",
        "RECURRENCE-ID": "20260303T100000Z",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);

    expect(events).toHaveLength(2);

    const [master, modified] = events;

    expect(master).toBeDefined();
    expect(master?.title).toBe("Weekly Sync");
    expect(master?.recurrenceRule).toBeTruthy();
    expect(modified).toBeDefined();
    expect(modified?.title).toBe("Weekly Sync (rescheduled)");
    expect(modified?.startTime).toEqual(new Date("2026-03-03T14:00:00.000Z"));
  });

  it("returns empty array for calendar with no events", () => {
    const events = parseICalToRemoteEvents(buildIcs([]));
    expect(events).toHaveLength(0);
  });

  it("skips events missing a UID", () => {
    const ics = buildIcs([
      buildVevent({
        SUMMARY: "No UID",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
      }),
      buildVevent({
        UID: "valid-uid",
        SUMMARY: "Valid",
        DTSTART: "20260102T100000Z",
        DTEND: "20260102T110000Z",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);
    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe("valid-uid");
  });

  it("skips events missing DTSTART", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "no-start",
        SUMMARY: "Missing Start",
        DTEND: "20260101T110000Z",
      }),
      buildVevent({
        UID: "has-start",
        SUMMARY: "Has Start",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);
    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe("has-start");
  });

  it("preserves availability independently per event", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "busy-event",
        SUMMARY: "Busy",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
      }),
      buildVevent({
        UID: "free-event",
        SUMMARY: "Free",
        DTSTART: "20260102T100000Z",
        DTEND: "20260102T110000Z",
        TRANSP: "TRANSPARENT",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);
    expect(events[0]?.availability).toBe("busy");
    expect(events[1]?.availability).toBe("free");
  });

  it("preserves all-day flag independently per event", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "allday",
        SUMMARY: "All Day",
        "DTSTART;VALUE=DATE": "20260308",
        "DTEND;VALUE=DATE": "20260309",
      }),
      buildVevent({
        UID: "timed",
        SUMMARY: "Timed",
        DTSTART: "20260308T100000Z",
        DTEND: "20260308T110000Z",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);
    expect(events[0]?.isAllDay).toBe(true);
    expect(events[1]?.isAllDay).toBe(false);
  });
});

describe("duplicate prevention with multi-VEVENT parsing", () => {
  it("modified occurrences with same UID but different times are treated as separate events", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T103000Z",
        RRULE: "FREQ=WEEKLY",
      }),
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup (moved to afternoon)",
        DTSTART: "20260108T140000Z",
        DTEND: "20260108T143000Z",
        "RECURRENCE-ID": "20260108T100000Z",
      }),
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup (cancelled and rebooked)",
        DTSTART: "20260115T150000Z",
        DTEND: "20260115T153000Z",
        "RECURRENCE-ID": "20260115T100000Z",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);
    const sourceEvents = events.map((event) => toSourceEvent(event));
    const eventsToAdd = buildSourceEventsToAdd([], sourceEvents);

    expect(eventsToAdd).toHaveLength(3);
  });

  it("re-ingesting the same multi-VEVENT data produces zero new events", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T103000Z",
        RRULE: "FREQ=WEEKLY",
      }),
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup (moved)",
        DTSTART: "20260108T140000Z",
        DTEND: "20260108T143000Z",
        "RECURRENCE-ID": "20260108T100000Z",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);
    const sourceEvents = events.map((event) => toSourceEvent(event));

    const firstIngest = buildSourceEventsToAdd([], sourceEvents);
    expect(firstIngest).toHaveLength(2);

    const existingAfterFirstIngest = firstIngest.map((event, index) => ({
      id: `state-${index}`,
      sourceEventUid: event.uid,
      startTime: event.startTime,
      endTime: event.endTime,
      availability: event.availability,
      isAllDay: event.isAllDay,
      sourceEventType: "default" as const,
    }));

    const secondIngest = buildSourceEventsToAdd(existingAfterFirstIngest, sourceEvents);
    expect(secondIngest).toHaveLength(0);
  });

  it("removing one occurrence does not remove the master or other occurrences", () => {
    const allThree = buildIcs([
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T103000Z",
        RRULE: "FREQ=WEEKLY",
      }),
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup (moved week 2)",
        DTSTART: "20260108T140000Z",
        DTEND: "20260108T143000Z",
        "RECURRENCE-ID": "20260108T100000Z",
      }),
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup (moved week 3)",
        DTSTART: "20260115T150000Z",
        DTEND: "20260115T153000Z",
        "RECURRENCE-ID": "20260115T100000Z",
      }),
    ]);

    const allEvents = parseICalToRemoteEvents(allThree);
    const existingStates = allEvents.map((event, index) => ({
      id: `state-${index}`,
      sourceEventUid: event.uid,
      startTime: event.startTime,
      endTime: event.endTime,
      availability: event.availability,
      isAllDay: event.isAllDay,
      sourceEventType: "default" as const,
    }));

    const withOneRemoved = buildIcs([
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T103000Z",
        RRULE: "FREQ=WEEKLY",
      }),
      buildVevent({
        UID: "weekly-123",
        SUMMARY: "Standup (moved week 2)",
        DTSTART: "20260108T140000Z",
        DTEND: "20260108T143000Z",
        "RECURRENCE-ID": "20260108T100000Z",
      }),
    ]);

    const reducedEvents = parseICalToRemoteEvents(withOneRemoved);
    const reducedSourceEvents = reducedEvents.map((event) => toSourceEvent(event));
    const idsToRemove = buildSourceEventStateIdsToRemove(existingStates, reducedSourceEvents);

    expect(idsToRemove).toHaveLength(1);
    expect(idsToRemove[0]).toBe("state-2");
  });
});

describe("transition from old single-event to new multi-event parsing", () => {
  it("does not duplicate master event already ingested by old code", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "weekly-old",
        SUMMARY: "Legacy Meeting",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
        RRULE: "FREQ=WEEKLY",
      }),
      buildVevent({
        UID: "weekly-old",
        SUMMARY: "Legacy Meeting (exception)",
        DTSTART: "20260108T140000Z",
        DTEND: "20260108T150000Z",
        "RECURRENCE-ID": "20260108T100000Z",
      }),
    ]);

    const oldCodeResult = parseICalToRemoteEvent(ics);
    expect(oldCodeResult).not.toBeNull();

    if (!oldCodeResult) {
      throw new Error("Expected parsed event");
    }

    const existingFromOldCode = [{
      id: "old-state-1",
      sourceEventUid: oldCodeResult.uid,
      startTime: oldCodeResult.startTime,
      endTime: oldCodeResult.endTime,
      availability: oldCodeResult.availability,
      isAllDay: oldCodeResult.isAllDay,
      sourceEventType: "default" as const,
    }];

    const newCodeResults = parseICalToRemoteEvents(ics);
    const newSourceEvents = newCodeResults.map((event) => toSourceEvent(event));
    const eventsToAdd = buildSourceEventsToAdd(existingFromOldCode, newSourceEvents);

    expect(eventsToAdd).toHaveLength(1);
    expect(eventsToAdd[0]?.title).toBe("Legacy Meeting (exception)");
  });

  it("does not remove master event when transitioning to multi-event parsing", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "weekly-transition",
        SUMMARY: "Transition Meeting",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
        RRULE: "FREQ=WEEKLY",
      }),
      buildVevent({
        UID: "weekly-transition",
        SUMMARY: "Transition Meeting (moved)",
        DTSTART: "20260108T140000Z",
        DTEND: "20260108T150000Z",
        "RECURRENCE-ID": "20260108T100000Z",
      }),
    ]);

    const oldCodeResult = parseICalToRemoteEvent(ics);

    if (!oldCodeResult) {
      throw new Error("Expected parsed event");
    }

    const existingFromOldCode = [{
      id: "old-state-1",
      sourceEventUid: oldCodeResult.uid,
      startTime: oldCodeResult.startTime,
      endTime: oldCodeResult.endTime,
      availability: oldCodeResult.availability,
      isAllDay: oldCodeResult.isAllDay,
      sourceEventType: "default" as const,
    }];

    const newCodeResults = parseICalToRemoteEvents(ics);
    const newSourceEvents = newCodeResults.map((event) => toSourceEvent(event));
    const idsToRemove = buildSourceEventStateIdsToRemove(existingFromOldCode, newSourceEvents);

    expect(idsToRemove).toHaveLength(0);
  });

  it("transitioning from expanded to unexpanded removes orphaned expanded occurrences", () => {
    const expandedOccurrence1 = buildIcs([
      buildVevent({
        UID: "weekly-expanded",
        SUMMARY: "Expanded Meeting",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
      }),
    ]);

    const expandedOccurrence2 = buildIcs([
      buildVevent({
        UID: "weekly-expanded",
        SUMMARY: "Expanded Meeting",
        DTSTART: "20260108T100000Z",
        DTEND: "20260108T110000Z",
      }),
    ]);

    const parsed1 = parseICalToRemoteEvent(expandedOccurrence1);
    const parsed2 = parseICalToRemoteEvent(expandedOccurrence2);

    if (!parsed1 || !parsed2) {
      throw new Error("Expected parsed events");
    }

    const existingFromExpanded = [parsed1, parsed2].map((event, index) => ({
      id: `expanded-${index}`,
      sourceEventUid: event.uid,
      startTime: event.startTime,
      endTime: event.endTime,
      availability: event.availability,
      isAllDay: event.isAllDay,
      sourceEventType: "default" as const,
    }));

    const unexpandedIcs = buildIcs([
      buildVevent({
        UID: "weekly-expanded",
        SUMMARY: "Expanded Meeting",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
        RRULE: "FREQ=WEEKLY",
      }),
    ]);

    const newResults = parseICalToRemoteEvents(unexpandedIcs);
    const newSourceEvents = newResults.map((event) => toSourceEvent(event));

    const idsToRemove = buildSourceEventStateIdsToRemove(existingFromExpanded, newSourceEvents);

    expect(idsToRemove).toHaveLength(1);
    expect(idsToRemove[0]).toBe("expanded-1");
  });
});
