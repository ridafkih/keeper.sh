import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const body = calendarWith([
  ...vevent({
    uid: "evt-1",
    lines: [
      "DTSTAMP:20260101T000000Z",
      "DTSTART;VALUE=DATE:20260310",
      "DTEND;VALUE=DATE:20260311",
      "SUMMARY:all day",
    ],
  }),
  ...vevent({
    uid: "evt-2",
    lines: [
      "DTSTAMP:20260101T000000Z",
      "DTSTART:20260310T090000Z",
      "DTEND:20260310T100000Z",
      "SUMMARY:timed",
    ],
  }),
]);

const fingerprintsUnderTz = (timeZone: string): readonly string[] => {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  const projection = projectIcsFeed({
    body,
    scope: testScope,
    previousContentHash: null,
    options: testOptions(),
  });
  process.env.TZ = previous;
  if (!projection.ok) {
    return ["refused"];
  }
  return projection.value.listing.events.map((event) => event.fingerprint.value);
};

describe("the process timezone", () => {
  test("ICAL-I45: the projection is identical under UTC and under a zone fourteen hours ahead", () => {
    expect(fingerprintsUnderTz("Pacific/Kiritimati")).toEqual(fingerprintsUnderTz("UTC"));
  });

  test("ICAL-I45: the projection is identical under a zone behind UTC", () => {
    expect(fingerprintsUnderTz("Pacific/Niue")).toEqual(fingerprintsUnderTz("UTC"));
  });

  test("ICAL-I45: the projection is non-empty, so the comparison is not vacuous", () => {
    expect(fingerprintsUnderTz("UTC")).toHaveLength(2);
  });
});
