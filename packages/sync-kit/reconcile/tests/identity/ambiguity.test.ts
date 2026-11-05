import { describe, expect, test } from "vitest";
import { observedSourceIdentity, planReconciliation } from "../../src/index";
import {
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

const sharedUid = "duplicate-uid";
const span = { start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T10:00:00.000Z" };
const identity = slotIdentity(sharedUid, span.start, span.end);

const twoEventsOneUid = () =>
  snapshotListing({
    events: [
      foreignEvent({ id: "copy-a", uid: sharedUid, time: timedAt(span.start, span.end), fingerprint: "fp-a" }),
      foreignEvent({ id: "copy-b", uid: sharedUid, time: timedAt(span.start, span.end), fingerprint: "fp-b" }),
    ],
  });

describe("the planner never guesses between two events sharing one identity", () => {
  test("RECON-O24: a duplicate-uid pair deletes neither", () => {
    const plan = planReconciliation(
      sourceOnly(twoEventsOneUid()),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O24: the ambiguity is reported rather than resolved by feed order", () => {
    const plan = planReconciliation(
      sourceOnly(twoEventsOneUid()),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(plan.unresolved.map((item) => item.reason)).toContain("ambiguousIdentity");
  });

  test("RECON-O24: an ambiguous identity produces no write, so neither copy overwrites the mirror", () => {
    const plan = planReconciliation(
      sourceOnly(twoEventsOneUid()),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(plan.writes).toEqual([]);
  });

  test("RECON-O24: reversing the order of the two copies changes nothing", () => {
    const forward = planReconciliation(
      sourceOnly(twoEventsOneUid()),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );
    const listing = twoEventsOneUid();
    const reversedListing = snapshotListing({
      events: [...(listing.events ?? [])].toReversed(),
    });
    const reversed = planReconciliation(
      sourceOnly(reversedListing),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  test("RECON-I21: an event whose identity cannot be resolved is reported, never guessed", () => {
    const withoutTimeOrRecurrence = foreignEvent({ id: "evt-mystery", uid: "" });

    expect(observedSourceIdentity(withoutTimeOrRecurrence)).toBeNull();
  });

  test("RECON-I21: an unresolvable identity reaches the plan as missingIdentity", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-mystery", uid: "" })] })),
      knownState([]),
      mappingSet([]),
      policy(),
    );

    expect(plan.unresolved).toEqual([
      { identity: null, id: { kind: "remoteEventId", value: "evt-mystery" }, reason: "missingIdentity" },
    ]);
  });
});
