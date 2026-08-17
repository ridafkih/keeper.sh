import { describe, expect, test } from "vitest";
import { withinGoogleWindow } from "../../src/window/membership";
import { marchWindow } from "../support/harness";
import { filesMatching, sourceFiles } from "../support/sources";

const unfakeablePrimitive = ["Bun", "sleep"].join(".");
const thisFile = "tests/hygiene/no-bun-sleep.test.ts";

const someTimedEvent = {
  kind: "timed",
  start: { kind: "instant", value: "2026-03-10T09:00:00.000Z" },
  end: { kind: "instant", value: "2026-03-10T10:00:00.000Z" },
  zone: null,
} as const;

describe("timing primitives fake timers cannot patch", () => {
  test("GOOG-L1: no source file references Bun.sleep", async () => {
    const offenders = await filesMatching("src", unfakeablePrimitive);
    const files = await sourceFiles("src");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
    expect(withinGoogleWindow(marchWindow, someTimedEvent)).toBe(true);
  });

  test("GOOG-L1: no test file reaches for the unfakeable sleep either", async () => {
    const matched = await filesMatching("tests", unfakeablePrimitive);
    const offenders = matched.filter((file) => file !== thisFile);
    const files = await sourceFiles("tests");

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
  });

  test("GOOG-L1: every delay in the package goes through the injected clock", async () => {
    const sleepers = await filesMatching("src", "setTimeout");

    expect(sleepers).toEqual([]);
    expect(await filesMatching("src", "clock.sleep")).not.toEqual([]);
  });
});
