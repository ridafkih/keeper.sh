import { describe, expect, test } from "vitest";
import { coverageForWholeFeed, projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testCalendar, testScope } from "../support/feed";
import { testOptions } from "../support/options";

const historicFeed = calendarWith([
  ...simpleEvent("evt-1998", "19980704T090000Z", "19980704T100000Z"),
  ...simpleEvent("evt-2026", "20260310T090000Z", "20260310T100000Z"),
]);

describe("events outside the caller's sync window", () => {
  test("ICAL-O39: a 1998 event survives parsing even though the scope window starts in 2026", () => {
    const projection = projectIcsFeed({
      body: historicFeed,
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.present.map((identity) => identity.uid.value)).toContain("evt-1998");
    expect(projection.value.usable.map((identity) => identity.uid.value)).toContain("evt-1998");
  });

  test("ICAL-O39: coverage is the whole feed, so a snapshot diff can never infer a historic deletion", () => {
    const coverage = coverageForWholeFeed(testCalendar);

    expect(coverage.calendar).toEqual(testCalendar);
    expect(Date.parse(coverage.covered.start.value)).toBeLessThan(Date.parse("1900-01-01T00:00:00.000Z"));
    expect(Date.parse(coverage.covered.end.value)).toBeGreaterThan(Date.parse("2200-01-01T00:00:00.000Z"));
  });
});
