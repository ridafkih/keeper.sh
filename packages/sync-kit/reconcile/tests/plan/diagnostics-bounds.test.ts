import type { WithheldEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { boundedSample, defaultPlanLimits, planReconciliation } from "../../src/index";
import {
  knownState,
  mappingSet,
  policy,
  remoteId,
  snapshotListing,
  sourceOnly,
  uid,
} from "../support/fixtures";

const flood = 100_000;

const hundredThousandWithheld = (): readonly WithheldEvent[] =>
  Array.from({ length: flood }, (unused, index) => ({
    uid: uid(`evt-${index}`),
    id: remoteId(`evt-${index}`),
    reason: "unparseable" as const,
  }));

const floodedPlan = (limits = defaultPlanLimits) =>
  planReconciliation(
    sourceOnly(snapshotListing({ events: [], withheld: hundredThousandWithheld() })),
    knownState([]),
    mappingSet([]),
    policy({ limits }),
  );

const byteLengthOf = (sample: readonly string[]): number =>
  sample.reduce((total, entry) => total + new TextEncoder().encode(entry).length, 0);

describe("diagnostic samples are capped in count AND in bytes", () => {
  test("RECON-L7: a hundred thousand unresolved items do not produce a hundred thousand samples", () => {
    const plan = floodedPlan();

    expect(plan.diagnostics.unresolved.sample.length).toBeLessThanOrEqual(
      defaultPlanLimits.sampleCount,
    );
  });

  test("RECON-L7: the total stays exact even though the sample is capped", () => {
    const plan = floodedPlan();

    expect(plan.diagnostics.unresolved.total).toBe(flood);
  });

  test("RECON-L7: the byte ceiling binds even when the count ceiling would not", () => {
    const tightBytes = { ...defaultPlanLimits, sampleCount: 10_000, sampleBytes: 128 };

    const plan = floodedPlan(tightBytes);

    expect(byteLengthOf(plan.diagnostics.unresolved.sample)).toBeLessThanOrEqual(128);
    expect(plan.diagnostics.unresolved.total).toBe(flood);
  });

  test("RECON-L7: the count ceiling binds when the byte ceiling would not", () => {
    const tightCount = { ...defaultPlanLimits, sampleCount: 3, sampleBytes: 1_000_000 };

    const plan = floodedPlan(tightCount);

    expect(plan.diagnostics.unresolved.sample).toHaveLength(3);
  });

  test("RECON-L7: raising the named ceiling is what changes the outcome, not an incidental limit", () => {
    const narrow = floodedPlan({ ...defaultPlanLimits, sampleCount: 4, sampleBytes: 1_000_000 });
    const wide = floodedPlan({ ...defaultPlanLimits, sampleCount: 9, sampleBytes: 1_000_000 });

    expect(narrow.diagnostics.unresolved.sample).toHaveLength(4);
    expect(wide.diagnostics.unresolved.sample).toHaveLength(9);
  });

  test("RECON-L7: the sample builder honours both ceilings on its own", () => {
    const values = Array.from({ length: 1000 }, (unused, index) => `identity-${index}`);

    const sample = boundedSample(values, { ...defaultPlanLimits, sampleCount: 5, sampleBytes: 40 });

    expect(sample.sample.length).toBeLessThanOrEqual(5);
    expect(byteLengthOf(sample.sample)).toBeLessThanOrEqual(40);
    expect(sample.total).toBe(1000);
  });

  test("RECON-I40: the diagnostics carry identifiers and counts only, never content", () => {
    const plan = floodedPlan();
    const serialised = JSON.stringify(plan.diagnostics);

    expect(serialised).not.toContain("description");
    expect(serialised).not.toContain("location");
  });
});
