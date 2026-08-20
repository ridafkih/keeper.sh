import { describe, expect, test, vi } from "vitest";
import { createTestClock } from "../../src/clock";
import { filesMatching, sourceFiles } from "../support/sources";
import { suiteStart } from "../support/harness";

const unfakeablePrimitiveThisFileMustNotSpellOutItself = ["Bun", "sleep"].join(".");

describe("timing primitives fake timers cannot patch", () => {
  test("CONF-I51: no file under src reaches for the unfakeable sleep primitive", async () => {
    const offenders = await filesMatching("src", unfakeablePrimitiveThisFileMustNotSpellOutItself);
    const files = await sourceFiles("src");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(20);
  });

  test("CONF-I51: no file under tests reaches for the unfakeable sleep primitive", async () => {
    const offenders = await filesMatching("tests", unfakeablePrimitiveThisFileMustNotSpellOutItself);
    const files = await sourceFiles("tests");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(15);
  });

  test("CONF-I51: the injected clock schedules through setTimeout so fake timers can drive it", async () => {
    vi.useFakeTimers();
    const clock = createTestClock({ start: suiteStart });

    const sleeping = clock.sleep(500, new AbortController().signal);
    const armed = clock.pendingTimers();
    await vi.advanceTimersByTimeAsync(500);
    await sleeping;

    expect(armed).toBe(1);
    expect(clock.pendingTimers()).toBe(0);
    expect(Date.parse(clock.now().value) - Date.parse(suiteStart.value)).toBe(500);
    vi.useRealTimers();
  });
});
