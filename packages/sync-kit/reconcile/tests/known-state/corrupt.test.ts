import { describe, expect, test } from "vitest";
import { planReconciliation } from "../../src/index";
import {
  deltaListing,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  remoteId,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  uid,
} from "../support/fixtures";

const healthy = [1, 2, 3, 4].map((index) =>
  slotIdentity(`evt-${index}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const oneCorruptAmongFourHealthy = () =>
  knownState(
    healthy.map((identity) => knownEvent({ identity })),
    [{ id: remoteId("evt-corrupt"), uid: uid("evt-corrupt") }],
  );

const mapped = () =>
  mappingSet(healthy.map((identity, index) => mapping({ identity, destinationId: `mirror-${index}` })));

describe("a partially unreadable baseline forces a resync, never a diff", () => {
  test("RECON-O22: a delta against a corrupt baseline plans zero tombstones", () => {
    const plan = planReconciliation(
      sourceOnly(deltaListing({ events: [] })),
      oneCorruptAmongFourHealthy(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O22: a delta against a corrupt baseline resets the cursor and says why", () => {
    const plan = planReconciliation(
      sourceOnly(deltaListing({ events: [] })),
      oneCorruptAmongFourHealthy(),
      mapped(),
      policy(),
    );

    expect(plan.cursor).toEqual({ kind: "reset", reason: "corruptKnownState" });
  });

  test("RECON-O22: the corrupt row itself is reported, so it is not silently skipped", () => {
    const plan = planReconciliation(
      sourceOnly(deltaListing({ events: [] })),
      oneCorruptAmongFourHealthy(),
      mapped(),
      policy(),
    );

    expect(plan.unresolved).toContainEqual({
      identity: null,
      id: remoteId("evt-corrupt"),
      reason: "corruptKnownState",
    });
  });

  test("RECON-O22: a named removal in the same delta is suppressed while the baseline is corrupt", () => {
    const plan = planReconciliation(
      sourceOnly(
        deltaListing({ removals: [{ kind: "deleted", id: remoteId("evt-1"), uid: uid("evt-1") }] }),
      ),
      oneCorruptAmongFourHealthy(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O22: a snapshot against a corrupt baseline also refuses to infer deletions", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      oneCorruptAmongFourHealthy(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
    expect(plan.cursor).toEqual({ kind: "reset", reason: "corruptKnownState" });
  });

  test("RECON-O22: with no corrupt rows the same delta behaves normally", () => {
    const plan = planReconciliation(
      sourceOnly(
        deltaListing({ removals: [{ kind: "deleted", id: remoteId("evt-1"), uid: uid("evt-1") }] }),
      ),
      knownState(healthy.map((identity) => knownEvent({ identity }))),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
  });
});
