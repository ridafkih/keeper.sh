import { describe, expect, test } from "vitest";
import {
  canonicalEventFingerprint,
  projectCanonicalEvent,
  projectIcsFeed,
  serialiseCalendarResource,
} from "../../src/index";
import type { CanonicalEvent } from "../../src/index";
import { testScope } from "../support/feed";
import { enabledFixtures, readFixture } from "../support/fixtures";
import { testOptions } from "../support/options";

const canonicalise = (body: string): readonly CanonicalEvent[] => {
  const projection = projectIcsFeed({
    body,
    scope: testScope,
    previousContentHash: null,
    options: testOptions({ selfAuthored: "includeForRoundTrip" }),
  });
  if (!projection.ok) {
    return [];
  }
  return projection.value.listing.events.flatMap((event) => [
    projectCanonicalEvent({
      identity: { kind: "master", uid: event.uid },
      content: event.content,
      revision: { sequence: null, lastModified: null, stamp: null, created: null },
      cancelled: false,
      provenance: { kind: "foreign" },
    }),
  ]);
};

const reserialise = (events: readonly CanonicalEvent[]): readonly string[] =>
  events.flatMap((event) => {
    const serialised = serialiseCalendarResource({ master: event, overrides: [] }, testOptions());
    if (serialised.kind !== "resource") {
      return [];
    }
    return [serialised.text];
  });

describe("the checked-in provider fixture corpus", () => {
  for (const source of enabledFixtures()) {
    test(`ICAL-O21: parse then serialise then parse is a fixed point for ${source.id}`, async () => {
      const body = await readFixture(source);
      const first = canonicalise(body);

      expect(first.length).toBeGreaterThan(0);
      const roundTripped = reserialise(first).flatMap((text) => canonicalise(text));

      expect(roundTripped.map((event) => canonicalEventFingerprint(event).value)).toEqual(
        first.map((event) => canonicalEventFingerprint(event).value),
      );
    });
  }

  test("ICAL-I41: the corpus is non-empty and every fixture yields at least one canonical event", async () => {
    expect(enabledFixtures().length).toBeGreaterThan(5);
    for (const source of enabledFixtures()) {
      expect(`${source.id}:${canonicalise(await readFixture(source)).length > 0}`).toBe(
        `${source.id}:true`,
      );
    }
  });
});
