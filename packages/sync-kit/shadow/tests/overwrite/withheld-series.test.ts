import { describe, expect, test } from "vitest";
import type { WithheldEvent } from "@keeper.sh/sync-protocol";
import { cataloged, runShadow } from "../support/scenario";
import { uid } from "../support/handles";
import {
  destinationSnapshot,
  incompleteRead,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
  withheldFrom,
} from "../support/fixtures";

const kept = slotIdentity("evt-kept", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const series = slotIdentity("evt-series", "2026-03-12T09:00:00.000Z", "2026-03-12T10:00:00.000Z");

const withheldSeries: WithheldEvent = {
  uid: uid("evt-series"),
  id: null,
  reason: "recurrenceBudgetExceeded",
};

const readMissingTheSeries = () =>
  syncInput({
    storedSourceEvents: [storedSourceEvent({ identity: kept })],
    mirrors: [
      mirrorRow({
        identity: kept,
        destinationId: "mirror-evt-kept",
        destinationHandle: "handle-evt-kept",
      }),
      mirrorRow({
        identity: series,
        destinationId: "mirror-evt-series",
        destinationHandle: "handle-evt-series",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({ id: "mirror-evt-kept", uid: "evt-kept", deleteHandle: "handle-evt-kept" }),
        ownMirrorEvent({
          id: "mirror-evt-series",
          uid: "evt-series",
          deleteHandle: "handle-evt-series",
        }),
      ],
    }),
    completeness: incompleteRead("overBudgetRecurrenceSeries", withheldFrom([withheldSeries])),
  });

describe("a withheld series is not a deleted series", () => {
  test("SHADOW-O5: a stored read missing an over-budget series catalogs zero deletions", () => {
    const catalog = cataloged(runShadow(readMissingTheSeries(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
  });

  test("SHADOW-O5: ten consecutive identical runs never oscillate between delete and re-add", () => {
    for (const attempt of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const catalog = cataloged(runShadow(readMissingTheSeries(), shadowOptions()));

      expect(`${attempt}:${catalog.deletions.length}:${catalog.creations.length}`).toBe(
        `${attempt}:0:0`,
      );
    }
  });

  test("SHADOW-O5: the withheld identity reaches the plan as withheldBySource, not as nothing", () => {
    const catalog = cataloged(runShadow(readMissingTheSeries(), shadowOptions()));
    const withheld = catalog.unresolved.filter((entry) => entry.reason === "withheldBySource");

    expect(withheld.length).toBeGreaterThan(0);
  });

  test("SHADOW-O5: the incomplete read downgrades the listing rather than claiming a snapshot", () => {
    const catalog = cataloged(runShadow(readMissingTheSeries(), shadowOptions()));

    for (const verdict of catalog.coverage) {
      expect(verdict.listingKind).toBe("partial");
    }
  });
});
