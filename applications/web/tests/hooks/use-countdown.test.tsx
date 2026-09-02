import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { useCountdown } from "../../src/hooks/use-countdown";
import { mountHook } from "../helpers/mount-hook";

const SECOND_MS = 1000;

interface Harness {
  secondsRemaining: () => number;
  start: (seconds: number) => void;
  unmount: () => void;
}

const mountHarness = (): Harness => {
  const hook = mountHook(useCountdown);

  return {
    secondsRemaining: () => hook.latest().secondsRemaining,
    start: (seconds: number) => React.act(() => {
      hook.latest().start(seconds);
    }),
    unmount: hook.unmount,
  };
};

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down to zero and stops ticking", () => {
    const harness = mountHarness();

    harness.start(3);
    expect(harness.secondsRemaining()).toBe(3);

    React.act(() => {
      vi.advanceTimersByTime(2 * SECOND_MS);
    });
    expect(harness.secondsRemaining()).toBe(1);

    React.act(() => {
      vi.advanceTimersByTime(SECOND_MS);
    });
    expect(harness.secondsRemaining()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    harness.unmount();
  });

  it("restarts from the new window instead of finishing the previous one", () => {
    const harness = mountHarness();

    harness.start(3);
    React.act(() => {
      vi.advanceTimersByTime(2 * SECOND_MS);
    });
    harness.start(10);

    expect(harness.secondsRemaining()).toBe(10);

    React.act(() => {
      vi.advanceTimersByTime(SECOND_MS);
    });
    expect(harness.secondsRemaining()).toBe(9);

    harness.unmount();
  });

  it("tracks wall clock time so a throttled tab resumes with the real remainder", () => {
    const harness = mountHarness();

    harness.start(60);
    React.act(() => {
      vi.advanceTimersByTime(30 * SECOND_MS);
    });

    expect(harness.secondsRemaining()).toBe(30);

    harness.unmount();
  });

  it("cancels a running countdown when the control unmounts", () => {
    const harness = mountHarness();

    harness.start(60);
    harness.unmount();

    expect(() => vi.advanceTimersByTime(60 * SECOND_MS)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
