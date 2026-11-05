import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";
import { soleFingerprint } from "../support/canonical";

const berlinVtimezone = [
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

const seriesWith = (rule: string): readonly string[] =>
  vevent({
    uid: "evt-series",
    lines: [
      "DTSTAMP:20260301T080000Z",
      "DTSTART;TZID=Europe/Berlin:20260302T090000",
      "DTEND;TZID=Europe/Berlin:20260302T100000",
      `RRULE:${rule}`,
      "SUMMARY:weekly sync",
    ],
  });

const tokyoFullDay = (exdate: string): readonly string[] =>
  vevent({
    uid: "evt-full-day",
    lines: [
      "DTSTAMP:20260301T080000Z",
      "DTSTART;TZID=Asia/Tokyo:20260310T000000",
      "DTEND;TZID=Asia/Tokyo:20260311T000000",
      "RRULE:FREQ=DAILY;COUNT=10",
      `EXDATE;TZID=Asia/Tokyo:${exdate}`,
      "SUMMARY:festival",
    ],
  });

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

const soleRule = (body: string): string => {
  const projection = project(body);
  if (!projection.ok) {
    return "";
  }
  const [event] = projection.value.listing.events;
  return event?.content.recurrence?.value ?? "";
};

describe("anchoring the values a fingerprint is built from", () => {
  test("ICAL-O56: a floating UNTIL is anchored to the series zone, not stamped as UTC", () => {
    const rule = soleRule(
      calendarWith([...berlinVtimezone, ...seriesWith("FREQ=WEEKLY;UNTIL=20260406T235959")]),
    );

    expect(rule).toContain("UNTIL=20260406T215959Z");
  });

  test("ICAL-O57: the canonical rule is stable when a provider reorders a BYDAY list", () => {
    const forward = soleRule(
      calendarWith([...berlinVtimezone, ...seriesWith("FREQ=WEEKLY;BYDAY=MO,TU")]),
    );
    const reversed = soleRule(
      calendarWith([...berlinVtimezone, ...seriesWith("FREQ=WEEKLY;BYDAY=TU,MO")]),
    );

    expect(reversed).toBe(forward);
  });

  test("ICAL-O58: a range reclassified as all-day moves its cancelled days with its DTSTART", () => {
    const projection = project(calendarWith([...berlinVtimezone, ...tokyoFullDay("20260312T000000")]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const [event] = projection.value.listing.events;
    expect(event?.content.time).toBeUndefined();
    expect(event?.content.recurrence?.exceptions).toEqual(["20260312T000000Z"]);
  });

  test("ICAL-O58: the reanchored cancellation is the same value on a re-poll", () => {
    const body = calendarWith([...berlinVtimezone, ...tokyoFullDay("20260312T000000")]);

    expect(soleFingerprint(body)).toBe(soleFingerprint(body));
  });
});
