import { describe, expect, test } from "vitest";
import { planReconciliation, removalBasis } from "../../src/index";
import {
  cursorLostListing,
  foreignEvent,
  instant,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  partialListing,
  policy,
  slotIdentity,
  snapshotListing,
  sourceCalendar,
  sourceOnly,
  timedAt,
} from "../support/fixtures";
import { presenceBasis } from "../../src/index";

const fiveIdentities = [1, 2, 3, 4, 5].map((index) =>
  slotIdentity(`evt-${index}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const fullyPopulatedKnownState = () =>
  knownState(fiveIdentities.map((identity) => knownEvent({ identity })));

const everyIdentityMapped = () =>
  mappingSet(
    fiveIdentities.map((identity, index) =>
      mapping({ identity, destinationId: `mirror-${index + 1}` }),
    ),
  );

const narrowMirrorWindow = {
  start: instant("2026-03-01T00:00:00.000Z"),
  end: instant("2026-04-01T00:00:00.000Z"),
};

const narrowScope = {
  calendar: sourceCalendar,
  window: {
    start: instant("2026-06-01T00:00:00.000Z"),
    end: instant("2026-12-31T00:00:00.000Z"),
  },
  expandRecurrences: false,
};

const driftedIdentity = slotIdentity(
  "evt-drifted",
  "2026-02-01T09:00:00.000Z",
  "2026-02-01T10:00:00.000Z",
);

const driftedKnownState = () =>
  knownState([
    knownEvent({
      identity: driftedIdentity,
      time: timedAt("2026-02-01T09:00:00.000Z", "2026-02-01T10:00:00.000Z"),
    }),
  ]);

const driftedMappings = () =>
  mappingSet([mapping({ identity: driftedIdentity, destinationId: "mirror-outside" })]);

describe("a listing that never claimed to be complete", () => {
  test("RECON-O1: a partial listing omitting every known event tombstones none of them", () => {
    const plan = planReconciliation(
      sourceOnly(partialListing({ events: [] })),
      fullyPopulatedKnownState(),
      everyIdentityMapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
    expect(plan.writes).toEqual([]);
  });

  test("RECON-O1: a partial listing carrying one of five still tombstones none of the other four", () => {
    const plan = planReconciliation(
      sourceOnly(partialListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1" })] })),
      fullyPopulatedKnownState(),
      everyIdentityMapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O1: the removal basis of a partial listing is empty on both axes", () => {
    const listing = partialListing({ events: [] });

    const basis = removalBasis(
      listing,
      fullyPopulatedKnownState(),
      presenceBasis(listing),
      policy(),
    );

    expect(basis.explicit).toEqual([]);
    expect(basis.absent).toEqual([]);
  });

  test("RECON-O1: a partial listing holds the cursor rather than advancing past unseen pages", () => {
    const plan = planReconciliation(
      sourceOnly(partialListing({ events: [] })),
      fullyPopulatedKnownState(),
      everyIdentityMapped(),
      policy(),
    );

    expect(plan.cursor).toEqual({ kind: "hold", reason: "listingIncomplete" });
  });

  test("RECON-O1: neither does a cursorLost listing wipe a fully populated store", () => {
    const plan = planReconciliation(
      sourceOnly(cursorLostListing({})),
      fullyPopulatedKnownState(),
      everyIdentityMapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
    expect(plan.writes).toEqual([]);
  });

  test("RECON-O1: a partial listing whose scope is not the mirror window still retires nothing", () => {
    const plan = planReconciliation(
      sourceOnly(partialListing({ events: [], scope: narrowScope })),
      driftedKnownState(),
      driftedMappings(),
      policy({ mirrorWindow: narrowMirrorWindow }),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O2: a cursorLost listing whose scope is not the mirror window retires nothing either", () => {
    const plan = planReconciliation(
      sourceOnly(cursorLostListing({ scope: narrowScope })),
      driftedKnownState(),
      driftedMappings(),
      policy({ mirrorWindow: narrowMirrorWindow }),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O2: the same drifted row is retired once a snapshot speaks for the scope", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [], scope: narrowScope })),
      driftedKnownState(),
      driftedMappings(),
      policy({ mirrorWindow: narrowMirrorWindow }),
    );

    expect(plan.tombstones.map((tombstone) => tombstone.cause)).toEqual(["outsideMirrorWindow"]);
  });

  test("RECON-O1: a snapshot that genuinely omits everything is the only shape that may tombstone", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      fullyPopulatedKnownState(),
      everyIdentityMapped(),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(5);
    for (const tombstone of plan.tombstones) {
      expect(tombstone.cause).toBe("absentFromSnapshot");
    }
  });
});
