import { describe, expect, test, vi } from "vitest";
import { filesMatching, sourceFiles } from "../support/sources";
import { runShadow, steadyInput } from "../support/scenario";

const unfakeableSleep = ["Bun", "sleep"].join(".");
const deferrals = ["setTimeout", "setInterval", ["new", "Promise"].join(" ")];

describe("timing primitives fake timers cannot patch", () => {
  test("SHADOW-L2: no source file references Bun.sleep, setTimeout or setInterval", async () => {
    const offenders: string[] = [];
    for (const needle of [unfakeableSleep, ...deferrals]) {
      offenders.push(...(await filesMatching("src", needle)));
    }
    const files = await sourceFiles("src");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(15);
    expect(runShadow(steadyInput()).kind).toBe("cataloged");
  });

  test("SHADOW-L2: a full shadow run arms no timer, so nothing is left waiting on one", () => {
    vi.useFakeTimers();
    try {
      const catalog = runShadow(steadyInput());

      expect(vi.getTimerCount()).toBe(0);
      expect(catalog.kind).toBe("cataloged");
    } finally {
      vi.useRealTimers();
    }
  });

  test("SHADOW-L2: a full shadow run schedules no microtask continuation either", async () => {
    let drainedBeforeTheRunReturned = false;
    queueMicrotask(() => {
      drainedBeforeTheRunReturned = true;
    });

    const catalog = runShadow(steadyInput());

    expect(drainedBeforeTheRunReturned).toBe(false);
    expect(catalog.kind).toBe("cataloged");
    await Promise.resolve();
    expect(drainedBeforeTheRunReturned).toBe(true);
  });
});
