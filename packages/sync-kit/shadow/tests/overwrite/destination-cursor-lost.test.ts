import { describe, expect, test } from "vitest";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationCursorLost,
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const mapped = ["evt-1", "evt-2", "evt-3", "evt-4"].map((key) =>
  slotIdentity(key, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const aTenOnTheDestination = () =>
  syncInput({
    storedSourceEvents: mapped.map((identity) => storedSourceEvent({ identity })),
    mirrors: mapped.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationCursorLost({}),
  });

describe("a lost cursor on the destination is not a wipe", () => {
  test("SHADOW-O11: a cursorLost destination listing catalogs no deletion", () => {
    const catalog = cataloged(runShadow(aTenOnTheDestination(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
    expect(catalog.replacements).toEqual([]);
  });

  test("SHADOW-O11: the lost cursor is surfaced as a cursor decision, not swallowed", () => {
    const catalog = cataloged(runShadow(aTenOnTheDestination(), shadowOptions()));

    expect(catalog.coverage.length).toBeGreaterThan(0);
    for (const verdict of catalog.coverage) {
      expect(verdict.cursor).toBeDefined();
    }
  });

  test("SHADOW-O11: ten runs against the same lost cursor stay at zero deletions", () => {
    for (const attempt of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const catalog = cataloged(runShadow(aTenOnTheDestination(), shadowOptions()));

      expect(`${attempt}:${catalog.deletions.length}`).toBe(`${attempt}:0`);
    }
  });
});
