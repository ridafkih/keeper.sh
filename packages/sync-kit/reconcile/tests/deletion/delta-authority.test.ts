import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation, presenceBasis, removalBasis } from "../../src/index";
import {
  deltaListing,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  remoteId,
  slotIdentity,
  timedAt,
  uid,
} from "../support/fixtures";
import { sourceOnly } from "../support/fixtures";
import { sameIdentity } from "../support/keys";

const identities = [1, 2, 3, 4, 5].map((index) =>
  slotIdentity(`evt-${index}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const known = () => knownState(identities.map((identity) => knownEvent({ identity })));

const mapped = () =>
  mappingSet(identities.map((identity, index) => mapping({ identity, destinationId: `mirror-${index}` })));

const deltaNamingOneRemoval = () =>
  deltaListing({
    events: [],
    removals: [{ kind: "deleted", id: remoteId("evt-1"), uid: uid("evt-1") }],
  });

describe("a delta page deletes only what it names", () => {
  test("RECON-O3: four omitted known events survive a delta that names one removal", () => {
    const plan = planReconciliation(
      sourceOnly(deltaNamingOneRemoval()),
      known(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(sameIdentity(firstOf(plan.tombstones).identity, firstOf(identities))).toBe(true);
    expect(firstOf(plan.tombstones).cause).toBe("explicitRemoval");
  });

  test("RECON-O3: the removal basis of a delta carries no absence axis at all", () => {
    const listing = deltaNamingOneRemoval();

    const basis = removalBasis(listing, known(), presenceBasis(listing), policy());

    expect(basis.absent).toEqual([]);
    expect(basis.explicit).toHaveLength(1);
  });

  test("RECON-O3: an empty delta removes nothing even though it lists nothing", () => {
    const plan = planReconciliation(
      sourceOnly(deltaListing({ events: [], removals: [] })),
      known(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O3: an outOfScope removal is not an authoritative deletion", () => {
    const plan = planReconciliation(
      sourceOnly(
        deltaListing({ removals: [{ kind: "outOfScope", id: remoteId("evt-2") }] }),
      ),
      known(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones.map((tombstone) => tombstone.cause)).not.toContain("explicitRemoval");
  });

  test("RECON-O3: an outOfScope removal leaves a trace instead of vanishing", () => {
    const plan = planReconciliation(
      sourceOnly(deltaListing({ removals: [{ kind: "outOfScope", id: remoteId("evt-2") }] })),
      known(),
      mapped(),
      policy(),
    );

    expect(plan.unresolved.map((item) => item.reason)).toContain("removalOutOfScope");
  });

  test("RECON-O3: one cancelled occurrence retires only the occurrence it names", () => {
    const slotA = slotIdentity("series-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
    const slotB = slotIdentity("series-1", "2026-03-17T09:00:00.000Z", "2026-03-17T10:00:00.000Z");

    const plan = planReconciliation(
      sourceOnly(
        deltaListing({
          removals: [{ kind: "cancelled", id: remoteId("series-1-b"), uid: uid("series-1") }],
        }),
      ),
      knownState([
        knownEvent({
          identity: slotA,
          remoteId: "series-1-a",
          time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
        }),
        knownEvent({
          identity: slotB,
          remoteId: "series-1-b",
          time: timedAt("2026-03-17T09:00:00.000Z", "2026-03-17T10:00:00.000Z"),
        }),
      ]),
      mappingSet([
        mapping({ identity: slotA, destinationId: "mirror-a" }),
        mapping({ identity: slotB, destinationId: "mirror-b" }),
      ]),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(sameIdentity(firstOf(plan.tombstones).identity, slotB)).toBe(true);
  });

  test("RECON-O3: a removal whose uid names several rows and whose id names none is unresolved", () => {
    const slotA = slotIdentity("series-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
    const slotB = slotIdentity("series-1", "2026-03-17T09:00:00.000Z", "2026-03-17T10:00:00.000Z");

    const plan = planReconciliation(
      sourceOnly(
        deltaListing({
          removals: [{ kind: "cancelled", id: remoteId("series-1-z"), uid: uid("series-1") }],
        }),
      ),
      knownState([
        knownEvent({ identity: slotA, remoteId: "series-1-a" }),
        knownEvent({
          identity: slotB,
          remoteId: "series-1-b",
          time: timedAt("2026-03-17T09:00:00.000Z", "2026-03-17T10:00:00.000Z"),
        }),
      ]),
      mappingSet([
        mapping({ identity: slotA, destinationId: "mirror-a" }),
        mapping({ identity: slotB, destinationId: "mirror-b" }),
      ]),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
    expect(plan.unresolved.map((item) => item.reason)).toContain("unmatchedRemoval");
  });

  test("RECON-O3: a delta page carrying a new occurrence never rewrites an unmentioned sibling", () => {
    const slotA = slotIdentity("series-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

    const plan = planReconciliation(
      sourceOnly(
        deltaListing({
          events: [
            foreignEvent({
              id: "series-1-c",
              uid: "series-1",
              time: timedAt("2026-03-24T09:00:00.000Z", "2026-03-24T10:00:00.000Z"),
            }),
          ],
        }),
      ),
      knownState([knownEvent({ identity: slotA, remoteId: "series-1-a" })]),
      mappingSet([mapping({ identity: slotA, destinationId: "mirror-a" })]),
      policy(),
    );

    expect(plan.writes.map((write) => write.intent?.kind)).toEqual(["create"]);
    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O3: a delta naming every known event does remove every one of them", () => {
    const plan = planReconciliation(
      sourceOnly(
        deltaListing({
          removals: identities.map((identity) => ({
            kind: "deleted" as const,
            id: remoteId(identity.uid.value),
            uid: identity.uid,
          })),
        }),
      ),
      known(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(5);
  });
});
