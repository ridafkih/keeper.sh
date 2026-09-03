import { describe, expect, test } from "vitest";
import { decideCursor, planReconciliation } from "../../src/index";
import {
  cursorFor,
  deltaListing,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  partialListing,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  sourceScope,
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const unchangedListingWithNewCursor = () =>
  deltaListing({
    events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" })],
    cursor: cursorFor("cursor-page-2", sourceScope),
  });

const settledState = () => ({
  known: knownState([knownEvent({ identity, fingerprint: "fp-evt-1" })]),
  mappings: mappingSet([
    mapping({ identity, destinationId: "mirror-1", sourceFingerprint: "fp-evt-1" }),
  ]),
});

describe("the cursor decision is independent of the write set", () => {
  test("RECON-O25: an unchanged listing carrying a new cursor still advances it", () => {
    const state = settledState();

    const plan = planReconciliation(
      sourceOnly(unchangedListingWithNewCursor()),
      state.known,
      state.mappings,
      policy(),
    );

    expect(plan.cursor).toEqual({ kind: "advance", cursor: cursorFor("cursor-page-2", sourceScope) });
  });

  test("RECON-O25: that run's write set is genuinely empty, so the flush is cursor-only", () => {
    const state = settledState();

    const plan = planReconciliation(
      sourceOnly(unchangedListingWithNewCursor()),
      state.known,
      state.mappings,
      policy(),
    );

    expect(plan.writes).toEqual([]);
    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O25: the cursor decision is reachable without building the writes at all", () => {
    const state = settledState();

    expect(decideCursor(sourceOnly(unchangedListingWithNewCursor()), state.known, policy())).toEqual({
      kind: "advance",
      cursor: cursorFor("cursor-page-2", sourceScope),
    });
  });

  test("RECON-I17: a snapshot offering no cursor holds rather than inventing one", () => {
    const state = settledState();

    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [], cursor: null })),
      state.known,
      state.mappings,
      policy(),
    );

    expect(plan.cursor).toEqual({ kind: "hold", reason: "noCursorOffered" });
  });

  test("RECON-I17: a partial listing holds because the listing is incomplete, not because nothing changed", () => {
    const state = settledState();

    const plan = planReconciliation(
      sourceOnly(partialListing({ events: [] })),
      state.known,
      state.mappings,
      policy(),
    );

    expect(plan.cursor).toEqual({ kind: "hold", reason: "listingIncomplete" });
  });
});
