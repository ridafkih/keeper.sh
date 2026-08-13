import { describe, expect, it } from "vitest";
import {
  eventToICalString,
  parseICalToRemoteEvent,
} from "../../../../src/providers/caldav/shared/ics";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  calendarId: "calendar-id",
  calendarName: "Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-id",
  sourceEventUid: "source-uid",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Standup",
  ...overrides,
} as MaterializedSyncableEvent);

describe("eventToICalString timezone round trip", () => {
  it.each([
    {
      endTime: new Date("2026-03-08T15:00:00.000Z"),
      startTime: new Date("2026-03-08T14:00:00.000Z"),
      timezone: "America/Edmonton",
    },
    {
      endTime: new Date("2026-03-08T14:00:00.000Z"),
      startTime: new Date("2026-03-08T13:00:00.000Z"),
      timezone: "America/New_York",
    },
    {
      endTime: new Date("2026-04-04T23:00:00.000Z"),
      startTime: new Date("2026-04-04T22:00:00.000Z"),
      timezone: "Australia/Sydney",
    },
  ])("preserves the instant across a $timezone transition", (scenario) => {
    const icsString = eventToICalString(
      buildEvent({
        endTime: scenario.endTime,
        startTime: scenario.startTime,
        startTimeZone: scenario.timezone,
      }),
      "destination-uid",
    );

    expect(icsString).toContain(`BEGIN:VTIMEZONE`);
    expect(icsString).toContain(`TZID:${scenario.timezone}`);

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTime.toISOString()).toBe(scenario.startTime.toISOString());
    expect(parsedEvent?.endTime.toISOString()).toBe(scenario.endTime.toISOString());
    expect(parsedEvent?.startTimeZone).toBe(scenario.timezone);
  });

  it("omits VTIMEZONE for all-day events", () => {
    const icsString = eventToICalString(
      buildEvent({
        endTime: new Date("2026-03-09T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2026-03-08T00:00:00.000Z"),
        startTimeZone: "America/Edmonton",
      }),
      "destination-uid",
    );

    expect(icsString).not.toContain("BEGIN:VTIMEZONE");
    expect(icsString).toContain("DTSTART;VALUE=DATE:20260308");
  });
});

describe("parsing a TZID with no VTIMEZONE", () => {
  it("resolves the IANA zone instead of guessing the offset", () => {
    const icsString = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:no-vtimezone",
      "DTSTART;TZID=America/Edmonton:20260308T080000",
      "DTEND;TZID=America/Edmonton:20260308T090000",
      "SUMMARY:Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTime.toISOString()).toBe("2026-03-08T14:00:00.000Z");
    expect(parsedEvent?.endTime.toISOString()).toBe("2026-03-08T15:00:00.000Z");
    expect(parsedEvent?.startTimeZone).toBe("America/Edmonton");
  });

  it("resolves a quoted TZID parameter", () => {
    const icsString = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VEVENT",
      "UID:quoted-tzid",
      "DTSTART;TZID=\"Europe/Berlin\":20260705T120000",
      "DTEND;TZID=\"Europe/Berlin\":20260705T130000",
      "SUMMARY:Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTime.toISOString()).toBe("2026-07-05T10:00:00.000Z");
    expect(parsedEvent?.endTime.toISOString()).toBe("2026-07-05T11:00:00.000Z");
  });

  it("keeps an explicit VTIMEZONE authoritative over the IANA database", () => {
    const icsString = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:America/Edmonton",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:-0700",
      "TZOFFSETTO:-0700",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:explicit-vtimezone",
      "DTSTART;TZID=America/Edmonton:20260308T080000",
      "DTEND;TZID=America/Edmonton:20260308T090000",
      "SUMMARY:Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.startTime.toISOString()).toBe("2026-03-08T15:00:00.000Z");
  });
});
