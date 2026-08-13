import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { SWRConfig } from "swr";
import { useSubscription } from "../../src/hooks/use-subscription";
import { resolveUpgradeMode } from "../../src/lib/upgrade-mode";
import type { SubscriptionState } from "../../src/hooks/use-subscription";
import type { UpgradeMode } from "../../src/lib/upgrade-mode";

type ReadMode =
  | { kind: "healthy"; interval: "month" | "year" | null }
  | { kind: "free" }
  | { kind: "outage"; plan: "free" | "pro" }
  | { kind: "down" };

interface Harness {
  renders: SubscriptionState[][];
  modes: UpgradeMode[];
  errors: unknown[];
  renderCount: () => number;
  refresh: () => Promise<void>;
  refreshInTransition: () => Promise<void>;
  overlappingRefresh: (delayFirst: number, secondMode?: ReadMode) => Promise<void>;
  unmount: () => void;
  customerStateReads: () => number;
}

let readDelay = 0;

const last = <T,>(entries: T[], fromEnd = 1): T | undefined =>
  entries[entries.length - fromEnd];

let currentMode: ReadMode = { kind: "healthy", interval: "month" };
let restoreDom: (() => void) | null = null;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const respond = (path: string): Response => {
  const isCustomerState = path.includes("/api/auth/customer/state");

  if (currentMode.kind === "healthy") {
    if (isCustomerState) {
      return json(200, {
        activeSubscriptions: [{ recurringInterval: currentMode.interval }],
      });
    }
    return json(200, { plan: "pro" });
  }

  if (currentMode.kind === "free") {
    if (isCustomerState) {
      return json(200, { activeSubscriptions: [] });
    }
    return json(200, { plan: "free" });
  }

  if (currentMode.kind === "outage") {
    if (isCustomerState) {
      return json(500, { error: "polar unavailable" });
    }
    return json(200, { plan: currentMode.plan });
  }

  return json(500, { error: "down" });
};

