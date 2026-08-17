import { describe, expect, test } from "vitest";
import { withinMicrosoftWindow } from "../../src/window/membership";
import { marchWindow } from "../support/harness";
import { filesMatching, sourceFiles } from "../support/sources";

const unfakeablePrimitive = ["Bun", "sleep"].join(".");
const unfakeableTimeout = ["AbortSignal", "timeout"].join(".");
const thisFile = "tests/hygiene/no-bun-sleep.test.ts";

const someTimedEvent = {
  kind: "timed",
  start: { kind: "instant", value: "2026-03-10T09:00:00.000Z" },
  end: { kind: "instant", value: "2026-03-10T10:00:00.000Z" },
  zone: null,
} as const;

describe("timing primitives fake timers cannot patch", () => {
  test("MS-L6: no source file references Bun.sleep or AbortSignal.timeout", async () => {
    const sleepers = await filesMatching("src", unfakeablePrimitive);
    const timeouts = await filesMatching("src", unfakeableTimeout);
    const files = await sourceFiles("src");

    expect(sleepers).toEqual([]);
    expect(timeouts).toEqual([]);
    expect(files.length).toBeGreaterThan(40);
    expect(withinMicrosoftWindow(marchWindow, someTimedEvent)).toBe(true);
  });

  test("MS-L6: no test file reaches for the unfakeable sleep either", async () => {
    const matched = await filesMatching("tests", unfakeablePrimitive);
    const offenders = matched.filter((file) => file !== thisFile);

    expect(offenders).toEqual([]);
    expect(withinMicrosoftWindow(marchWindow, someTimedEvent)).toBe(true);
  });

  test("MS-L6: every delay in the package goes through the injected clock", async () => {
    const rawTimers = await filesMatching("src", "setTimeout");
    const injected = await filesMatching("src", "clock.sleep");

    expect(rawTimers).toEqual([]);
    expect(injected).not.toEqual([]);
  });
});
