import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { useNowMinute } from "../../src/hooks/use-now-minute";
import { mountHook } from "../helpers/mount-hook";

const SECOND_MS = 1000;
const NativeEvent = globalThis.Event;

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
};

describe("useNowMinute", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 10, 42, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the clock on mount and ticks on the next minute boundary", () => {
    const hook = mountHook(useNowMinute);
    expect(hook.latest()?.getMinutes()).toBe(42);

    React.act(() => {
      vi.advanceTimersByTime(29 * SECOND_MS);
    });
    expect(hook.latest()?.getMinutes()).toBe(42);

    React.act(() => {
      vi.advanceTimersByTime(SECOND_MS);
    });
    expect(hook.latest()?.getMinutes()).toBe(43);
    expect(hook.latest()?.getSeconds()).toBe(0);

    hook.unmount();
  });

  it("re-reads a stale clock when the tab becomes visible, not while hidden", () => {
    const hook = mountHook(useNowMinute);
    vi.setSystemTime(new Date(2026, 0, 5, 10, 45, 10));

    setVisibility("hidden");
    React.act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(hook.latest()?.getMinutes()).toBe(42);

    setVisibility("visible");
    React.act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(hook.latest()?.getMinutes()).toBe(45);

    hook.unmount();
  });

  it("keeps the same Date when focus lands inside the current minute", () => {
    const hook = mountHook(useNowMinute);
    const before = hook.latest();
    setVisibility("visible");

    React.act(() => {
      globalThis.dispatchEvent(new NativeEvent("focus"));
    });
    expect(hook.latest()).toBe(before);

    hook.unmount();
  });

  it("stops ticking when the component unmounts", () => {
    const hook = mountHook(useNowMinute);
    expect(vi.getTimerCount()).toBe(1);

    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
