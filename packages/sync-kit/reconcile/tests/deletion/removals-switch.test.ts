import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { presenceBasis, removalBasis } from "../../src/index";
import {
  cursorLostListing,
  deltaListing,
  knownEvent,
  knownState,
  partialListing,
  policy,
  remoteId,
  slotIdentity,
  snapshotListing,
  uid,
} from "../support/fixtures";

const known = () =>
  knownState([
    knownEvent({
      identity: slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
    }),
  ]);

const basisOf = (listing: ChangeListing) =>
  removalBasis(listing, known(), presenceBasis(listing), policy());

const listingsWithNoDeletionAuthority = [
  ["partial", partialListing({})],
  ["cursorLost", cursorLostListing({})],
] as const;

describe("the exhaustive switch over listing kind", () => {
  for (const entry of listingsWithNoDeletionAuthority) {
    const [name, listing] = entry;
    test(`RECON-I2: a ${name} listing yields an empty removal basis`, () => {
      expect(basisOf(listing)).toEqual({ explicit: [], absent: [], outOfScope: [] });
    });
  }

  test("RECON-I2: a delta yields exactly its named authoritative removals", () => {
    const basis = basisOf(
      deltaListing({
        removals: [
          { kind: "deleted", id: remoteId("evt-1"), uid: uid("evt-1") },
          { kind: "cancelled", id: remoteId("evt-2"), uid: uid("evt-2") },
          { kind: "outOfScope", id: remoteId("evt-3") },
        ],
      }),
    );

    expect(basis.explicit.map((removal) => removal.kind)).toEqual(["deleted", "cancelled"]);
    expect(basis.absent).toEqual([]);
    expect(basis.outOfScope.map((id) => id.value)).toEqual(["evt-3"]);
  });

  test("RECON-I2: a snapshot is the only kind that produces an absence axis", () => {
    const basis = basisOf(snapshotListing({ events: [] }));

    expect(basis.absent).toHaveLength(1);
  });

  test("RECON-I2: every listing kind is answered, none falls through", () => {
    const kinds: readonly ChangeListing[] = [
      snapshotListing({}),
      deltaListing({}),
      partialListing({}),
      cursorLostListing({}),
    ];

    for (const listing of kinds) {
      expect(() => basisOf(listing)).not.toThrow();
    }
  });
});
