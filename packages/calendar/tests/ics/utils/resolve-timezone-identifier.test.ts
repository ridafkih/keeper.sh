import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDeclaredTimeZoneOffsets,
  resolveDeclaredTimeZone,
  resolveTimeZoneIdentifier,
} from "../../../src/ics/utils/resolve-timezone-identifier";
import { resolveRecurrenceTimeZones } from "../../../src/ics/utils/validate-recurrence-input";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";

const { mockPullRemoteCalendar } = vi.hoisted(() => ({
  mockPullRemoteCalendar: vi.fn<(...args: unknown[]) => Promise<{ ical: string }>>(),
}));
const { mockPrepareCalendarSnapshot } = vi.hoisted(() => ({
  mockPrepareCalendarSnapshot: vi.fn<(...args: unknown[]) => Promise<{ changed: boolean }>>(),
}));

vi.mock("../../../src/ics/utils/pull-remote-calendar", () => ({
  pullRemoteCalendar: mockPullRemoteCalendar,
}));
vi.mock("../../../src/ics/utils/create-snapshot", () => ({
  prepareCalendarSnapshot: mockPrepareCalendarSnapshot,
}));

const INDIA_LABEL = "(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi";
const NEPAL_LABEL = "(UTC+05:45) Kathmandu";
const FIRST_SAMPLE_YEAR = 1990;
const LAST_SAMPLE_YEAR = 2100;
const SAMPLE_MONTHS = [0, 6];

interface Observance {
  from: string;
  kind: "DAYLIGHT" | "STANDARD";
  start: string;
  to: string;
}

const fixedObservance = (offset: string): Observance => ({
  from: offset,
  kind: "STANDARD",
  start: "19700101T000000",
  to: offset,
});

const daylightObservances = (standard: string, daylight: string): Observance[] => [
  { from: daylight, kind: "STANDARD", start: "19701101T020000", to: standard },
  { from: standard, kind: "DAYLIGHT", start: "19700308T020000", to: daylight },
];

const buildVTimeZone = (timeZoneId: string, observances: readonly Observance[]): string[] => [
  "BEGIN:VTIMEZONE",
  `TZID:${timeZoneId}`,
  ...observances.flatMap(({ from, kind, start, to }) => [
    `BEGIN:${kind}`,
    `DTSTART:${start}`,
    `TZOFFSETFROM:${from}`,
    `TZOFFSETTO:${to}`,
    `END:${kind}`,
  ]),
  "END:VTIMEZONE",
];

