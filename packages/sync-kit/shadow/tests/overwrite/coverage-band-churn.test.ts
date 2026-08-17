import { describe, expect, test } from "vitest";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import { translateDestinationSync } from "../../src/index";
import { cataloged, firstOf, runShadow } from "../support/scenario";
import { instant } from "../support/handles";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  timedAt,
} from "../support/fixtures";

const bandIdentity = slotIdentity(
  "evt-band",
  "2026-09-10T09:00:00.000Z",
  "2026-09-10T10:00:00.000Z",
);

const bandTime = timedAt("2026-09-10T09:00:00.000Z", "2026-09-10T10:00:00.000Z");

const bandInput = () =>
  syncInput({
    storedSourceEvents: [storedSourceEvent({ identity: bandIdentity, time: bandTime })],
    mirrors: [
      mirrorRow({
        identity: bandIdentity,
        time: bandTime,
        destinationId: "mirror-evt-band",
        destinationHandle: "handle-evt-band",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-band",
          uid: "evt-band",
          deleteHandle: "handle-evt-band",
          time: bandTime,
        }),
      ],
    }),
    storedCoverage: [
      storedCoverage({
        ingestWindowStart: "2026-01-01T00:00:00.000Z",
        ingestWindowEnd: "2026-04-01T00:00:00.000Z",
        historicRange: {
          start: instant("2026-01-01T00:00:00.000Z"),
          end: instant("2026-03-01T00:00:00.000Z"),
        },
        futureRange: {
          start: instant("2026-03-01T00:00:00.000Z"),
          end: instant("2026-04-01T00:00:00.000Z"),
        },
      }),
    ],
  });

describe("a mapping in the coverage band is not re-created and not orphaned", () => {
  test("SHADOW-O7: an event in the coverage band produces neither a creation nor a deletion", () => {
    const catalog = cataloged(runShadow(bandInput(), shadowOptions()));

    expect(catalog.creations).toEqual([]);
    expect(catalog.deletions).toEqual([]);
  });

  test("SHADOW-O7: the band mapping is present in the mapping set the planner sees", () => {
    const translation = translateDestinationSync(bandInput(), shadowOptions());
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const keys = firstOf(translation.units).mappings.entries.map((entry) =>
      sourceIdentityKey(entry.sourceIdentity),
    );

    expect(keys).toContain(sourceIdentityKey(bandIdentity));
  });

  test("SHADOW-O7: ten runs never produce the create-then-delete churn loop", () => {
    for (const attempt of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const catalog = cataloged(runShadow(bandInput(), shadowOptions()));

      expect(`${attempt}:${catalog.creations.length}:${catalog.deletions.length}`).toBe(
        `${attempt}:0:0`,
      );
    }
  });
});
