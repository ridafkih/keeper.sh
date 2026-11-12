import { readFileSync } from "node:fs";
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

  it("follows IANA rules for an IANA TZID even when its declared observances disagree", () => {
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

    expect(event?.start.date.toISOString()).toBe("2027-07-01T16:00:00.000Z");
  });

  it("resolves a zone whose later onsets are listed as RDATEs by its current offset", () => {
    const icsString = buildCalendar([
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Manila",
      "BEGIN:STANDARD",
      "DTSTART:18990906T120352",
      "TZOFFSETFROM:+080352",
      "TZOFFSETTO:+0800",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:19361101T000000",
      "RDATE:19411216T000000",
      "RDATE:19540412T000000",
      "RDATE:19770328T000000",
      "RDATE:19900521T000000",
      "TZOFFSETFROM:+0800",
      "TZOFFSETTO:+0900",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:19370116T000000",
      "RDATE:19451201T000000",
      "RDATE:19540605T000000",
      "RDATE:19770922T000000",
      "RDATE:19900729T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0800",
      "END:STANDARD",
      "BEGIN:STANDARD",
      "DTSTART:19420212T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:19450304T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:listed-onsets",
      "DTSTART;TZID=Asia/Manila:20261105T100000",
      "DTEND;TZID=Asia/Manila:20261105T110000",
      "SUMMARY:Standup",
      "END:VEVENT",
    ]);

    const calendar = parseIcsCalendar({ icsString });
    const [event] = calendar.events ?? [];

    expect(event?.start.date.toISOString()).toBe("2026-11-05T02:00:00.000Z");
    expect(event?.end?.date.toISOString()).toBe("2026-11-05T03:00:00.000Z");
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

const MANILA_HISTORY_BLOCK = [
  "BEGIN:VTIMEZONE",
  "TZID:Philippine Time",
  "BEGIN:STANDARD",
  "DTSTART:18990906T120352",
  "TZOFFSETFROM:+080352",
  "TZOFFSETTO:+0800",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

const LOCAL_MEAN_TIME_MINUTES = 29_032 / 60;

describe("reading offsets from a declared VTIMEZONE", () => {
  it("keeps a seconds-precision offset before the first onset unrounded", async () => {
    const { declaredZoneOffsetAt } = await import("../../../src/ics/utils/declared-timezone-offsets");
    const offsetAt = declaredZoneOffsetAt(MANILA_HISTORY_BLOCK);

    expect(offsetAt?.(new Date("1899-01-01T00:00:00.000Z"))).toBeCloseTo(LOCAL_MEAN_TIME_MINUTES, 10);
    expect(offsetAt?.(new Date("1900-01-01T00:00:00.000Z"))).toBe(480);
  });

  it("has no offsets for a block without a usable observance", async () => {
    const { declaredZoneOffsetAt } = await import("../../../src/ics/utils/declared-timezone-offsets");

    expect(declaredZoneOffsetAt(["BEGIN:VTIMEZONE", "TZID:Empty", "END:VTIMEZONE"].join("\r\n")))
      .toBeUndefined();
    expect(declaredZoneOffsetAt("not a calendar component")).toBeUndefined();
  });
});

const readSource = (name: string): string =>
  readFileSync(new URL(`../../../src/ics/utils/${name}`, import.meta.url), "utf8");

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|^\s*\/\/|\s\/\/\s/m;
const ZONE_LITERAL_PATTERN = /["'`](?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z_]+/;

describe("the zoned instant engine sources", () => {
  it.each(["resolve-zoned-instants.ts", "declared-timezone-offsets.ts"])("%s carries no comments", (name) => {
    expect(readSource(name)).not.toMatch(COMMENT_PATTERN);
  });

  it.each(["resolve-zoned-instants.ts", "declared-timezone-offsets.ts"])("%s names no zone", (name) => {
    expect(readSource(name)).not.toMatch(ZONE_LITERAL_PATTERN);
  });
});
