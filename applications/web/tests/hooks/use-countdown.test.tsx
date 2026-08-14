import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useCountdown } from "../../src/hooks/use-countdown";

const SECOND_MS = 1000;

interface Harness {
  secondsRemaining: () => number;
  start: (seconds: number) => void;
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

  const renders: ReturnType<typeof useCountdown>[] = [];

  const Probe = () => {
    renders.push(useCountdown());
    return null;
  };

  const latest = () => {
    const state = renders[renders.length - 1];
    if (!state) {
      throw new Error("Harness never rendered");
    }
    return state;
  };

  React.act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    secondsRemaining: () => latest().secondsRemaining,
    start: (seconds: number) => React.act(() => {
      latest().start(seconds);
    }),
    unmount: () => {
      React.act(() => {
        root.unmount();
      });
      restoreDom();
    },
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
