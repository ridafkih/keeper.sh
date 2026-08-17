import { describe, expect, test } from "vitest";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  syncInput,
} from "../support/fixtures";

const abandoned = ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"].map((key) =>
  slotIdentity(key, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const fullyAbsentBaseline = () =>
  syncInput({
    storedSourceEvents: [],
    mirrors: abandoned.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationSnapshot({
      events: abandoned.map((identity) =>
        ownMirrorEvent({
          id: `mirror-${identity.uid.value}`,
          uid: identity.uid.value,
          deleteHandle: `handle-${identity.uid.value}`,
        }),
      ),
    }),
    storedCoverage: [storedCoverage({ recordedAt: null })],
  });

describe("an unproven translation cannot wipe a destination", () => {
  test("SHADOW-O1: an unproven translation of a fully absent baseline catalogs zero deletions", () => {
    const catalog = cataloged(runShadow(fullyAbsentBaseline(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
    expect(catalog.replacements).toEqual([]);
    expect(catalog.updates).toEqual([]);
  });

  test("SHADOW-O1: the synthesized source listing stays partial when nothing proved it", () => {
    const catalog = cataloged(runShadow(fullyAbsentBaseline(), shadowOptions()));
    const verdicts = catalog.coverage;

    expect(verdicts.length).toBe(1);
    for (const verdict of verdicts) {
      expect(verdict.listingKind).toBe("partial");
      expect(verdict.kind).toBe("unproven");
    }
  });

  test("SHADOW-O1: ten consecutive runs of the same absent baseline stay at zero deletions", () => {
    for (const attempt of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const catalog = cataloged(runShadow(fullyAbsentBaseline(), shadowOptions()));

      expect(`${attempt}:${catalog.deletions.length}`).toBe(`${attempt}:0`);
    }
  });
});
