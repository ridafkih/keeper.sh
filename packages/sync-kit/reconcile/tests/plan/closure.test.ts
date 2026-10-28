import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import type { Plan } from "../../src/index";
import {
  foreignEvent,
  indeterminateEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  remoteId,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  timedAt,
  uid,
} from "../support/fixtures";
import { expectedSourceIdentityKey } from "../support/keys";

const spanFor = (index: number) => ({
  start: `2026-03-${String(index).padStart(2, "0")}T09:00:00.000Z`,
  end: `2026-03-${String(index).padStart(2, "0")}T10:00:00.000Z`,
});

const identities = [1, 2, 3, 4, 5].map((index) => {
  const span = spanFor(index);
  return slotIdentity(`evt-${index}`, span.start, span.end);
});

const mixedScenario = () => ({
  observed: sourceOnly(
    snapshotListing({
      events: [
        foreignEvent({
          id: "evt-1",
          uid: "evt-1",
          time: timedAt(spanFor(1).start, spanFor(1).end),
          fingerprint: "fp-changed",
        }),
        foreignEvent({
          id: "evt-2",
          uid: "evt-2",
          time: timedAt(spanFor(2).start, spanFor(2).end),
          fingerprint: "fp-changed-2",
        }),
        indeterminateEvent({
          id: "evt-3",
          uid: "evt-3",
          time: timedAt(spanFor(3).start, spanFor(3).end),
        }),
      ],
      withheld: [{ uid: uid("evt-4"), id: remoteId("evt-4"), reason: "unparseable" }],
    }),
  ),
  known: knownState(
    identities.map((identity, index) =>
      knownEvent({
        identity,
        fingerprint: `fp-evt-${index + 1}`,
        time: timedAt(spanFor(index + 1).start, spanFor(index + 1).end),
      }),
    ),
  ),
  mappings: mappingSet(
    identities.map((identity, index) =>
      mapping({ identity, destinationId: `mirror-${index}`, sourceFingerprint: `fp-evt-${index + 1}` }),
    ),
  ),
});

const bucketedKeys = (plan: Plan): readonly string[] => [
  ...plan.writes.map((write) => expectedSourceIdentityKey(write.identity)),
  ...plan.tombstones.map((tombstone) => expectedSourceIdentityKey(tombstone.identity)),
  ...plan.conflicts.map((conflict) => expectedSourceIdentityKey(conflict.identity)),
  ...plan.unresolved.flatMap((item) => {
    if (!item.identity) {
      return [];
    }
    return [expectedSourceIdentityKey(item.identity)];
  }),
];

describe("every input identity lands in exactly one bucket", () => {
  test("RECON-I29: no identity appears in two buckets", () => {
    const built = mixedScenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const keys = bucketedKeys(plan);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("RECON-I29: every known identity is accounted for somewhere", () => {
    const built = mixedScenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const accounted = new Set(bucketedKeys(plan));

    for (const identity of identities) {
      expect(accounted.has(expectedSourceIdentityKey(identity))).toBe(true);
    }
  });

  test("RECON-I29: the diagnostics count matches the number of identities considered", () => {
    const built = mixedScenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    expect(plan.diagnostics.identitiesConsidered).toBe(identities.length);
  });

  test("RECON-I29: a healthy input yields empty arrays everywhere, not a silent drop", () => {
    const identity = firstOf(identities);

    const plan = planReconciliation(
      sourceOnly(
        snapshotListing({
          events: [
            foreignEvent({
              id: "evt-1",
              uid: "evt-1",
              time: timedAt(spanFor(1).start, spanFor(1).end),
              fingerprint: "fp-evt-1",
            }),
          ],
        }),
      ),
      knownState([
        knownEvent({
          identity,
          fingerprint: "fp-evt-1",
          time: timedAt(spanFor(1).start, spanFor(1).end),
        }),
      ]),
      mappingSet([mapping({ identity, destinationId: "mirror-0", sourceFingerprint: "fp-evt-1" })]),
      policy(),
    );

    expect(plan.writes).toEqual([]);
    expect(plan.tombstones).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });
});
