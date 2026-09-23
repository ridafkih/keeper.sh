import { describe, expect, test } from "vitest";
import { planReconciliation } from "../../src/index";
import {
  cursorFor,
  deltaListing,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  provenWindows,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  sourceScope,
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const settled = () => ({
  known: knownState([knownEvent({ identity, fingerprint: "fp-evt-1" })]),
  mappings: mappingSet([
    mapping({ identity, destinationId: "mirror-1", sourceFingerprint: "fp-evt-1" }),
  ]),
});

describe("a run with nothing to write may still need to flush", () => {
  test("RECON-I39: a no-op delta still carries a cursor decision", () => {
    const state = settled();

    const plan = planReconciliation(
      sourceOnly(
        deltaListing({
          events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" })],
          cursor: cursorFor("cursor-fresh", sourceScope),
        }),
      ),
      state.known,
      state.mappings,
      policy(),
    );

    expect(plan.writes).toEqual([]);
    expect(plan.cursor).toEqual({ kind: "advance", cursor: cursorFor("cursor-fresh", sourceScope) });
  });

  test("RECON-I39: a no-op snapshot still carries the coverage it proved", () => {
    const state = settled();

    const plan = planReconciliation(
      sourceOnly(
        snapshotListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" })] }),
      ),
      state.known,
      state.mappings,
      policy(),
    );

    expect(plan.coverage.kind).toBe("proven");
  });

  test("RECON-I39: empty arrays are not the same value as an unproven no-op", () => {
    const state = settled();

    const empty = planReconciliation(
      sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" })] })),
      state.known,
      state.mappings,
      policy(),
    );
    const lost = planReconciliation(
      sourceOnly(deltaListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" })] })),
      state.known,
      state.mappings,
      policy({ coverage: { kind: "unproven" } }),
    );

    expect(empty.coverage).not.toEqual(lost.coverage);
    expect(empty.writes).toEqual(lost.writes);
  });

  test("RECON-I39: proving coverage is reported even when the plan is otherwise empty", () => {
    const state = settled();

    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" })] })),
      state.known,
      state.mappings,
      policy(),
    );

    expect(plan.coverage).toEqual(provenWindows);
  });
});