const setupDom = () => {
  const { window } = parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  const injected = [
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
  const previous = Object.fromEntries(
    injected.map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
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
  (window as unknown as { __KEEPER_RUNTIME_CONFIG__: unknown }).__KEEPER_RUNTIME_CONFIG__ = {
    commercialMode: true,
  };
  restoreDom = () => {
    for (const key of injected) {
      if (previous[key] === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
        continue;
      }
      (globalThis as Record<string, unknown>)[key] = previous[key];
    }
  };
  return window;
};

const mountSubscription = async (options: {
  fallbackData?: SubscriptionState;
  consumers?: number;
  strict?: boolean;
}): Promise<Harness> => {
  const window = setupDom();
  const { act } = React;

  const consumers = options.consumers ?? 1;
  const renders: SubscriptionState[][] = [];
  const modes: UpgradeMode[] = [];
  const errors: unknown[] = [];
  let mutate: (() => Promise<unknown>) | null = null;
  const pending: (SubscriptionState | undefined)[] = [];
  let renderCount = 0;
  let startTransition: ((callback: () => void) => void) | null = null;

  function Consumer({ index }: { index: number }) {
    const result = useSubscription(
      index === 0 ? { fallbackData: options.fallbackData } : {},
    );
    const [, transition] = React.useTransition();

    React.useEffect(() => {
      renderCount += 1;
      pending[index] = result.data;
      if (index !== 0) {
        return;
      }
      startTransition = transition;
      mutate = result.mutate as unknown as () => Promise<unknown>;
      if (result.error) errors.push(result.error);
    });

    return null;
  }

  function Tree() {
    return React.createElement(
      React.Fragment,
      null,
      ...Array.from({ length: consumers }, (_unused, index) =>
        React.createElement(Consumer, { key: index, index }),
      ),
    );
  }

  const container = window.document.getElementById("root") as unknown as HTMLElement;
  const root = createRoot(container);
  const wrap = (children: React.ReactNode): React.ReactNode =>
    options.strict
      ? React.createElement(React.StrictMode, null, children)
      : children;

  const flush = () => {
    renders.push(
      pending.filter((entry): entry is SubscriptionState => entry !== undefined),
    );
    modes.push(resolveUpgradeMode(pending[0], true));
  };

  await act(async () => {
    root.render(
      wrap(
        React.createElement(
          SWRConfig,
          {
            value: {
              provider: () => new Map(),
              dedupingInterval: 0,
              revalidateOnFocus: false,
              revalidateOnReconnect: false,
              errorRetryCount: 0,
            },
          },
          React.createElement(Tree),
        ),
      ),
    );
  });
  flush();

  return {
    renders,
    modes,
    errors,
    customerStateReads: () =>
      (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(
        ([url]) => String(url).includes("/api/auth/customer/state"),
      ).length,
    renderCount: () => renderCount,
    refresh: async () => {
      await act(async () => {
        await mutate?.();
      });
      flush();
    },
    refreshInTransition: async () => {
      await act(async () => {
        startTransition?.(() => {
          void mutate?.();
        });
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      flush();
    },
    overlappingRefresh: async (delayFirst: number, secondMode?: ReadMode) => {
      await act(async () => {
        readDelay = delayFirst;
        const first = mutate?.();
        await Promise.resolve();
        readDelay = 0;
        if (secondMode) currentMode = secondMode;
        const second = mutate?.();
        await Promise.all([first, second]).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, delayFirst + 10));
      });
      flush();
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
};

beforeEach(() => {
  currentMode = { kind: "healthy", interval: "month" };
  readDelay = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const response = respond(String(input));
      const delay = readDelay;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return response;
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreDom?.();
  restoreDom = null;
});

describe("the live subscription hook while the customer state read flaps", () => {
  it("settles instead of re-rendering forever on the first paint", async () => {
    const harness = await mountSubscription({
      fallbackData: { plan: "pro", interval: "month" },
    });

    expect(last(harness.renders)).toEqual([{ plan: "pro", interval: "month" }]);
    harness.unmount();
  });

  it("never presents a paying customer as free while only the customer state is down", async () => {
    const harness = await mountSubscription({});
    currentMode = { kind: "outage", plan: "pro" };

    for (let cycle = 0; cycle < 4; cycle += 1) {
      await harness.refresh();
    }

    const plans = harness.renders
      .flat()
      .map((subscription) => subscription.plan);
    expect(plans.slice(1)).toEqual(["pro", "pro", "pro", "pro"]);
    harness.unmount();
  });

  it("holds the known billing interval steady across repeated flaps", async () => {
    const harness = await mountSubscription({});

    for (let cycle = 0; cycle < 3; cycle += 1) {
      currentMode = { kind: "outage", plan: "pro" };
      await harness.refresh();
      currentMode = { kind: "healthy", interval: "month" };
      await harness.refresh();
    }

    expect(new Set(harness.modes.slice(1))).toEqual(new Set(["switch-interval"]));
    harness.unmount();
  });

  it("adopts a newly reported interval and never reverts to the retired one", async () => {
    const harness = await mountSubscription({});

    currentMode = { kind: "healthy", interval: "year" };
    await harness.refresh();
    currentMode = { kind: "outage", plan: "pro" };
    await harness.refresh();
    await harness.refresh();

    expect(last(harness.renders)).toEqual([{ plan: "pro", interval: "year" }]);
    harness.unmount();
  });

  it("drops the retained interval once the subscription genuinely ends", async () => {
    const harness = await mountSubscription({});

    currentMode = { kind: "free" };
    await harness.refresh();
    currentMode = { kind: "outage", plan: "free" };
    await harness.refresh();
    await harness.refresh();

    expect(last(harness.renders)).toEqual([{ plan: "free", interval: null }]);
    harness.unmount();
  });

  it("keeps the last known plan and surfaces the error when both reads are down", async () => {
    const harness = await mountSubscription({});
    currentMode = { kind: "down" };

    await harness.refresh();

    expect(last(harness.renders)).toEqual([{ plan: "pro", interval: "month" }]);
    expect(harness.errors.length).toBeGreaterThan(0);
    harness.unmount();
  });

  it("agrees on the plan across every consumer sharing the cache", async () => {
    const harness = await mountSubscription({ consumers: 2 });
    currentMode = { kind: "outage", plan: "pro" };

    await harness.refresh();
    await harness.refresh();

    for (const snapshot of harness.renders.slice(1)) {
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0].plan).toBe(snapshot[1].plan);
    }
    harness.unmount();
  });

  it("settles under strict mode instead of looping on the retained state", async () => {
    const harness = await mountSubscription({ strict: true });
    const rendersAfterMount = harness.renderCount();

    currentMode = { kind: "outage", plan: "pro" };
    await harness.refresh();
    const rendersAfterOutage = harness.renderCount();
    await harness.refresh();

    expect(last(harness.renders)).toEqual([{ plan: "pro", interval: "month" }]);
    expect(rendersAfterOutage - rendersAfterMount).toBeLessThan(10);
    expect(harness.renderCount() - rendersAfterOutage).toBeLessThan(10);
    harness.unmount();
  });

  it("keeps the call to action stable when the checkout refresh runs inside a transition", async () => {
    const harness = await mountSubscription({});

    currentMode = { kind: "outage", plan: "pro" };
    await harness.refreshInTransition();
    await harness.refreshInTransition();

    expect(harness.modes.slice(1)).toEqual(["switch-interval", "switch-interval"]);
    harness.unmount();
  });

  it("converges after two revalidations resolve out of order", async () => {
    const harness = await mountSubscription({});

    currentMode = { kind: "healthy", interval: "year" };
    await harness.overlappingRefresh(20, { kind: "outage", plan: "pro" });
    const afterRace = last(harness.renders);

    await harness.refresh();
    await harness.refresh();

    expect(last(harness.renders)?.[0].plan).toBe("pro");
    expect(last(harness.renders)).toEqual(last(harness.renders, 2));
    expect(afterRace?.[0].plan).toBe("pro");
    harness.unmount();
  });

  it("does not re-read the customer state more than once per revalidation", async () => {
    const harness = await mountSubscription({ consumers: 2 });

    await harness.refresh();

    expect(harness.customerStateReads()).toBe(2);
    harness.unmount();
  });
});
