import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useCopiedState } from "../../src/hooks/use-copied-state";

const RESET_MS = 2000;

interface Harness {
  copied: () => boolean;
  copy: () => void;
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

  const renders: ReturnType<typeof useCopiedState>[] = [];

  const Probe = () => {
    renders.push(useCopiedState(RESET_MS));
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
    copied: () => latest().copied,
    copy: () => React.act(() => {
      latest().markCopied();
    }),
    unmount: () => {
      React.act(() => {
        root.unmount();
      });
      restoreDom();
    },
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
