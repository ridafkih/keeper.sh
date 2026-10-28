import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { mirrorIdempotencyKey, planReconciliation } from "../../src/index";
import { applyPlan } from "../support/apply";
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

const identity = slotIdentity("evt-new", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const firstRun = () => ({
  observed: sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-new", uid: "evt-new" })] })),
  known: knownState([]),
  mappings: mappingSet([]),
  policy: policy(),
});

describe("a replayed create is a no-op, never a duplicate", () => {
  test("RECON-O12: an unmapped observed event produces exactly one create", () => {
    const scenario = firstRun();

    const plan = planReconciliation(scenario.observed, scenario.known, scenario.mappings, scenario.policy);
    const creates = plan.writes.filter((write) => write.kind === "single" && write.intent.kind === "create");

    expect(creates).toHaveLength(1);
  });

  test("RECON-O12: replanning after the create landed produces no second create", () => {
    const scenario = firstRun();
    const first = planReconciliation(scenario.observed, scenario.known, scenario.mappings, scenario.policy);
    const settled = applyPlan(scenario, first);

    const second = planReconciliation(settled.observed, settled.known, settled.mappings, settled.policy);

    expect(second.writes).toEqual([]);
  });

  test("RECON-O12: with the mapping deliberately missing the observed identity is still authoritative", () => {
    const scenario = firstRun();
    const first = planReconciliation(scenario.observed, scenario.known, scenario.mappings, scenario.policy);
    const settled = applyPlan(scenario, first);
    const withoutMapping = { ...settled, mappings: mappingSet([]) };

    const second = planReconciliation(
      withoutMapping.observed,
      withoutMapping.known,
      withoutMapping.mappings,
      withoutMapping.policy,
    );
    const creates = second.writes.filter((write) => write.kind === "single" && write.intent.kind === "create");

    const created = firstOf(creates);
    const keyOf = () => {
      if (created.kind !== "single" || created.intent.kind !== "create") {
        return null;
      }
      return created.intent.idempotencyKey;
    };

    expect(creates).toHaveLength(1);
    expect(keyOf()).toEqual(mirrorIdempotencyKey(identity, scenario.policy));
  });

  test("RECON-I16: the idempotency key is a pure function of destination calendar and source identity", () => {
    expect(mirrorIdempotencyKey(identity, policy())).toEqual(mirrorIdempotencyKey(identity, policy()));
  });

  test("RECON-I16: two different identities never share an idempotency key", () => {
    const other = slotIdentity("evt-other", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

    expect(mirrorIdempotencyKey(identity, policy())).not.toEqual(mirrorIdempotencyKey(other, policy()));
  });

  test("RECON-O12: an already mapped and unchanged event plans nothing", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-new", uid: "evt-new" })] })),
      knownState([knownEvent({ identity, fingerprint: "fp-evt-new" })]),
      mappingSet([mapping({ identity, destinationId: "mirror-new", sourceFingerprint: "fp-evt-new" })]),
      policy(),
    );

    expect(plan.writes).toEqual([]);
    expect(plan.tombstones).toEqual([]);
  });
});