const buildCalendar = (timeZoneId: string, observances: readonly Observance[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  ...buildVTimeZone(timeZoneId, observances),
  "END:VCALENDAR",
].join("\r\n");

const buildRecurringFeed = (timeZoneId: string, observances: readonly Observance[], uid: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  ...buildVTimeZone(timeZoneId, observances),
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20260517T000000Z",
  `DTSTART;TZID="${timeZoneId}":20260701T090000`,
  `DTEND;TZID="${timeZoneId}":20260701T100000`,
  "RRULE:FREQ=DAILY;COUNT=2",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const declaredOffsetsFor = (timeZoneId: string, observances: readonly Observance[]) =>
  readDeclaredTimeZoneOffsets(buildCalendar(timeZoneId, observances));

const readIntlOffsetMinutes = (timeZone: string, instant: Date): number => {
  const label = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?$/.exec(label);
  if (!match?.groups?.sign) {
    return 0;
  }
  const magnitude = Number(match.groups.hours) * 60 + Number(match.groups.minutes);
  if (match.groups.sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

const sampleInstants = (): Date[] => Array.from(
  { length: LAST_SAMPLE_YEAR - FIRST_SAMPLE_YEAR + 1 },
  (_unused, index) => SAMPLE_MONTHS.map((month) => new Date(Date.UTC(FIRST_SAMPLE_YEAR + index, month, 1))),
).flat();

const buildConfig = () => ({
  calendarId: "calendar-1",
  database: {} as never,
  plan: {
    futureRange: "2_years" as const,
    historicRange: "1_week" as const,
    window: {
      timeMax: new Date("2027-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    },
  },
  url: "https://example.com/calendar.ics",
});

const fetchFeed = async (ical: string) => {
  const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
  mockPullRemoteCalendar.mockResolvedValueOnce({ ical });
  mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });
  return createIcsSourceFetcher(buildConfig()).fetchEvents();
};

const MATERIALIZATION_WINDOW = {
  end: new Date("2026-07-10T00:00:00.000Z"),
  start: new Date("2026-06-25T00:00:00.000Z"),
};

describe("resolveTimeZoneIdentifier with a single declared non-whole-hour offset", () => {
  it.each([
    { identifier: INDIA_LABEL, offset: "+0530", offsetMinutes: 330, timeZone: "Asia/Calcutta" },
    { identifier: NEPAL_LABEL, offset: "+0545", offsetMinutes: 345, timeZone: "Asia/Katmandu" },
    { identifier: "Customized Time Zone", offset: "+0630", offsetMinutes: 390, timeZone: "Asia/Rangoon" },
  ])("resolves $offset to the fixed-offset zone $timeZone", ({ identifier, offset, offsetMinutes, timeZone }) => {
    const resolved = resolveTimeZoneIdentifier(
      identifier,
      declaredOffsetsFor(identifier, [fixedObservance(offset)]),
    );

    expect(resolved).toEqual({ kind: "fixed-offset", offsetMinutes, timeZone });
  });

  it.each([
    { identifier: INDIA_LABEL, offset: "+0530", offsetMinutes: 330 },
    { identifier: NEPAL_LABEL, offset: "+0545", offsetMinutes: 345 },
  ])("picks a zone whose runtime offset is $offset at every sample point", ({ identifier, offset, offsetMinutes }) => {
    const resolved = resolveTimeZoneIdentifier(
      identifier,
      declaredOffsetsFor(identifier, [fixedObservance(offset)]),
    );
    const timeZone = resolved?.timeZone ?? "";

    expect(timeZone).not.toBe("");
    expect(sampleInstants().map((instant) => readIntlOffsetMinutes(timeZone, instant)))
      .toEqual(sampleInstants().map(() => offsetMinutes));
  });

  it.each([
    { identifier: INDIA_LABEL, offset: "+0530", timeZone: "Asia/Calcutta" },
    { identifier: NEPAL_LABEL, offset: "+0545", timeZone: "Asia/Katmandu" },
  ])("resolveDeclaredTimeZone returns $timeZone for a single $offset", ({ identifier, offset, timeZone }) => {
    expect(resolveDeclaredTimeZone(
      identifier,
      declaredOffsetsFor(identifier, [fixedObservance(offset)]),
    )).toBe(timeZone);
  });
});

describe("resolveRecurrenceTimeZones with a single declared non-whole-hour offset", () => {
  it.each([
    { identifier: INDIA_LABEL, offset: "+0530", timeZone: "Asia/Calcutta", uid: "india@test" },
    { identifier: NEPAL_LABEL, offset: "+0545", timeZone: "Asia/Katmandu", uid: "nepal@test" },
  ])("no longer reports the $offset series as unsupported", ({ identifier, offset, timeZone, uid }) => {
    const result = resolveRecurrenceTimeZones(
      [{ recurrenceRule: { frequency: "DAILY" as const }, startTimeZone: identifier, uid }],
      declaredOffsetsFor(identifier, [fixedObservance(offset)]),
    );

    expect(result.unsupportedUids).toEqual([]);
    expect(result.events[0]?.startTimeZone).toBe(timeZone);
  });
});

describe("ingesting a recurring event in a custom single-offset zone", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it.each([
    {
      identifier: INDIA_LABEL,
      occurrences: ["2026-07-01T03:30:00.000Z", "2026-07-02T03:30:00.000Z"],
      offset: "+0530",
      timeZone: "Asia/Calcutta",
      uid: "india-standup@test",
    },
    {
      identifier: NEPAL_LABEL,
      occurrences: ["2026-07-01T03:15:00.000Z", "2026-07-02T03:15:00.000Z"],
      offset: "+0545",
      timeZone: "Asia/Katmandu",
      uid: "nepal-standup@test",
    },
    {
      identifier: "(UTC-05:00) Bogota, Lima, Quito, Rio Branco",
      occurrences: ["2026-07-01T14:00:00.000Z", "2026-07-02T14:00:00.000Z"],
      offset: "-0500",
      timeZone: "Etc/GMT+5",
      uid: "whole-hour-standup@test",
    },
  ])("keeps the $offset series and places it at the declared offset", async ({ identifier, occurrences, offset, timeZone, uid }) => {
    const result = await fetchFeed(buildRecurringFeed(identifier, [fixedObservance(offset)], uid));
    const [master] = result.events;

    expect(result.unsupportedEventUids).toBeUndefined();
    expect(master).toMatchObject({
      startTime: new Date(occurrences[0] ?? ""),
      startTimeZone: timeZone,
      uid,
    });
    if (!master) {
      return;
    }

    const materialized = materializeRecurrenceEvents([{
      calendarId: "calendar-1",
      calendarName: null,
      calendarUrl: null,
      endTime: master.endTime,
      id: "event-1",
      recurrenceRule: master.recurrenceRule,
      sourceEventUid: uid,
      startTime: master.startTime,
      startTimeZone: master.startTimeZone,
      summary: "Standup",
    }], MATERIALIZATION_WINDOW);

    expect(materialized.map(({ startTime }) => startTime.toISOString())).toEqual(occurrences);
  });

  it("still withholds a series whose single declared offset no IANA zone holds", async () => {
    const identifier = "(UTC-03:30) Custom";
    const result = await fetchFeed(buildRecurringFeed(identifier, [fixedObservance("-0330")], "custom@test"));

    expect(result.unsupportedEventUids).toEqual(["custom@test"]);
  });
});

describe("resolveTimeZoneIdentifier regression table", () => {
  it.each([
    { identifier: "Asia/Calcutta", timeZone: "Asia/Calcutta" },
    { identifier: "US/Eastern", timeZone: "US/Eastern" },
    { identifier: "Asia/Rangoon", timeZone: "Asia/Rangoon" },
    { identifier: "Europe/Kiev", timeZone: "Europe/Kiev" },
    { identifier: "Asia/Kathmandu", timeZone: "Asia/Kathmandu" },
    { identifier: "Pacific/Chatham", timeZone: "Pacific/Chatham" },
    { identifier: "Eastern Standard Time", timeZone: "America/New_York" },
    { identifier: "Alberta Standard Time", timeZone: "America/Edmonton" },
    { identifier: "/mozilla.org/20050126_1/America/Denver", timeZone: "America/Denver" },
    { identifier: "/citadel.org/20190914_1/Europe/London", timeZone: "Europe/London" },
  ])("resolves '$identifier' to the IANA zone $timeZone", ({ identifier, timeZone }) => {
    expect(resolveTimeZoneIdentifier(identifier)).toEqual({ kind: "iana", timeZone });
  });

  it.each([
    { identifier: "Asia/Calcutta", timeZone: "Asia/Calcutta" },
    { identifier: "US/Eastern", timeZone: "US/Eastern" },
    { identifier: "Asia/Rangoon", timeZone: "Asia/Rangoon" },
    { identifier: "Europe/Kiev", timeZone: "Europe/Kiev" },
    { identifier: "Asia/Kathmandu", timeZone: "Asia/Kathmandu" },
    { identifier: "Pacific/Chatham", timeZone: "Pacific/Chatham" },
    { identifier: "Eastern Standard Time", timeZone: "America/New_York" },
    { identifier: "Alberta Standard Time", timeZone: "America/Edmonton" },
    { identifier: "/mozilla.org/20050126_1/America/Denver", timeZone: "America/Denver" },
    { identifier: "/citadel.org/20190914_1/Europe/London", timeZone: "Europe/London" },
  ])("resolveDeclaredTimeZone keeps resolving '$identifier' to $timeZone", ({ identifier, timeZone }) => {
    expect(resolveDeclaredTimeZone(identifier, new Map())).toBe(timeZone);
  });

  it("prefers a Windows name's CLDR zone over its declared offsets", () => {
    const declared = declaredOffsetsFor("Eastern Standard Time", daylightObservances("-0500", "-0400"));

    expect(resolveTimeZoneIdentifier("Eastern Standard Time", declared))
      .toEqual({ kind: "iana", timeZone: "America/New_York" });
  });

  it.each([
    { offset: "-0700", offsetMinutes: -420, timeZone: "Etc/GMT+7" },
    { offset: "+0000", offsetMinutes: 0, timeZone: "Etc/UTC" },
    { offset: "+1400", offsetMinutes: 840, timeZone: "Etc/GMT-14" },
    { offset: "-1200", offsetMinutes: -720, timeZone: "Etc/GMT+12" },
  ])("maps a single whole-hour $offset onto $timeZone", ({ offset, offsetMinutes, timeZone }) => {
    const declared = declaredOffsetsFor("Customized Time Zone", [fixedObservance(offset)]);

    expect(resolveDeclaredTimeZone("Customized Time Zone", declared)).toBe(timeZone);
    expect(resolveTimeZoneIdentifier("Customized Time Zone", declared))
      .toEqual({ kind: "fixed-offset", offsetMinutes, timeZone });
  });
});

describe("resolveTimeZoneIdentifier leaves unresolvable identifiers unresolved", () => {
  it.each([
    { name: "a DST zone between -0700 and -0600", observances: daylightObservances("-0700", "-0600") },
    { name: "a DST zone between +0530 and +0630", observances: daylightObservances("+0530", "+0630") },
    { name: "an LMT-style offset with seconds", observances: [fixedObservance("+053328")] },
    { name: "an offset beyond +14:00", observances: [fixedObservance("+1430")] },
    { name: "an offset beyond -14:00", observances: [fixedObservance("-1500")] },
    { name: "an offset no IANA zone holds constant", observances: [fixedObservance("-0330")] },
    { name: "a no-DST +12:45 offset", observances: [fixedObservance("+1245")] },
  ])("returns undefined for $name", ({ observances }) => {
    const declared = declaredOffsetsFor("Customized Time Zone", observances);

    expect(resolveTimeZoneIdentifier("Customized Time Zone", declared)).toBeUndefined();
    expect(resolveDeclaredTimeZone("Customized Time Zone", declared)).toBeUndefined();
  });

  it.each([
    "GMT+8",
    "(UTC+08:00) Kuala Lumpur, Singapore",
    "Customized Time Zone",
    "Invented/Timezone",
  ])("never parses the bare label '%s' without a declared VTIMEZONE", (identifier) => {
    expect(resolveTimeZoneIdentifier(identifier)).toBeUndefined();
    expect(resolveTimeZoneIdentifier(identifier, new Map())).toBeUndefined();
    expect(resolveDeclaredTimeZone(identifier, new Map())).toBeUndefined();
  });

  it("returns undefined for an empty identifier", () => {
    expect(resolveTimeZoneIdentifier(globalThis.undefined)).toBeUndefined();
    expect(resolveTimeZoneIdentifier("")).toBeUndefined();
  });

  it("does not take a fixed offset without declared offsets", () => {
    expect(resolveTimeZoneIdentifier(INDIA_LABEL)).toBeUndefined();
  });
});
