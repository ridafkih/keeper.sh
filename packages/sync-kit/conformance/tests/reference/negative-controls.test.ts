import { describe, expect, test } from "vitest";
import { conformanceCaseIds } from "../../src/case-id";
import { runSuiteAgainstMutant, runSuiteAgainstUnmutatedReference } from "../support/harness";

describe("every case ships a mutant that must fail exactly it", () => {
  test.each(conformanceCaseIds)("%s: its own mutant fails that case", async (defect) => {
    const outcome = await runSuiteAgainstMutant(defect);

    expect(outcome.failed).toContain(defect);
  });

  test.each(conformanceCaseIds)("%s: its own mutant fails no other case", async (defect) => {
    const outcome = await runSuiteAgainstMutant(defect);

    expect(outcome.failed.filter((id) => id !== defect)).toEqual([]);
  });

  test("CONF-I55: an unmutated reference fails nothing at all", async () => {
    const outcome = await runSuiteAgainstUnmutatedReference();

    expect(outcome.failed).toEqual([]);
    expect(conformanceCaseIds.length).toBeGreaterThan(50);
  });
});
