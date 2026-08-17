import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const healthySibling = simpleEvent("evt-healthy", "20260310T090000Z", "20260310T100000Z");

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

const beside = (lines: readonly string[]) => project(calendarWith([...lines, ...healthySibling]));

describe("a single hostile VEVENT", () => {
  test("ICAL-O45: an absurd nominal duration is withheld, and its healthy sibling survives", () => {
    const projection = beside(
      vevent({
        uid: "evt-absurd-days",
        lines: [
          "DTSTAMP:20260310T080000Z",
          "DTSTART;VALUE=DATE:20260310",
          "DURATION:P200000000D",
          "SUMMARY:absurd",
        ],
      }),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-healthy"]);
    expect(projection.value.unsupported.map((entry) => entry.reason)).toEqual([
      "unrepresentableTime",
    ]);
  });

  test("ICAL-O45: an absurd exact duration is withheld, and its healthy sibling survives", () => {
    const projection = beside(
      vevent({
        uid: "evt-absurd-hours",
        lines: [
          "DTSTAMP:20260310T080000Z",
          "DTSTART:20260310T090000Z",
          "DURATION:PT999999999999H",
          "SUMMARY:absurd",
        ],
      }),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-healthy"]);
  });

  test("ICAL-O46: an impossible calendar date is refused rather than rolled into the next month", () => {
    const projection = beside(
      vevent({
        uid: "evt-impossible-date",
        lines: [
          "DTSTAMP:20260310T080000Z",
          "DTSTART:20260231T120000Z",
          "DTEND:20260231T130000Z",
          "SUMMARY:impossible",
        ],
      }),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-healthy"]);
    expect(projection.value.unsupported.map((entry) => entry.reason)).toEqual(["unparseable"]);
  });

  test("ICAL-O46: an impossible clock time is refused rather than rolled into the next day", () => {
    const projection = beside(
      vevent({
        uid: "evt-impossible-time",
        lines: [
          "DTSTAMP:20260310T080000Z",
          "DTSTART:20260310T250000Z",
          "DTEND:20260310T260000Z",
          "SUMMARY:impossible",
        ],
      }),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-healthy"]);
  });

  test("ICAL-O47: a year outside the four-digit range in a zoned event does not abort the feed", () => {
    const projection = beside(
      vevent({
        uid: "evt-ancient",
        lines: [
          "DTSTAMP:20260310T080000Z",
          "DTSTART;TZID=Europe/Berlin:09000101T000000",
          "DTEND;TZID=Europe/Berlin:09000101T010000",
          "SUMMARY:ancient",
        ],
      }),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toContain("evt-healthy");
  });

  test("ICAL-O48: a non-numeric SEQUENCE never reaches the listing as a NaN revision", () => {
    const projection = beside(
      vevent({
        uid: "evt-bad-sequence",
        lines: [
          "SEQUENCE:not-a-number",
          "DTSTAMP:20260310T080000Z",
          "DTSTART:20260310T090000Z",
          "DTEND:20260310T100000Z",
          "SUMMARY:bad sequence",
        ],
      }),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.events.every((event) => Number.isInteger(event.revision))).toBe(
      true,
    );
  });

  test("ICAL-O49: an event-level RDATE is withheld and counted, never mirrored short", () => {
    const projection = beside(
      vevent({
        uid: "evt-rdate",
        lines: [
          "DTSTAMP:20260310T080000Z",
          "DTSTART:20260310T090000Z",
          "DTEND:20260310T100000Z",
          "RDATE:20260317T090000Z",
          "SUMMARY:extra occurrence",
        ],
      }),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-healthy"]);
    expect(projection.value.listing.withheld.map((entry) => entry.reason)).toEqual([
      "unsupportedRecurrenceDates",
    ]);
  });
});
