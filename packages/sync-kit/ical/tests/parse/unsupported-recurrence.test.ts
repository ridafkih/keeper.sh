import { describe, expect, test } from "vitest";
import { detectRecurrenceRangeOverrides, projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope, vevent } from "../support/feed";
import { testLimits, testOptions } from "../support/options";

const thisAndFutureOverride = vevent({
  uid: "evt-series",
  lines: [
    "DTSTAMP:20260310T080000Z",
    "RECURRENCE-ID;RANGE=THISANDFUTURE:20260317T090000Z",
    "DTSTART:20260317T113000Z",
    "DTEND:20260317T123000Z",
    "SUMMARY:series moved from here on",
  ],
});

const feed = calendarWith([
  ...simpleEvent("evt-healthy-a", "20260310T090000Z", "20260310T100000Z"),
  ...thisAndFutureOverride,
  ...simpleEvent("evt-healthy-b", "20260311T090000Z", "20260311T100000Z"),
]);

const project = () =>
  projectIcsFeed({
    body: feed,
    scope: testScope,
    previousContentHash: null,
    options: testOptions(),
  });

describe("a RANGE=THISANDFUTURE override", () => {
  test("ICAL-O9: it is reported unsupported rather than applied as a single-instance override", () => {
    const projection = project();

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.unsupported).toEqual([
      expect.objectContaining({ reason: "unsupportedRecurrenceRange" }),
    ]);
  });

  test("ICAL-O9: the two healthy events beside it still project", () => {
    const projection = project();

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value).toSorted()).toEqual([
      "evt-healthy-a",
      "evt-healthy-b",
    ]);
  });

  test("ICAL-O9: the withheld series UID is present, so its stored row is not deleted", () => {
    const projection = project();

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.present.map((identity) => identity.uid.value)).toContain("evt-series");
  });

  test("ICAL-I10: the range override is detected by the property that declares it", () => {
    expect(
      detectRecurrenceRangeOverrides(feed, testLimits()).map((uid) => uid.value),
    ).toEqual(["evt-series"]);
  });
});
