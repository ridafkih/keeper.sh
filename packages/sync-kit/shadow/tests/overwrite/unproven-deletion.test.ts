import { describe, expect, test } from "vitest";
import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { tombstoneCauses } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import { planWith, replaceWrite, retireTombstone, unprovenCoverage } from "../support/plans";
import {
  destinationCursorLost,
  destinationPartial,
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const listings: ReadonlyMap<string, () => ChangeListing> = new Map([
  [
    "snapshot",
    () =>
      destinationSnapshot({
        events: [
          ownMirrorEvent({ id: "mirror-evt-one", uid: "evt-one", deleteHandle: "handle-evt-one" }),
        ],
      }),
  ],
  ["partial", () => destinationPartial({})],
  ["cursorLost", () => destinationCursorLost({})],
]);

const inputFor = (listing: ChangeListing, recordedAt: string | null) =>
  syncInput({
    storedSourceEvents: [storedSourceEvent({ identity })],
    mirrors: [
      mirrorRow({
        identity,
        destinationId: "mirror-evt-one",
        destinationHandle: "handle-evt-one",
      }),
    ],
    destinationListing: listing,
    storedCoverage: [storedCoverage({ recordedAt })],
  });

describe("a deletion never appears under unproven coverage", () => {
  test("SHADOW-O8: the real planner produces no deletion under unproven coverage", () => {
    for (const [name, listing] of listings) {
      const catalog = cataloged(runShadow(inputFor(listing(), null), shadowOptions()));

      expect(`${name}:${catalog.deletions.length}`).toBe(`${name}:0`);
    }
  });

  test("SHADOW-O8: a deletion a planner emits under unproven coverage is published and flagged", () => {
    for (const [name, listing] of listings) {
      for (const cause of tombstoneCauses) {
        const catalog = cataloged(
          runShadow(
            inputFor(listing(), null),
            shadowOptions({
              plan: () =>
                planWith({
                  coverage: unprovenCoverage,
                  tombstones: [retireTombstone(identity, cause)],
                }),
            }),
          ),
        );
        const unproven = catalog.deletions.filter((entry) => entry.licensedBy === "unproven");

        expect(`${name}/${cause}:${unproven.length}`).toBe(`${name}/${cause}:1`);
      }
    }
  });

  test("SHADOW-O8: a replace's retire leg under unproven coverage is counted too", () => {
    const catalog = cataloged(
      runShadow(
        inputFor(
          destinationSnapshot({
            events: [
              ownMirrorEvent({
                id: "mirror-evt-one",
                uid: "evt-one",
                deleteHandle: "handle-evt-one",
              }),
            ],
          }),
          null,
        ),
        shadowOptions({
          plan: () => planWith({ coverage: unprovenCoverage, writes: [replaceWrite(identity)] }),
        }),
      ),
    );

    expect(catalog.deletions.map((entry) => entry.origin)).toEqual(["replaceRetire"]);
    expect(catalog.deletions.map((entry) => entry.licensedBy)).toEqual(["unproven"]);
  });

  test("SHADOW-O8: the unproven deletion counter names the contradiction rather than hiding it", () => {
    for (const [name, listing] of listings) {
      const rendered = renderCatalog(
        cataloged(
          runShadow(
            inputFor(listing(), null),
            shadowOptions({
              plan: () =>
                planWith({
                  coverage: unprovenCoverage,
                  tombstones: [retireTombstone(identity, "absentFromSnapshot")],
                }),
            }),
          ),
        ),
        defaultShadowLimits,
      );

      expect(`${name}:${rendered["shadow.deletions.unproven_count"]}`).toBe(`${name}:1`);
      expect(String(rendered["shadow.deletions.sample"])).toContain("evt-one");
    }
  });

  test("SHADOW-O8: a proven plan under the same shape does still catalogue its deletion", () => {
    const catalog = cataloged(
      runShadow(
        inputFor(
          destinationSnapshot({
            events: [
              ownMirrorEvent({
                id: "mirror-evt-one",
                uid: "evt-one",
                deleteHandle: "handle-evt-one",
              }),
            ],
          }),
          "2026-06-15T11:30:00.000Z",
        ),
        shadowOptions({
          plan: () => planWith({ tombstones: [retireTombstone(identity, "absentFromSnapshot")] }),
        }),
      ),
    );

    expect(catalog.deletions.length).toBe(1);
  });
});
