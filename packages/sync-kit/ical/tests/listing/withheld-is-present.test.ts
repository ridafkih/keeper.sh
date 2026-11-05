import { describe, expect, test } from "vitest";
import { eventIdentityKey, projectIcsFeed } from "../../src/index";
import type { EventIdentity } from "../../src/index";
import { calendarWith, simpleEvent, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const negativeDurationEvent = vevent({
  uid: "evt-negative",
  lines: [
    "DTSTAMP:20260310T090000Z",
    "DTSTART:20260310T090000Z",
    "DURATION:-PT1H",
    "SUMMARY:moved backwards",
  ],
});

const feedWithOneUnbuildableEvent = calendarWith([
  ...simpleEvent("evt-healthy-a", "20260310T090000Z", "20260310T100000Z"),
  ...negativeDurationEvent,
  ...simpleEvent("evt-healthy-b", "20260311T090000Z", "20260311T100000Z"),
]);

const feedThatAlsoDropsAKnownEvent = calendarWith([
  ...negativeDurationEvent,
  ...simpleEvent("evt-healthy-a", "20260310T090000Z", "20260310T100000Z"),
]);

const uidsOf = (identities: readonly EventIdentity[]): readonly string[] =>
  identities.map((identity) => identity.uid.value);

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

describe("an event the parser cannot build", () => {
  test("ICAL-O4: a withheld event is present and is never named by a removal", () => {
    const projection = project(feedWithOneUnbuildableEvent);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(uidsOf(projection.value.present)).toContain("evt-negative");
    expect(uidsOf(projection.value.usable)).not.toContain("evt-negative");
    const removedUids = projection.value.listing.removals.map((removal) =>
      JSON.stringify(removal),
    );
    expect(removedUids.join("|")).not.toContain("evt-negative");
  });

  test("ICAL-O4: presence and usability are separate sets, not one filtered list", () => {
    const projection = project(feedWithOneUnbuildableEvent);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.present.length).toBe(projection.value.usable.length + 1);
    expect(projection.value.unsupported.map((entry) => entry.reason)).toEqual([
      "unrepresentableTime",
    ]);
  });

  test("ICAL-O4: the withheld identity is keyed the same way the diagnostics key it", () => {
    const projection = project(feedWithOneUnbuildableEvent);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const withheldIdentity = projection.value.present.find(
      (identity) => identity.uid.value === "evt-negative",
    );
    expect(withheldIdentity).toBeDefined();
    if (!withheldIdentity) {
      return;
    }
    expect(projection.value.listing.diagnostics.withheld.sample).toContain(
      eventIdentityKey(withheldIdentity),
    );
  });

  test("ICAL-O5: a real deletion arriving in the same feed as a malformed VEVENT is still applied", () => {
    const projection = project(feedThatAlsoDropsAKnownEvent);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(uidsOf(projection.value.present)).toEqual(
      expect.arrayContaining(["evt-negative", "evt-healthy-a"]),
    );
    expect(uidsOf(projection.value.present)).not.toContain("evt-healthy-b");
  });
});
