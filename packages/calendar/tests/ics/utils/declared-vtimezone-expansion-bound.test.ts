import { describe, expect, it } from "vitest";
import { readCalendarOutcome } from "../fixtures/declared-timezones/read-corpus-outcomes";

const EXPANSION_BUDGET_MS = 2000;

const buildCustomZoneCalendar = (observanceStart: string, rule: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Hostile zone//EN",
  "BEGIN:VTIMEZONE",
  "TZID:Custom Zone",
  "BEGIN:STANDARD",
  `DTSTART:${observanceStart}`,
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0700",
  `RRULE:${rule}`,
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  `DTSTART:${observanceStart}`,
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0600",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:custom-zone-event",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;TZID=Custom Zone:20260715T090000",
  "DTEND;TZID=Custom Zone:20260715T100000",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const readWithinBudget = (icsString: string) => {
  const startedAt = performance.now();
  const outcome = readCalendarOutcome([icsString]);
  return { elapsedMs: performance.now() - startedAt, outcome };
};

describe("declared VTIMEZONE observances that would expand without bound", () => {
  it.each([
    ["FREQ=MINUTELY", "19900101T020000"],
    ["FREQ=SECONDLY", "19900101T020000"],
    ["FREQ=DAILY", "16010101T020000"],
    ["FREQ=YEARLY;BYMONTH=11;BYDAY=1SU;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11;BYMINUTE=0,1,2,3,4,5", "16010101T020000"],
    [`FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYMONTHDAY=${Array.from({ length: 31 }, (_unused, day) => day + 1).join(",")}`, "16010101T020000"],
  ])("withholds an event in a zone whose observance repeats %s from %s, within the budget", (rule, observanceStart) => {
    const { elapsedMs, outcome } = readWithinBudget(buildCustomZoneCalendar(observanceStart, rule));

    expect(outcome).toEqual({ "custom-zone-event": "unsupported" });
    expect(elapsedMs).toBeLessThan(EXPANSION_BUDGET_MS);
  });

  it("still reads a yearly custom zone declared from 1601, as Exchange writes them", () => {
    const { outcome } = readWithinBudget(
      buildCustomZoneCalendar("16010101T020000", "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"),
    );

    expect(outcome).toEqual({
      "custom-zone-event": { end: "2026-07-15T16:00:00.000Z", start: "2026-07-15T15:00:00.000Z" },
    });
  });

  it.each([
    ["FREQ=MONTHLY;BYMONTH=11;BYDAY=1SU", "16010101T020000"],
    ["FREQ=MONTHLY;INTERVAL=12;BYDAY=1SU", "16011101T020000"],
    ["FREQ=WEEKLY;INTERVAL=520;COUNT=3", "20251102T020000"],
  ])("still reads a custom zone whose observance repeats %s from %s, as its yearly form would", (rule, observanceStart) => {
    const { outcome } = readWithinBudget(buildCustomZoneCalendar(observanceStart, rule));

    expect(outcome).toEqual({
      "custom-zone-event": { end: "2026-07-15T16:00:00.000Z", start: "2026-07-15T15:00:00.000Z" },
    });
  });
});

const NEAR_LIMIT_RULE = `FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYMONTHDAY=${Array.from({ length: 9 }, (_unused, day) => day + 1).join(",")}`;

const OBSERVANCE_OFFSETS: Record<string, { from: string; to: string }> = {
  DAYLIGHT: { from: "-0700", to: "-0600" },
  STANDARD: { from: "-0600", to: "-0700" },
};

const buildObservance = (name: "DAYLIGHT" | "STANDARD", rule: string): string[] => [
  `BEGIN:${name}`,
  "DTSTART:16010101T020000",
  `TZOFFSETFROM:${OBSERVANCE_OFFSETS[name]?.from}`,
  `TZOFFSETTO:${OBSERVANCE_OFFSETS[name]?.to}`,
  `RRULE:${rule}`,
  `END:${name}`,
];

const OBSERVANCE_NAMES = ["STANDARD", "DAYLIGHT"] as const;

const buildAlternatingObservances = (count: number): string[][] =>
  Array.from({ length: count }, (_unused, index) =>
    buildObservance(OBSERVANCE_NAMES[index % OBSERVANCE_NAMES.length] ?? "STANDARD", NEAR_LIMIT_RULE));

const buildZone = (timeZoneId: string, observances: string[][]): string[] => [
  "BEGIN:VTIMEZONE",
  `TZID:${timeZoneId}`,
  ...observances.flat(),
  "END:VTIMEZONE",
];

const buildZonedEvent = (uid: string, timeZoneId: string, date = "20260715"): string[] => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20260101T000000Z",
  `DTSTART;TZID=${timeZoneId}:${date}T090000`,
  `DTEND;TZID=${timeZoneId}:${date}T100000`,
  "SUMMARY:Standup",
  "END:VEVENT",
];

