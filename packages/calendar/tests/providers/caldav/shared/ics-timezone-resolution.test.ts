import { describe, expect, it } from "vitest";
import { parseICalCalendarsToRemoteEvents } from "../../../../src/providers/caldav/shared/ics";
import { extractVtimezones } from "../../../../src/ics/utils/extract-vtimezones";

const ZONE = "America/New_York";

const VTIMEZONE_LINES = [
  "BEGIN:VTIMEZONE",
  `TZID:${ZONE}`,
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

interface SyntheticEvent {
  date: string;
  startHour: string;
  uid: string;
  zoned: boolean;
}

const dateProperty = (name: string, stamp: string, zoned: boolean): string => {
  if (zoned) {
    return `${name};TZID=${ZONE}:${stamp}`;
  }
  return `${name}:${stamp}Z`;
};

const buildIcs = (events: SyntheticEvent[], withVtimezone: boolean): string => {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//Keeper Test//EN"];
  if (withVtimezone) {
    lines.push(...VTIMEZONE_LINES);
  }
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}@synthetic.invalid`,
      "DTSTAMP:20260101T000000Z",
      dateProperty("DTSTART", `${event.date}T${event.startHour}0000`, event.zoned),
      dateProperty("DTEND", `${event.date}T${event.startHour}3000`, event.zoned),
      `SUMMARY:Synthetic ${event.uid}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
};

describe("VTIMEZONE resolution correctness", () => {
  it("resolves instants on both sides of a spring-forward transition", () => {
    const icsString = buildIcs(
      [
        { date: "20260301", startHour: "09", uid: "before-transition", zoned: true },
        { date: "20260315", startHour: "09", uid: "after-transition", zoned: true },
      ],
      true,
    );

    const { events } = parseICalCalendarsToRemoteEvents([icsString]);
    const before = events.find((event) => event.uid.startsWith("before-transition"));
    const after = events.find((event) => event.uid.startsWith("after-transition"));

    expect(before?.startTime.toISOString()).toBe("2026-03-01T14:00:00.000Z");
    expect(before?.endTime.toISOString()).toBe("2026-03-01T14:30:00.000Z");
    expect(after?.startTime.toISOString()).toBe("2026-03-15T13:00:00.000Z");
    expect(after?.endTime.toISOString()).toBe("2026-03-15T13:30:00.000Z");
    expect(before?.startTimeZone).toBe(ZONE);
    expect(after?.startTimeZone).toBe(ZONE);
  });

  it("leaves an event with no TZID unshifted when a VTIMEZONE is present", () => {
    const icsString = buildIcs(
      [{ date: "20260315", startHour: "09", uid: "utc-event", zoned: false }],
      true,
    );

    const [event] = parseICalCalendarsToRemoteEvents([icsString]).events;

    expect(event?.startTime.toISOString()).toBe("2026-03-15T09:00:00.000Z");
    expect(event?.startTimeZone).toBeUndefined();
  });
});

describe("what reaches the ics library", () => {
  it("takes a windows-named zone out and keeps its block under that name", () => {
    const windowsZone = buildIcs(
      [{ date: "20260315", startHour: "09", uid: "any", zoned: true }],
      true,
    ).replaceAll(ZONE, "Eastern Standard Time");

    const extracted = extractVtimezones(windowsZone);

    expect(extracted.icsString).not.toContain("BEGIN:VTIMEZONE");
    expect([...extracted.blocksByTimeZoneId.keys()]).toEqual(["Eastern Standard Time"]);
  });

  it("takes a projected zone out, because expanding its rules is per-event work", () => {
    const extracted = extractVtimezones(buildIcs(
      [{ date: "20260315", startHour: "09", uid: "any", zoned: true }],
      true,
    ));

    expect(extracted.icsString).not.toContain("BEGIN:VTIMEZONE");
    expect(extracted.blocksByTimeZoneId.get(ZONE)).toContain("RRULE:");
  });

  it("takes a fixed-offset zone out too, so one engine reads every declared offset", () => {
    const fixedOffsetZone = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:Etc/GMT+5",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0500",
      "END:STANDARD",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ].join("\r\n");

    const extracted = extractVtimezones(fixedOffsetZone);

    expect(extracted.icsString).not.toContain("BEGIN:VTIMEZONE");
    expect(extracted.blocksByTimeZoneId.get("Etc/GMT+5")).toContain("TZOFFSETTO:-0500");
  });

  it("keeps the block of a zone whose id we cannot resolve ourselves, so its own rules still apply", () => {
    const unknownZone = buildIcs(
      [{ date: "20260315", startHour: "09", uid: "any", zoned: true }],
      true,
    ).replaceAll(ZONE, "Mars/Olympus_Mons");

    const extracted = extractVtimezones(unknownZone);

    expect(extracted.icsString).not.toContain("BEGIN:VTIMEZONE");
    expect(extracted.blocksByTimeZoneId.get("Mars/Olympus_Mons")).toContain("RRULE:");
  });
});
