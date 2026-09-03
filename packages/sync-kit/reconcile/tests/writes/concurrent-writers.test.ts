import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import { applyPlan } from "../support/apply";
import type { Scenario } from "../support/apply";
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
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const sharedBaseState = (): Scenario => ({
  observed: sourceOnly(
    snapshotListing({
      events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-edited", version: "v1" })],
    }),
  ),
  known: knownState([knownEvent({ identity, fingerprint: "fp-original" })]),
  mappings: mappingSet([
    mapping({ identity, destinationId: "mirror-1", sourceFingerprint: "fp-original", version: "v1" }),
  ]),
  policy: policy(),
});

const planFrom = (scenario: Scenario) =>
  planReconciliation(scenario.observed, scenario.known, scenario.mappings, scenario.policy);

describe("two writers built from one base state", () => {
  test("RECON-O31: both writers plan the same single update from the shared base", () => {
    const base = sharedBaseState();

    const first = planFrom(base);
    const second = planFrom(base);

    expect(first.writes).toHaveLength(1);
    expect(JSON.stringify(first.writes)).toBe(JSON.stringify(second.writes));
  });

  test("RECON-O31: after the first writer lands, the second replans as a conflict, not an overwrite", () => {
    const base = sharedBaseState();
    const first = planFrom(base);
    const landed = applyPlan(base, first);
    const secondViewOfTheWorld: Scenario = { ...landed, mappings: base.mappings };

    const second = planFrom(secondViewOfTheWorld);

    expect(second.writes).toEqual([]);
    expect(second.conflicts).toHaveLength(1);
  });

  test("RECON-O31: the losing writer's conflict names the precondition it expected", () => {
    const base = sharedBaseState();
    const landed = applyPlan(base, planFrom(base));
    const secondViewOfTheWorld: Scenario = { ...landed, mappings: base.mappings };

    const second = planFrom(secondViewOfTheWorld);

    expect(firstOf(second.conflicts).expected).toEqual(firstOf(base.mappings.entries).precondition);
  });

  test("RECON-O31: replanning from the state the first writer left is a no-op, not a second write", () => {
    const base = sharedBaseState();
    const landed = applyPlan(base, planFrom(base));

    expect(planFrom(landed).writes).toEqual([]);
  });
});
