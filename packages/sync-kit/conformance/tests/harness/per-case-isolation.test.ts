import { describe, expect, test } from "vitest";
import { conformanceCaseIds } from "../../src/case-id";
import { planConformanceRun } from "../../src/run-conformance";
import type { ConformanceEnvironment, ProviderUnderTest } from "../../src/options";
import { referenceCapabilities } from "../../src/reference/capabilities";
import { createReferenceProvider } from "../../src/reference/provider";
import { isInsideWindow } from "../support/protocol";

interface CountingCreate {
  readonly create: (environment: ConformanceEnvironment) => Promise<ProviderUnderTest<"reference">>;
  readonly creations: () => number;
  readonly disposals: () => number;
}

const countingCreate = (): CountingCreate => {
  let creations = 0;
  let disposals = 0;
  return {
    create: async (environment) => {
      creations += 1;
      const provider = await createReferenceProvider(environment);
      return {
        ...provider,
        dispose: async () => {
          disposals += 1;
          await provider.dispose();
        },
      };
    },
    creations: () => creations,
    disposals: () => disposals,
  };
};

const planWith = (counting: CountingCreate) =>
  planConformanceRun({
    name: "reference",
    supports: referenceCapabilities,
    create: counting.create,
    withinWindow: isInsideWindow,
  });

describe("a provider instance never outlives its case", () => {
  test("CONF-I57: planning the run creates no provider at all", () => {
    const counting = countingCreate();

    const plan = planWith(counting);

    expect(plan.cases.length).toBeGreaterThan(0);
    expect(counting.creations()).toBe(0);
  });

  test("CONF-I57: create runs once per case, not once per suite", async () => {
    const counting = countingCreate();
    const plan = planWith(counting);

    await plan.cases[0]?.execute();
    await plan.cases[1]?.execute();

    expect(counting.creations()).toBe(2);
  });

  test("CONF-I57: a case disposes its provider even when the case fails", async () => {
    const counting = countingCreate();
    const plan = planWith(counting);

    await Promise.allSettled(plan.cases.slice(0, 3).map((entry) => entry.execute()));

    expect(counting.disposals()).toBe(counting.creations());
  });

  test("CONF-I57: the report names every case the plan will execute", () => {
    const counting = countingCreate();

    const plan = planWith(counting);

    expect(plan.report.selected.map((entry) => entry.id)).toEqual(
      plan.cases.map((entry) => entry.id),
    );
  });

  test("CONF-I77: no capability value removes a case from the report", () => {
    const counting = countingCreate();

    const plan = planWith(counting);
    const missing = conformanceCaseIds.filter(
      (id) => !plan.report.selected.some((selected) => selected.id === id),
    );

    expect(missing).toEqual([]);
    expect(plan.report.ungated.length).toBeGreaterThan(0);
  });
});
