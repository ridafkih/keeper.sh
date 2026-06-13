import { describe, expect, it } from "vitest";
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

  it("emits a TZID-qualified local datetime when startTimeZone is set", () => {
    const icsString = eventToICalString(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-06-17T11:45:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-06-17T10:45:00.000Z"),
        startTimeZone: "America/Montevideo",
        summary: "Appointment",
      },
      "destination-uid",
    );

    // Montevideo is UTC-3 year-round, so 10:45Z renders as 07:45 local.
    expect(icsString).toContain("DTSTART;TZID=America/Montevideo:20260617T074500");
    expect(icsString).toContain("DTEND;TZID=America/Montevideo:20260617T084500");
    expect(icsString).not.toContain("DTSTART:20260617T104500Z");
  });

  it("round-trips the timezone and the underlying instant", () => {
    const icsString = eventToICalString(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-06-17T11:45:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-06-17T10:45:00.000Z"),
        startTimeZone: "America/Montevideo",
        summary: "Appointment",
      },
      "destination-uid",
    );

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTimeZone).toBe("America/Montevideo");
    expect(parsedEvent?.startTime.toISOString()).toBe("2026-06-17T10:45:00.000Z");
    expect(parsedEvent?.endTime.toISOString()).toBe("2026-06-17T11:45:00.000Z");
  });

  it("falls back to a bare UTC datetime when no timezone is known", () => {
    const icsString = eventToICalString(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-06-17T11:45:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-06-17T10:45:00.000Z"),
        summary: "Appointment",
      },
      "destination-uid",
    );

    expect(icsString).toContain("DTSTART:20260617T104500Z");
    expect(icsString).not.toContain("TZID=");
  });

  it("keeps all-day events timezone-less even when a timezone is supplied", () => {
    const icsString = eventToICalString(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-03-09T00:00:00.000Z"),
        id: "event-id",
        isAllDay: true,
        sourceEventUid: "source-uid",
        startTime: new Date("2026-03-08T00:00:00.000Z"),
        startTimeZone: "America/Montevideo",
        summary: "Holiday",
      },
      "destination-uid",
    );

    expect(icsString).toContain("DTSTART;VALUE=DATE:20260308");
    expect(icsString).not.toContain("TZID=");
  });

  it("converts HTML descriptions to plain text and preserves the original HTML", () => {
    const icsString = eventToICalString(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        description: '<a href="https://x.y">Join</a>&nbsp;&amp; notes',
        endTime: new Date("2026-06-17T11:45:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-06-17T10:45:00.000Z"),
        summary: "Appointment",
      },
      "destination-uid",
    );

    const unfoldedIcsString = icsString.replaceAll("\r\n ", "");

    expect(icsString).toContain("DESCRIPTION:Join (https://x.y) & notes");
    expect(unfoldedIcsString).toContain(
      String.raw`X-ALT-DESC;FMTTYPE=text/html:<a href="https://x.y">Join</a>&nbsp\;&amp\; notes`,
    );
  });

  it("uses pre-derived plaintext descriptions for CalDAV DESCRIPTION", () => {
    const icsString = eventToICalString(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        description: '<p>Join <a href="https://x.y">call</a></p>',
        plaintextDescription: "Join call (https://x.y)",
        endTime: new Date("2026-06-17T11:45:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-06-17T10:45:00.000Z"),
        summary: "Appointment",
      },
      "destination-uid",
    );

    expect(icsString).toContain("DESCRIPTION:Join call (https://x.y)");
    expect(icsString).not.toContain("DESCRIPTION:<p>");
  });

  it("does not add an alternate description for plain text descriptions", () => {
    const icsString = eventToICalString(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        description: "Plain text notes",
        endTime: new Date("2026-06-17T11:45:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-06-17T10:45:00.000Z"),
        summary: "Appointment",
      },
      "destination-uid",
    );

    expect(icsString).toContain("DESCRIPTION:Plain text notes");
    expect(icsString).not.toContain("X-ALT-DESC");
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

  it("parses X-ALT-DESC as the canonical description and DESCRIPTION as plaintext", () => {
    const ics = buildIcs([
      buildVevent({
        UID: "html-description",
        SUMMARY: "HTML Description",
        DTSTART: "20260101T100000Z",
        DTEND: "20260101T110000Z",
        DESCRIPTION: "Join call",
        "X-ALT-DESC;FMTTYPE=text/html": "<p>Join <strong>call</strong></p>",
      }),
    ]);

    const events = parseICalToRemoteEvents(ics);

    expect(events).toHaveLength(1);
    expect(events[0]?.description).toBe("<p>Join <strong>call</strong></p>");
    expect(events[0]?.plaintextDescription).toBe("Join call");
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
      description: event.description,
      isAllDay: event.isAllDay,
      location: event.location,
      sourceEventType: "default" as const,
      title: event.title,
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
      description: oldCodeResult.description,
      isAllDay: oldCodeResult.isAllDay,
      location: oldCodeResult.location,
      sourceEventType: "default" as const,
      title: oldCodeResult.title,
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
      description: oldCodeResult.description,
      isAllDay: oldCodeResult.isAllDay,
      location: oldCodeResult.location,
      sourceEventType: "default" as const,
      title: oldCodeResult.title,
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
