import { describe, expect, test } from "vitest";
import { isIanaAuthoritative, projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const projectedObservanceZone = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
] as const;

const explicitObservanceZone = [
  "BEGIN:VTIMEZONE",
  "TZID:Acme/Fixed-Rules",
  "BEGIN:STANDARD",
  "DTSTART:20261025T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:20260329T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
] as const;

const eventInTheHourBefore = (tzid: string): readonly string[] =>
  vevent({
    uid: "evt-before-transition",
    lines: [
      "DTSTAMP:20261001T000000Z",
      `DTSTART;TZID=${tzid}:20261025T023000`,
      `DTEND;TZID=${tzid}:20261025T024500`,
      "SUMMARY:the hour before the onset",
    ],
  });

const startOf = (body: string): string => {
  const projection = projectIcsFeed({
    body,
    scope: testScope,
    previousContentHash: null,
    options: testOptions(),
  });
  if (!projection.ok) {
    return "refused";
  }
  const [event] = projection.value.listing.events;
  if (!event || !event.content.time) {
    return "none";
  }
  if (event.content.time.kind !== "timed") {
    return "allDay";
  }
  return event.content.time.start.value;
};

describe("who decides the instant a wall time names", () => {
  test("ICAL-O26: a wall time in the hour before a projected transition takes the instant IANA names", () => {
    const body = calendarWith([
      ...projectedObservanceZone,
      ...eventInTheHourBefore("Europe/Berlin"),
    ]);

    expect(startOf(body)).toBe("2026-10-25T00:30:00.000Z");
  });

  test("ICAL-O26: the time of day survives the RRULE onset rather than being dropped", () => {
    const body = calendarWith([
      ...projectedObservanceZone,
      ...eventInTheHourBefore("Europe/Berlin"),
    ]);

    expect(startOf(body)).not.toContain("T00:00:00");
  });

  test("ICAL-O27: an explicit observance set with no projection stays authoritative", () => {
    const body = calendarWith([
      ...explicitObservanceZone,
      ...eventInTheHourBefore("Acme/Fixed-Rules"),
    ]);

    expect(startOf(body)).toBe("2026-10-25T00:30:00.000Z");
  });

  test("ICAL-I19: IANA is authoritative for a zone the platform knows whose block projects", () => {
    expect(
      isIanaAuthoritative(
        { declaredId: "Europe/Berlin", observances: "projected", offsets: [60, 120] },
        { kind: "zoneId", value: "Europe/Berlin" },
      ),
    ).toBe(true);
  });

  test("ICAL-I19: an explicit observance set is authoritative even for a zone IANA knows", () => {
    expect(
      isIanaAuthoritative(
        { declaredId: "Europe/Berlin", observances: "explicit", offsets: [60, 120] },
        { kind: "zoneId", value: "Europe/Berlin" },
      ),
    ).toBe(false);
  });

  test("ICAL-I19: with no declared block at all, IANA decides", () => {
    expect(isIanaAuthoritative(null, { kind: "zoneId", value: "Europe/Berlin" })).toBe(true);
  });
});
