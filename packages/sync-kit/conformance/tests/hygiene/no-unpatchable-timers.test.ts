import { describe, expect, test } from "vitest";
import { createTestClock } from "../../src/clock";
import { filesMatching } from "../support/sources";
import { suiteStart } from "../support/harness";

const abortTimeoutThisFileMustNotSpellOutItself = ["AbortSignal", "timeout"].join(".");
const timersModuleThisFileMustNotSpellOutItself = ["node", "timers/promises"].join(":");

describe("deadlines are built only from primitives fake timers patch", () => {
  test("CONF-I52: no file under src uses the unpatchable AbortSignal timeout", async () => {
    const offenders = await filesMatching("src", abortTimeoutThisFileMustNotSpellOutItself);

    expect(offenders).toEqual([]);
  });

  test("CONF-I52: no file under tests uses the unpatchable AbortSignal timeout", async () => {
    const offenders = await filesMatching("tests", abortTimeoutThisFileMustNotSpellOutItself);

    expect(offenders).toEqual([]);
  });

  test("CONF-I52: nothing imports the node timers/promises module", async () => {
    const inSource = await filesMatching("src", timersModuleThisFileMustNotSpellOutItself);
    const inTests = await filesMatching("tests", timersModuleThisFileMustNotSpellOutItself);

    expect([...inSource, ...inTests]).toEqual([]);
  });

  test("CONF-I52: the clock owns its own AbortController rather than borrowing one", async () => {
    const clock = createTestClock({ start: suiteStart });
    const caller = new AbortController();
    caller.abort();

    await expect(clock.sleep(1000, caller.signal)).rejects.toThrow();
    expect(clock.pendingTimers()).toBe(0);
  });
});
