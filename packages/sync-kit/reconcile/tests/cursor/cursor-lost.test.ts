import { describe, expect, test } from "vitest";
import { decideCursor, planReconciliation } from "../../src/index";
import {
  cursorLostListing,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  sourceOnly,
} from "../support/fixtures";

const identities = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) =>
  slotIdentity(`evt-${index}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const populated = () => knownState(identities.map((identity) => knownEvent({ identity })));
const mapped = () =>
  mappingSet(identities.map((identity, index) => mapping({ identity, destinationId: `mirror-${index}` })));

const observed = () => sourceOnly(cursorLostListing({}));

describe("a lost cursor is a resync signal, not a wipe signal", () => {
  test("RECON-O2: a cursorLost listing against ten known events tombstones none of them", () => {
    const plan = planReconciliation(observed(), populated(), mapped(), policy());

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O2: a cursorLost listing plans no writes either", () => {
    const plan = planReconciliation(observed(), populated(), mapped(), policy());

    expect(plan.writes).toEqual([]);
  });

  test("RECON-O2: a cursorLost listing resets the cursor and says why", () => {
    const plan = planReconciliation(observed(), populated(), mapped(), policy());

    expect(plan.cursor).toEqual({ kind: "reset", reason: "cursorLost" });
  });

  test("RECON-O2: the cursor decision alone reaches reset without consulting the writes", () => {
    expect(decideCursor(observed(), populated(), policy())).toEqual({
      kind: "reset",
      reason: "cursorLost",
    });
  });

  test("RECON-O2: coverage after a lost cursor is unproven, so the next run cannot infer deletions", () => {
    const plan = planReconciliation(observed(), populated(), mapped(), policy());

    expect(plan.coverage).toEqual({ kind: "unproven" });
  });
});
