import { describe, expect, test } from "vitest";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
  timedAt,
} from "../support/fixtures";

const movedSlot = slotIdentity(
  "evt-occurrence",
  "2026-03-10T10:00:00.000Z",
  "2026-03-10T11:00:00.000Z",
);

const oldSlot = slotIdentity(
  "evt-occurrence",
  "2026-03-10T09:00:00.000Z",
  "2026-03-10T10:00:00.000Z",
);

const movedTime = timedAt("2026-03-10T10:00:00.000Z", "2026-03-10T11:00:00.000Z");

const rePairedOccurrence = () =>
  syncInput({
    storedSourceEvents: [storedSourceEvent({ identity: movedSlot, time: movedTime })],
    mirrors: [
      mirrorRow({
        identity: oldSlot,
        time: movedTime,
        destinationId: "mirror-evt-occurrence",
        destinationHandle: "handle-evt-occurrence",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-occurrence",
          uid: "evt-occurrence",
          deleteHandle: "handle-evt-occurrence",
          time: movedTime,
        }),
      ],
    }),
  });

describe("a reassignment is not a delete plus an add", () => {
  test("SHADOW-O13: an occurrence re-paired within its series catalogs zero deletions", () => {
    const catalog = cataloged(runShadow(rePairedOccurrence(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
    expect(catalog.replacements).toEqual([]);
  });

  test("SHADOW-O13: a verifiable unchanged reassignment produces no creation either", () => {
    const catalog = cataloged(runShadow(rePairedOccurrence(), shadowOptions()));

    expect(catalog.creations).toEqual([]);
  });

  test("SHADOW-O13: ten runs of the same reassignment never oscillate", () => {
    for (const attempt of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const catalog = cataloged(runShadow(rePairedOccurrence(), shadowOptions()));

      expect(`${attempt}:${catalog.deletions.length}:${catalog.creations.length}`).toBe(
        `${attempt}:0:0`,
      );
    }
  });
});
