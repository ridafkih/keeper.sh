import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const buildableAtNine = vevent({
  uid: "evt-moved",
  lines: [
    "SEQUENCE:1",
    "DTSTAMP:20260310T080000Z",
    "DTSTART:20260310T090000Z",
    "DTEND:20260310T100000Z",
    "SUMMARY:standup",
  ],
});

const unbuildableNewer = vevent({
  uid: "evt-moved",
  lines: [
    "SEQUENCE:2",
    "DTSTAMP:20260310T083000Z",
    "DTSTART:20260310T140000Z",
    "DURATION:-PT1H",
    "SUMMARY:standup",
  ],
});

const feed = calendarWith([...buildableAtNine, ...unbuildableNewer]);
const reordered = calendarWith([...unbuildableNewer, ...buildableAtNine]);

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

const serialisedTimes = (body: string): string => {
  const projection = project(body);
  if (!projection.ok) {
    return "";
  }
  return JSON.stringify(projection.value.listing.events);
};

describe("an unbuildable revision superseding a buildable one", () => {
  test("ICAL-O6: the UID is withheld rather than reverted to the time the publisher moved it away from", () => {
    const projection = project(feed);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.unsupported).toEqual([
      expect.objectContaining({ reason: "supersededRevisionUnbuildable" }),
    ]);
  });

  test("ICAL-O6: no canonical event carries the superseded 09:00 start", () => {
    expect(serialisedTimes(feed)).not.toContain("09:00");
    expect(serialisedTimes(feed)).not.toContain("T090000");
  });

  test("ICAL-O6: the withheld UID is still present, so the stored row is not deleted", () => {
    const projection = project(feed);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.present.map((identity) => identity.uid.value)).toEqual(["evt-moved"]);
    expect(projection.value.usable).toEqual([]);
  });

  test("ICAL-O6: reordering the two revisions in the feed does not let the older one win", () => {
    expect(serialisedTimes(reordered)).toBe(serialisedTimes(feed));
  });
});
