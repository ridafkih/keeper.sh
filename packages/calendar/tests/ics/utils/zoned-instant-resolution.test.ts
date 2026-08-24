import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../../src/ics";
import {
  eventToICalString,
  parseICalToRemoteEvent,
} from "../../../src/providers/caldav/shared/ics";
import type { MaterializedSyncableEvent } from "../../../src/core/types";

const buildCalendar = (lines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  ...lines,
  "END:VCALENDAR",
].join("\r\n");

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-14T07:29:30.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-14T06:59:30.000Z"),
  startTimeZone: "America/New_York",
  summary: "Standup",
  ...overrides,
} as MaterializedSyncableEvent);

const RECURRING_OBSERVANCE_CALENDAR = buildCalendar([
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:STANDARD",
  "DTSTART:20260101T000000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0500",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:20260308T020000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "DTSTART:20261101T020000",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:before-transition",
  "DTSTART;TZID=America/New_York:20270314T015930",
  "DTEND;TZID=America/New_York:20270314T032930",
  "SUMMARY:Standup",
  "END:VEVENT",
]);

describe("resolving TZID wall times against projected observances", () => {
  it("keeps a wall time in the hour before a projected transition on the standard side", () => {
    const calendar = parseIcsCalendar({ icsString: RECURRING_OBSERVANCE_CALENDAR });
    const [event] = calendar.events ?? [];

    expect(event?.start.date.toISOString()).toBe("2027-03-14T06:59:30.000Z");
    expect(event?.end?.date.toISOString()).toBe("2027-03-14T07:29:30.000Z");
  });

  it("resolves the first pass of a projected fall-back hour", () => {
    const icsString = buildCalendar([
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "BEGIN:STANDARD",
      "DTSTART:20261025T030000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:20260329T020000",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:repeated-hour",
      "DTSTART;TZID=Europe/Berlin:20271031T025930",
      "DTEND;TZID=Europe/Berlin:20271031T025930",
      "SUMMARY:Standup",
      "END:VEVENT",
    ]);

    const calendar = parseIcsCalendar({ icsString });
    const [event] = calendar.events ?? [];

    expect(event?.start.date.toISOString()).toBe("2027-10-31T00:59:30.000Z");
  });

  it("keeps an explicit observance set with no projection authoritative", () => {
    const icsString = buildCalendar([
      "BEGIN:VTIMEZONE",
      "TZID:America/New_York",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0500",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:explicit-observance",
      "DTSTART;TZID=America/New_York:20270701T120000",
      "DTEND;TZID=America/New_York:20270701T130000",
      "SUMMARY:Standup",
      "END:VEVENT",
    ]);

    const calendar = parseIcsCalendar({ icsString });
    const [event] = calendar.events ?? [];

    expect(event?.start.date.toISOString()).toBe("2027-07-01T17:00:00.000Z");
  });

  it("leaves a TZID the platform cannot resolve to its declared observances", () => {
    const icsString = buildCalendar([
      "BEGIN:VTIMEZONE",
      "TZID:Customized Time Zone",
      "BEGIN:STANDARD",
      "DTSTART:20260101T000000",
      "TZOFFSETFROM:+0530",
      "TZOFFSETTO:+0530",
      "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=1",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:custom-zone",
      "DTSTART;TZID=Customized Time Zone:20270701T120000",
      "DTEND;TZID=Customized Time Zone:20270701T130000",
      "SUMMARY:Standup",
      "END:VEVENT",
    ]);

    const calendar = parseIcsCalendar({ icsString });
    const [event] = calendar.events ?? [];

    expect(event?.start.date.toISOString()).toBe("2027-07-01T06:30:00.000Z");
  });
});

describe("writing an instant a wall clock cannot name", () => {
  it("round trips an event in the hour before a spring-forward transition", () => {
    const icsString = eventToICalString(buildEvent({}), "destination-uid");

    expect(icsString).toContain("DTSTART;TZID=America/New_York:20270314T015930");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTime.toISOString()).toBe("2027-03-14T06:59:30.000Z");
    expect(parsedEvent?.endTime.toISOString()).toBe("2027-03-14T07:29:30.000Z");
    expect(parsedEvent?.startTimeZone).toBe("America/New_York");
  });

  it("writes the second pass of a fall-back hour in UTC so the instant survives", () => {
    const icsString = eventToICalString(
      buildEvent({
        endTime: new Date("2027-10-31T01:59:30.000Z"),
        startTime: new Date("2027-10-31T01:29:30.000Z"),
        startTimeZone: "Europe/Berlin",
      }),
      "destination-uid",
    );

    expect(icsString).toContain("DTSTART:20271031T012930Z");
    expect(icsString).not.toContain("DTSTART;TZID=Europe/Berlin:20271031T022930");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTime.toISOString()).toBe("2027-10-31T01:29:30.000Z");
    expect(parsedEvent?.endTime.toISOString()).toBe("2027-10-31T01:59:30.000Z");
  });

  it("keeps the TZID form for the first pass of a fall-back hour", () => {
    const icsString = eventToICalString(
      buildEvent({
        endTime: new Date("2027-10-31T00:59:30.000Z"),
        startTime: new Date("2027-10-31T00:59:30.000Z"),
        startTimeZone: "Europe/Berlin",
      }),
      "destination-uid",
    );

    expect(icsString).toContain("DTSTART;TZID=Europe/Berlin:20271031T025930");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTime.toISOString()).toBe("2027-10-31T00:59:30.000Z");
    expect(parsedEvent?.startTimeZone).toBe("Europe/Berlin");
  });
});
