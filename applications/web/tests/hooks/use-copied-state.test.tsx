import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { useCopiedState } from "../../src/hooks/use-copied-state";
import { mountHook } from "../helpers/mount-hook";

const RESET_MS = 2000;

interface Harness {
  copied: () => boolean;
  copy: () => void;
  unmount: () => void;
}

const mountHarness = (): Harness => {
  const hook = mountHook(() => useCopiedState(RESET_MS));

  return {
    copied: () => hook.latest().copied,
    copy: () => React.act(() => {
      hook.latest().markCopied();
    }),
    unmount: hook.unmount,
  };
};

describe("useCopiedState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the indicator once the window elapses", () => {
    const harness = mountHarness();

    harness.copy();
    expect(harness.copied()).toBe(true);

    React.act(() => {
      vi.advanceTimersByTime(RESET_MS);
    });
    expect(harness.copied()).toBe(false);

    harness.unmount();
  });

  /*
   * The earlier timer must be cancelled, otherwise spamming the button clears
   * the indicator while the most recent copy is still fresh.
   */
  it("restarts the window instead of letting an earlier copy clear it", () => {
    const harness = mountHarness();

    harness.copy();
    React.act(() => {
      vi.advanceTimersByTime(RESET_MS - 100);
    });
    harness.copy();

    React.act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(harness.copied()).toBe(true);

    React.act(() => {
      vi.advanceTimersByTime(RESET_MS);
    });
    expect(harness.copied()).toBe(false);

    harness.unmount();
  });

  it("cancels a pending reset when the button unmounts", () => {
    const harness = mountHarness();

    harness.copy();
    harness.unmount();

    expect(() => vi.advanceTimersByTime(RESET_MS)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
