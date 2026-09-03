import { describe, expect, test } from "vitest";
import { canonicalEventFingerprint, projectCanonicalEvent, projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const revisions = [
  vevent({
    uid: "evt-collision",
    lines: [
      "SEQUENCE:0",
      "DTSTAMP:20260310T080000Z",
      "LAST-MODIFIED:20260310T080000Z",
      "DTSTART:20260310T090000Z",
      "DTEND:20260310T100000Z",
      "SUMMARY:first draft",
    ],
  }),
  vevent({
    uid: "evt-collision",
    lines: [
      "SEQUENCE:0",
      "DTSTAMP:20260310T081000Z",
      "LAST-MODIFIED:20260310T081000Z",
      "DTSTART:20260310T110000Z",
      "DTEND:20260310T120000Z",
      "SUMMARY:second draft",
    ],
  }),
  vevent({
    uid: "evt-collision",
    lines: [
      "SEQUENCE:0",
      "DTSTAMP:20260310T081000Z",
      "DTSTART:20260310T130000Z",
      "DTEND:20260310T140000Z",
      "SUMMARY:third draft",
    ],
  }),
] as const;

const permutationsOf = <Item,>(items: readonly Item[]): readonly (readonly Item[])[] => {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutationsOf(rest).map((tail) => [item, ...tail]);
  });
};

const fingerprintFor = (order: readonly (readonly string[])[]): string => {
  const projection = projectIcsFeed({
    body: calendarWith(order.flat()),
    scope: testScope,
    previousContentHash: null,
    options: testOptions(),
  });
  if (!projection.ok) {
    return "refused";
  }
  const parsed = projection.value.listing.events;
  return parsed.map((event) => event.fingerprint.value).join("|");
};

describe("a publisher that collapses distinct revisions onto one UID", () => {
  test("ICAL-O7: every permutation of the colliding revisions selects the same survivor", () => {
    const orders = permutationsOf(revisions);
    const fingerprints = new Set(orders.map((order) => fingerprintFor(order)));

    expect(orders).toHaveLength(6);
    expect(fingerprints.size).toBe(1);
    expect([...fingerprints][0]).not.toBe("refused");
  });

  test("ICAL-O7: exactly one canonical event survives, so a poll cannot delete and re-create the row", () => {
    const projection = projectIcsFeed({
      body: calendarWith(revisions.flat()),
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toHaveLength(1);
    expect(projection.value.present).toHaveLength(3);
  });

  test("ICAL-I6: the tiebreak is the canonical fingerprint, so equal revisions still order totally", () => {
    const projection = projectIcsFeed({
      body: calendarWith(revisions.flat()),
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const [survivor] = projection.value.listing.events;
    expect(survivor).toBeDefined();
    if (!survivor) {
      return;
    }
    const reprojected = projectCanonicalEvent({
      identity: { kind: "master", uid: survivor.uid },
      content: survivor.content,
      revision: { sequence: 0, lastModified: null, stamp: null, created: null },
      cancelled: false,
      provenance: { kind: "foreign" },
    });

    expect(canonicalEventFingerprint(reprojected).value).toBe(survivor.fingerprint.value);
  });
});
