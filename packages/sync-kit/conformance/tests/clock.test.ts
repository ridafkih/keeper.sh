import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestClock } from "../src/clock";
import { suiteStart } from "./support/harness";

const abortListenersOn = (signal: AbortSignal): number => getEventListeners(signal, "abort").length;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the injected clock is drivable and leaves nothing behind", () => {
  test("CONF-I51: a sleep is armed through setTimeout and resolved by advancing fake time", async () => {
    const clock = createTestClock({ start: suiteStart });
    const { signal } = new AbortController();

    const sleeping = clock.sleep(1000, signal);
    expect(clock.pendingTimers()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await sleeping;

    expect(clock.pendingTimers()).toBe(0);
    expect(Date.parse(clock.now().value) - Date.parse(suiteStart.value)).toBe(1000);
  });

  test("CONF-I21: sleeping repeatedly on one signal does not accumulate abort listeners", async () => {
    const clock = createTestClock({ start: suiteStart });
    const caller = new AbortController();

    for (const _attempt of [1, 2, 3, 4, 5]) {
      const sleeping = clock.sleep(10, caller.signal);
      await vi.advanceTimersByTimeAsync(10);
      await sleeping;
    }

    expect(abortListenersOn(caller.signal)).toBe(0);
    expect(clock.pendingTimers()).toBe(0);
  });

  test("CONF-I21: an aborted sleep rejects, clears its timer and removes its listener", async () => {
    const clock = createTestClock({ start: suiteStart });
    const caller = new AbortController();

    const sleeping = clock.sleep(10_000, caller.signal);
    expect(clock.pendingTimers()).toBe(1);
    caller.abort();

    await expect(sleeping).rejects.toThrow("aborted");
    expect(clock.pendingTimers()).toBe(0);
    expect(abortListenersOn(caller.signal)).toBe(0);
  });
});
