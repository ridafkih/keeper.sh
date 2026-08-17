import { describe, expect, test } from "vitest";
import { planFor, steadyScenario } from "../support/scenario";
import { filesMatching, readSource, sourceFiles } from "../support/sources";

describe("no accumulator carries across runs", () => {
  test("RECON-I24: no module under src declares module-level mutable state", async () => {
    const files = await sourceFiles("src");
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readSource(file);
      const moduleLevelLet = text.split("\n").some((line) => line.startsWith("let "));
      if (moduleLevelLet) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(15);
  });

  test("RECON-I24: no module under src reaches for a global or declares var", async () => {
    const files = await sourceFiles("src");
    const varDeclarations: string[] = [];
    for (const file of files) {
      const text = await readSource(file);
      if (text.split("\n").some((line) => line.trimStart().startsWith("var "))) {
        varDeclarations.push(file);
      }
    }

    expect(await filesMatching("src", "globalThis")).toEqual([]);
    expect(varDeclarations).toEqual([]);
  });

  test("RECON-I24: a hundred consecutive plans over the same input are identical", () => {
    const scenario = steadyScenario();
    const first = JSON.stringify(planFor(scenario));

    for (let run = 0; run < 100; run++) {
      expect(JSON.stringify(planFor(scenario))).toBe(first);
    }
  });

  test("RECON-I24: the write list is flat, so an applier may chunk it anywhere", () => {
    const plan = planFor(steadyScenario());

    expect(Array.isArray(plan.writes)).toBe(true);
    for (const write of plan.writes) {
      expect(["single", "replace"]).toContain(write.kind);
    }
  });
});
