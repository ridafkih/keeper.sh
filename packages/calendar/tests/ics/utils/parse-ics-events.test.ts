import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";

const createCalendarIcsString = (): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Keeper Test//EN",
    "BEGIN:VEVENT",
    "UID:external-event-1",
    "DTSTART;TZID=America/Toronto:20260310T090000",
    "DURATION:PT30M",
    "SUMMARY:Team Sync",
    "DESCRIPTION:Weekly planning",
    "LOCATION:Room 42",
    "RRULE:FREQ=WEEKLY;BYDAY=TU",
    "EXDATE;TZID=America/Toronto:20260317T090000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:internal-event@keeper.sh",
    "DTSTART:20260311T100000Z",
    "DTEND:20260311T103000Z",
    "SUMMARY:Internal",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

describe("parseIcsEvents", () => {
  it("parses external events and skips keeper-managed events", () => {
    const calendar = parseIcsCalendar({ icsString: createCalendarIcsString() });
    const parsedEvents = parseIcsEvents(calendar);

    expect(parsedEvents).toHaveLength(1);

    const [parsedEvent] = parsedEvents;
    if (!parsedEvent) {
      throw new TypeError("Expected parsed event");
    }

    expect(parsedEvent.uid).toBe("external-event-1");
    expect(parsedEvent.title).toBe("Team Sync");
    expect(parsedEvent.description).toBe("Weekly planning");
    expect(parsedEvent.location).toBe("Room 42");
    expect(parsedEvent.startTimeZone).toBe("America/Toronto");
    expect(parsedEvent.recurrenceDuration).toEqual({ minutes: 30 });
    expect(parsedEvent.endTime.getTime() - parsedEvent.startTime.getTime()).toBe(30 * 60 * 1000);

    const { recurrenceRule } = parsedEvent;
    expect(recurrenceRule).toBeDefined();
    if (!recurrenceRule || typeof recurrenceRule !== "object") {
      throw new TypeError("Expected recurrence rule object");
    }
    expect("frequency" in recurrenceRule && recurrenceRule.frequency).toBe("WEEKLY");

    const { exceptionDates } = parsedEvent;
    expect(exceptionDates).toBeDefined();
    expect(Array.isArray(exceptionDates)).toBe(true);
    if (!Array.isArray(exceptionDates)) {
      throw new TypeError("Expected exception dates array");
    }
    expect(exceptionDates).toHaveLength(1);
  });

  it("distinguishes exact DTEND duration from nominal DURATION", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:exact-duration",
        "DTSTART;TZID=America/New_York:20260301T003000",
        "DTEND;TZID=America/New_York:20260302T003000",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:nominal-duration",
        "DTSTART;TZID=America/New_York:20260301T003000",
        "DURATION:P1D",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const [exactDurationEvent, nominalDurationEvent] = parseIcsEvents(calendar);
    expect(exactDurationEvent).not.toHaveProperty("recurrenceDuration");
    expect(nominalDurationEvent?.recurrenceDuration).toEqual({ days: 1 });
  });

  it("defaults a date-only event without DTEND or DURATION to one day", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:date-only-default-duration",
        "DTSTART;VALUE=DATE:20260308",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parseIcsEvents(calendar)[0]).toMatchObject({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it.each([
    {
      duration: "-P1D",
      expectedError: "VEVENT DURATION must be positive",
      start: "DTSTART;TZID=America/New_York:20260301T003000",
    },
    {
      duration: "PT24H",
      expectedError: "All-day VEVENT DURATION must use weeks or days",
      start: "DTSTART;VALUE=DATE:20260301",
    },
  ])("rejects invalid event duration $duration", ({ duration, expectedError, start }) => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:invalid-duration",
        start,
        `DURATION:${duration}`,
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(() => parseIcsEvents(calendar)).toThrow(expectedError);
  });

  it("keeps duplicate UIDs and preserves adversarial time ranges", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:duplicate-uid",
        "DTSTART:20260310T090000Z",
        "DTEND:20260310T100000Z",
        "SUMMARY:First",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:duplicate-uid",
        "DTSTART:20991231T235900Z",
        "DTEND:19000101T000000Z",
        "SUMMARY:Second",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const parsedEvents = parseIcsEvents(calendar);

    expect(parsedEvents).toHaveLength(2);
    expect(parsedEvents[0]?.uid).toBe("duplicate-uid");
    expect(parsedEvents[1]?.uid).toBe("duplicate-uid");
    expect(parsedEvents[1]?.endTime.getTime()).toBeLessThan(
      parsedEvents[1]?.startTime.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it("does not merge recurring masters that reuse a UID at different slots", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:reused-master@zoho.com",
        "DTSTART:20230727T180000Z",
        "DTEND:20230727T183000Z",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:reused-master@zoho.com",
        "DTSTART:20241127T190000Z",
        "DTEND:20241127T193000Z",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parseIcsEvents(calendar).map((event) => event.startTime.toISOString())).toEqual([
      "2023-07-27T18:00:00.000Z",
      "2024-11-27T19:00:00.000Z",
    ]);
  });

  it("turns a cancelled recurrence override into a master exception", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:cancelled-instance",
        "DTSTART:20260302T100000Z",
        "DTEND:20260302T110000Z",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:cancelled-instance",
        "RECURRENCE-ID:20260309T100000Z",
        "DTSTART:20260309T100000Z",
        "DTEND:20260309T110000Z",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const parsedEvents = parseIcsEvents(calendar);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.exceptionDates?.map((date) => date.date.toISOString())).toEqual([
      "2026-03-09T10:00:00.000Z",
    ]);
  });

  it("drops a cancelled master and all of its detached overrides", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:cancelled-series",
        "DTSTART:20260302T100000Z",
        "DTEND:20260302T110000Z",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:cancelled-series",
        "RECURRENCE-ID:20260309T100000Z",
        "DTSTART:20260310T100000Z",
        "DTEND:20260310T110000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parseIcsEvents(calendar)).toEqual([]);
  });

  it("rejects THISANDFUTURE instead of silently changing its meaning", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:ranged-series",
        "RECURRENCE-ID;RANGE=THISANDFUTURE:20260309T100000Z",
        "DTSTART:20260309T120000Z",
        "DTEND:20260309T130000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(() => parseIcsEvents(calendar)).toThrow(
      "RECURRENCE-ID;RANGE=THISANDFUTURE is not supported for event ranged-series",
    );
  });

  it.each([
    ["cancelled first", ["cancelled", "confirmed"]],
    ["confirmed first", ["confirmed", "cancelled"]],
  ])("uses SEQUENCE instead of input order when a stale cancellation is %s", (description, order) => {
    expect(description).toBeTypeOf("string");
    const revisions = {
      cancelled: [
        "BEGIN:VEVENT",
        "UID:revision-order",
        "DTSTAMP:20260301T000000Z",
        "DTSTART:20260302T100000Z",
        "DTEND:20260302T110000Z",
        "SEQUENCE:1",
        "STATUS:CANCELLED",
        "END:VEVENT",
      ].join("\r\n"),
      confirmed: [
        "BEGIN:VEVENT",
        "UID:revision-order",
        "DTSTAMP:20260302T000000Z",
        "DTSTART:20260302T120000Z",
        "DTEND:20260302T130000Z",
        "SEQUENCE:2",
        "SUMMARY:Current revision",
        "END:VEVENT",
      ].join("\r\n"),
    };
    const resolveRevision = (revision: string): string => {
      if (revision === "cancelled") {
        return revisions.cancelled;
      }
      if (revision === "confirmed") {
        return revisions.confirmed;
      }
      throw new Error(`Unknown revision: ${revision}`);
    };
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        ...order.map((revision) => resolveRevision(revision)),
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const events = parseIcsEvents(calendar);

    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Current revision");
    expect(events[0]?.startTime.toISOString()).toBe("2026-03-02T12:00:00.000Z");
  });

  it.each([
    ["cancelled first", ["cancelled", "confirmed"]],
    ["confirmed first", ["confirmed", "cancelled"]],
  ])("uses revision timestamps when a stale cancellation without SEQUENCE is %s", (_description, order) => {
    const revisions = {
      cancelled: [
        "BEGIN:VEVENT",
        "UID:timestamp-revision-order",
        "DTSTAMP:20260301T000000Z",
        "DTSTART:20260302T100000Z",
        "DTEND:20260302T110000Z",
        "STATUS:CANCELLED",
        "END:VEVENT",
      ].join("\r\n"),
      confirmed: [
        "BEGIN:VEVENT",
        "UID:timestamp-revision-order",
        "DTSTAMP:20260302T000000Z",
        "DTSTART:20260302T120000Z",
        "DTEND:20260302T130000Z",
        "SUMMARY:Current timestamp revision",
        "END:VEVENT",
      ].join("\r\n"),
    };
    const resolveRevision = (revision: string): string => {
      if (revision === "cancelled") {
        return revisions.cancelled;
      }
      if (revision === "confirmed") {
        return revisions.confirmed;
      }
      throw new Error(`Unknown revision: ${revision}`);
    };
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        ...order.map((revision) => resolveRevision(revision)),
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parseIcsEvents(calendar)).toMatchObject([{
      startTime: new Date("2026-03-02T12:00:00.000Z"),
      title: "Current timestamp revision",
    }]);
  });

  it.each([
    ["older first", ["older", "newer"]],
    ["newer first", ["newer", "older"]],
  ])("keeps only the newest moved revision without SEQUENCE when %s", (_description, order) => {
    const revisions = {
      older: [
        "BEGIN:VEVENT",
        "UID:moved-without-sequence",
        "LAST-MODIFIED:20260301T000000Z",
        "DTSTART:20260302T100000Z",
        "DTEND:20260302T110000Z",
        "SUMMARY:Old slot",
        "END:VEVENT",
      ].join("\r\n"),
      newer: [
        "BEGIN:VEVENT",
        "UID:moved-without-sequence",
        "LAST-MODIFIED:20260302T000000Z",
        "DTSTART:20260302T120000Z",
        "DTEND:20260302T130000Z",
        "SUMMARY:New slot",
        "END:VEVENT",
      ].join("\r\n"),
    };
    const resolveRevision = (revision: string): string => {
      if (revision === "older") {
        return revisions.older;
      }
      if (revision === "newer") {
        return revisions.newer;
      }
      throw new Error(`Unknown revision: ${revision}`);
    };
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        ...order.map((revision) => resolveRevision(revision)),
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parseIcsEvents(calendar)).toMatchObject([{
      startTime: new Date("2026-03-02T12:00:00.000Z"),
      title: "New slot",
    }]);
  });

  it("does not resurrect an unversioned slot beside a later versioned restore", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:mixed-revision-metadata",
        "DTSTART:20260310T100000Z",
        "DTEND:20260310T110000Z",
        "SUMMARY:Old unversioned slot",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:mixed-revision-metadata",
        "SEQUENCE:2",
        "DTSTART:20260310T150000Z",
        "DTEND:20260310T160000Z",
        "SUMMARY:Restored current slot",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parseIcsEvents(calendar)).toMatchObject([{
      startTime: new Date("2026-03-10T15:00:00.000Z"),
      title: "Restored current slot",
    }]);
  });
});
