import { describe, expect, test, vi } from "vitest";
import { filesMatching, sourceFiles } from "../support/sources";
import { planFor, steadyScenario } from "../support/scenario";

const unfakeablePrimitive = ["Bun", "sleep"].join(".");

describe("timing primitives fake timers cannot patch", () => {
  test("RECON-L2: no file under src reaches for the unfakeable sleep primitive", async () => {
    const offenders = await filesMatching("src", unfakeablePrimitive);
    const files = await sourceFiles("src");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(15);
    expect(() => planFor(steadyScenario())).not.toThrow();
  });

  test("RECON-L2: no file under tests reaches for the unfakeable sleep primitive", async () => {
    const offenders = await filesMatching("tests", unfakeablePrimitive);
    const files = await sourceFiles("tests");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(15);
    expect(() => planFor(steadyScenario())).not.toThrow();
  });

  test("RECON-L2: a full plan arms no timer, so nothing is left waiting on one", () => {
    vi.useFakeTimers();
    try {
      planFor(steadyScenario());

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("RECON-L2: a full plan schedules no microtask continuation either", async () => {
    let drainedBeforeThePlanReturned = false;
    queueMicrotask(() => {
      drainedBeforeThePlanReturned = true;
    });

    const plan = planFor(steadyScenario());

    expect(drainedBeforeThePlanReturned).toBe(false);
    expect(plan.cursor).toEqual({ kind: "hold", reason: "noCursorOffered" });
    await Promise.resolve();
    expect(drainedBeforeThePlanReturned).toBe(true);
  });
});
