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