const buildCalendar = (blocks: string[][]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Hostile zone//EN",
  ...blocks.flat(),
  "END:VCALENDAR",
].join("\r\n");

describe("declared VTIMEZONEs whose observances expand within bound one by one", () => {
  it("withholds an event in a zone whose many observances together would expand without bound, within the budget", () => {
    const { elapsedMs, outcome } = readWithinBudget(buildCalendar([
      buildZone("Crowded Zone", buildAlternatingObservances(100)),
      buildZonedEvent("crowded-zone-event", "Crowded Zone"),
    ]));

    expect(outcome).toEqual({ "crowded-zone-event": "unsupported" });
    expect(elapsedMs).toBeLessThan(EXPANSION_BUDGET_MS);
  });

  it("withholds events once the calendar's zones together would expand without bound, within the budget", () => {
    const zoneIds = Array.from({ length: 6 }, (_unused, index) => `Near Limit Zone ${index}`);
    const { elapsedMs, outcome } = readWithinBudget(buildCalendar([
      ...zoneIds.map((zoneId) => buildZone(zoneId, [
        buildObservance("STANDARD", NEAR_LIMIT_RULE),
        buildObservance("DAYLIGHT", "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"),
      ])),
      ...zoneIds.map((zoneId, index) => buildZonedEvent(`near-limit-event-${index}`, zoneId)),
    ]));

    expect(outcome[`near-limit-event-${zoneIds.length - 1}`]).toBe("unsupported");
    expect(elapsedMs).toBeLessThan(EXPANSION_BUDGET_MS);
  });

  it("still reads every event when a calendar's custom zones carry events across many later years", () => {
    const zoneIds = Array.from({ length: 15 }, (_unused, index) => `Exchange Zone ${index}`);
    const years = Array.from({ length: 25 }, (_unused, index) => 2026 + index);
    const { outcome } = readWithinBudget(buildCalendar([
      ...zoneIds.map((zoneId) => buildZone(zoneId, [
        buildObservance("STANDARD", "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"),
        buildObservance("DAYLIGHT", "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"),
      ])),
      ...years.flatMap((year) => zoneIds.map((zoneId, index) =>
        buildZonedEvent(`exchange-event-${index}-${year}`, zoneId, `${year}0715`))),
    ]));

    expect(Object.values(outcome)).toHaveLength(zoneIds.length * years.length);
    expect(Object.values(outcome)).not.toContain("unsupported");
    expect(outcome["exchange-event-0-2050"]).toEqual({
      end: "2050-07-15T16:00:00.000Z",
      start: "2050-07-15T15:00:00.000Z",
    });
  });

  it("still reads every event in a calendar that declares many small custom zones", () => {
    const zoneIds = Array.from({ length: 40 }, (_unused, index) => `Exchange Zone ${index}`);
    const { outcome } = readWithinBudget(buildCalendar([
      ...zoneIds.map((zoneId) => buildZone(zoneId, [
        buildObservance("STANDARD", "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"),
        buildObservance("DAYLIGHT", "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"),
      ])),
      ...zoneIds.map((zoneId, index) => buildZonedEvent(`exchange-event-${index}`, zoneId)),
    ]));

    expect(Object.values(outcome)).toHaveLength(zoneIds.length);
    expect(Object.values(outcome)).not.toContain("unsupported");
  });
});
