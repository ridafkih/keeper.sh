import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { at, firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import type { KnownEvent, Mapping } from "../../src/index";
import {
  deltaListing,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  timedAt,
} from "../support/fixtures";

const permutations = <Item,>(items: readonly Item[]): readonly (readonly Item[])[] => {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutations(rest).map((tail) => [item, ...tail]);
  });
};

const spans = [1, 2, 3, 4, 5].map((index) => ({
  start: `2026-03-1${index}T09:00:00.000Z`,
  end: `2026-03-1${index}T10:00:00.000Z`,
}));

const identities = spans.map((span, index) => slotIdentity(`evt-${index}`, span.start, span.end));

const events: readonly RemoteEvent[] = spans.map((span, index) =>
  foreignEvent({
    id: `evt-${index}`,
    uid: `evt-${index}`,
    time: timedAt(span.start, span.end),
    fingerprint: `fp-changed-${index}`,
  }),
);

const knownEvents: readonly KnownEvent[] = identities.map((identity, index) =>
  knownEvent({
    identity,
    fingerprint: `fp-old-${index}`,
    time: timedAt(at(spans, index).start, at(spans, index).end),
  }),
);

const mappings: readonly Mapping[] = identities.map((identity, index) =>
  mapping({ identity, destinationId: `mirror-${index}`, sourceFingerprint: `fp-old-${index}` }),
);

const planFor = (
  orderedEvents: readonly RemoteEvent[],
  orderedKnown: readonly KnownEvent[],
  orderedMappings: readonly Mapping[],
) =>
  planReconciliation(
    sourceOnly(snapshotListing({ events: orderedEvents })),
    knownState(orderedKnown),
    mappingSet(orderedMappings),
    policy(),
  );

const canonical = () => JSON.stringify(planFor(events, knownEvents, mappings));

describe("the plan is a function of the state, not of the feed order", () => {
  test("RECON-O18: all 120 permutations of a five-event listing produce the same plan", () => {
    const orders = permutations(events);
    const distinct = new Set(orders.map((order) => JSON.stringify(planFor(order, knownEvents, mappings))));

    expect(orders).toHaveLength(120);
    expect(distinct.size).toBe(1);
  });

  test("RECON-O18: reordering the known state does not change the plan", () => {
    const distinct = new Set(
      permutations(knownEvents).map((order) => JSON.stringify(planFor(events, order, mappings))),
    );

    expect(distinct.size).toBe(1);
    expect(firstOf([...distinct])).toBe(canonical());
  });

  test("RECON-O18: reordering the mappings does not change the plan", () => {
    const distinct = new Set(
      permutations(mappings).map((order) => JSON.stringify(planFor(events, knownEvents, order))),
    );

    expect(distinct.size).toBe(1);
    expect(firstOf([...distinct])).toBe(canonical());
  });

  test("RECON-O18: the plan actually contains writes, so this sweep is not comparing emptiness", () => {
    expect(planFor(events, knownEvents, mappings).writes.length).toBeGreaterThan(0);
  });

  test("RECON-O19: three revisions of one identity apply the newest regardless of page order", () => {
    const identity = firstOf(identities);
    const revisions = [1, 2, 3].map((revision) =>
      foreignEvent({
        id: "evt-0",
        uid: "evt-0",
        revision,
        version: `v${revision}`,
        fingerprint: `fp-rev-${revision}`,
        time: timedAt(firstOf(spans).start, firstOf(spans).end),
      }),
    );

    const ascending = planReconciliation(
      sourceOnly(deltaListing({ events: revisions })),
      knownState([knownEvent({ identity, fingerprint: "fp-old-0" })]),
      mappingSet([mapping({ identity, destinationId: "mirror-0", sourceFingerprint: "fp-old-0" })]),
      policy(),
    );
    const descending = planReconciliation(
      sourceOnly(deltaListing({ events: [...revisions].toReversed() })),
      knownState([knownEvent({ identity, fingerprint: "fp-old-0" })]),
      mappingSet([mapping({ identity, destinationId: "mirror-0", sourceFingerprint: "fp-old-0" })]),
      policy(),
    );

    expect(JSON.stringify(ascending)).toBe(JSON.stringify(descending));
    expect(ascending.writes).toHaveLength(1);
  });

  test("RECON-O19: the surviving write is built from the highest revision, not the last in the array", () => {
    const identity = firstOf(identities);
    const revisions = [3, 1, 2].map((revision) =>
      foreignEvent({
        id: "evt-0",
        uid: "evt-0",
        revision,
        version: `v${revision}`,
        fingerprint: `fp-rev-${revision}`,
        time: timedAt(firstOf(spans).start, firstOf(spans).end),
      }),
    );

    const plan = planReconciliation(
      sourceOnly(deltaListing({ events: revisions })),
      knownState([knownEvent({ identity, fingerprint: "fp-old-0" })]),
      mappingSet([mapping({ identity, destinationId: "mirror-0", sourceFingerprint: "fp-old-0" })]),
      policy(),
    );
    const written = firstOf(plan.writes);
    const fingerprintWritten = () => {
      if (written.kind !== "single" || written.intent.kind !== "update") {
        return "not-an-update";
      }
      return written.intent.content.fingerprint.value;
    };

    expect(fingerprintWritten()).toBe("fp-rev-3");
  });
});
