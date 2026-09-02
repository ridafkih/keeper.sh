import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useNowMinute } from "../../src/hooks/use-now-minute";

const SECOND_MS = 1000;

interface Harness {
  now: () => Date | null;
  unmount: () => void;
}

const INJECTED_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "Event",
  "MutationObserver",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

let restoreDom = (): void => undefined;

const setupDom = () => {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const previous = Object.fromEntries(
    INJECTED_GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
  );
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Text: window.Text,
    Event: window.Event,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  restoreDom = () => {
    for (const key of INJECTED_GLOBALS) {
      if (previous[key] === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
        continue;
      }
      (globalThis as Record<string, unknown>)[key] = previous[key];
    }
  };
  return window;
};

const mountHarness = (): Harness => {
  const window = setupDom();
  const container = window.document.getElementById("root") as unknown as Element;
  const root = createRoot(container);

  const renders: (Date | null)[] = [];

  const Probe = () => {
    renders.push(useNowMinute());
    return null;
  };

  React.act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    now: () => renders[renders.length - 1] ?? null,
    unmount: () => {
      React.act(() => {
        root.unmount();
      });
      restoreDom();
    },
  };
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
    const harness = mountHarness();
    expect(harness.now()?.getMinutes()).toBe(42);

    React.act(() => {
      vi.advanceTimersByTime(29 * SECOND_MS);
    });
    expect(harness.now()?.getMinutes()).toBe(42);

    React.act(() => {
      vi.advanceTimersByTime(SECOND_MS);
    });
    expect(harness.now()?.getMinutes()).toBe(43);
    expect(harness.now()?.getSeconds()).toBe(0);

    harness.unmount();
  });

  it("stops ticking when the component unmounts", () => {
    const harness = mountHarness();
    harness.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
