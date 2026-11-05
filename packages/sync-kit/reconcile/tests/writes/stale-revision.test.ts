import { describe, expect, test } from "vitest";
import { compareObservedRevisions, planReconciliation } from "../../src/index";
import {
  deltaListing,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  sourceOnly,
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const knownAtRevisionSeven = () =>
  knownState([knownEvent({ identity, fingerprint: "fp-rev-7", revision: 7 })]);

const latePageAtRevisionThree = () =>
  deltaListing({
    events: [
      foreignEvent({ id: "evt-1", uid: "evt-1", revision: 3, fingerprint: "fp-rev-3", version: "v3" }),
    ],
  });

const mapped = () =>
  mappingSet([mapping({ identity, destinationId: "mirror-1", sourceFingerprint: "fp-rev-7" })]);

describe("a late lower revision never reverts a user's edit", () => {
  test("RECON-O23: an out-of-order page below the known revision plans no write", () => {
    const plan = planReconciliation(
      sourceOnly(latePageAtRevisionThree()),
      knownAtRevisionSeven(),
      mapped(),
      policy(),
    );

    expect(plan.writes).toEqual([]);
  });

  test("RECON-O23: the stale delivery is reported as staleRevision", () => {
    const plan = planReconciliation(
      sourceOnly(latePageAtRevisionThree()),
      knownAtRevisionSeven(),
      mapped(),
      policy(),
    );

    expect(plan.unresolved.map((item) => item.reason)).toEqual(["staleRevision"]);
  });

  test("RECON-O23: the stale delivery does not tombstone the identity either", () => {
    const plan = planReconciliation(
      sourceOnly(latePageAtRevisionThree()),
      knownAtRevisionSeven(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-I37: an unusable newest revision withholds rather than falling back to the older one", () => {
    const plan = planReconciliation(
      sourceOnly(
        deltaListing({
          events: [],
          withheld: [
            {
              uid: { kind: "eventUid", value: "evt-1" },
              id: { kind: "remoteEventId", value: "evt-1" },
              reason: "supersededRevisionUnbuildable",
            },
          ],
        }),
      ),
      knownAtRevisionSeven(),
      mapped(),
      policy(),
    );

    expect(plan.writes).toEqual([]);
    expect(plan.unresolved.map((item) => item.reason)).toEqual(["withheldBySource"]);
  });

  test("RECON-I22: revision comparison is a strict total order, higher revision wins", () => {
    const older = foreignEvent({ id: "evt-1", uid: "evt-1", revision: 3 });
    const newer = foreignEvent({ id: "evt-1", uid: "evt-1", revision: 7 });

    expect(compareObservedRevisions(older, newer)).toBeLessThan(0);
    expect(compareObservedRevisions(newer, older)).toBeGreaterThan(0);
    expect(compareObservedRevisions(older, older)).toBe(0);
  });
});
