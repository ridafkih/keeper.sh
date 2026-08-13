import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { SWRConfig } from "swr";
import { isRedirect } from "@tanstack/react-router";
import { HttpError } from "../../src/lib/fetcher";
import { resolveUpgradeMode, retainKnownInterval } from "../../src/lib/upgrade-mode";
import {
  fetchSubscriptionStateWithApi,
  useSubscription,
} from "../../src/hooks/use-subscription";
import type { SubscriptionState } from "../../src/hooks/use-subscription";
import { Route as UpgradeRoute } from "../../src/routes/(dashboard)/dashboard/upgrade/index";

const upgradeLoader = (
  UpgradeRoute as unknown as {
    options: { loader: (args: unknown) => Promise<unknown> };
  }
).options.loader;

const CUSTOMER_STATE_PATH = "/api/auth/customer/state";

const createApi = (respond: (path: string) => unknown) => {
  const fetchApi = async <T,>(path: string): Promise<T> => {
    const result = respond(path);
    if (result instanceof Error) throw result;
    return result as T;
  };
  return fetchApi;
};

const runUpgradeLoader = async (respond: (path: string) => unknown) => {
  return upgradeLoader({
    context: {
      auth: { hasSession: () => true },
      fetchApi: createApi(respond),
      runtimeConfig: { commercialMode: true },
    },
  });
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("what the upgrade loader can hand the page as a retained interval", () => {
  const customerStates = [
    { activeSubscriptions: [] },
    { activeSubscriptions: null },
    { activeSubscriptions: [{ recurringInterval: "month" }] },
    { activeSubscriptions: [{ recurringInterval: "year" }] },
    { activeSubscriptions: [{ recurringInterval: null }] },
    { activeSubscriptions: [{}] },
  ];

  it("only ever reaches the page with an unknown interval, so it can never retain one", async () => {
    const rendered: SubscriptionState[] = [];

    for (const customerState of customerStates) {
      let result: unknown;
      try {
        result = await runUpgradeLoader(() => customerState);
      } catch (thrown) {
        expect(isRedirect(thrown)).toBe(true);
        continue;
      }
      rendered.push((result as { subscription: SubscriptionState }).subscription);
    }

    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.map((state) => state.interval)).toEqual(
      rendered.map(() => null),
    );
    expect(
      rendered.map((state) =>
        retainKnownInterval(state, { plan: "pro", interval: null }),
      ),
    ).toEqual(rendered.map(() => ({ plan: "pro", interval: null })));
  });
});

describe("upgrade call to action while the customer state flaps after an in-page checkout", () => {
  const mountUpgradeCallToAction = async (loaderSubscription: SubscriptionState) => {
    const { document, window } = parseHTML(
      "<html><body><div id='app'></div></body></html>",
    );
    const previousGlobals = {
      Event: globalThis.Event,
      HTMLElement: globalThis.HTMLElement,
      Node: globalThis.Node,
      document: globalThis.document,
      window: globalThis.window,
    };

    Object.assign(globalThis, {
      Event: window.Event,
      HTMLElement: window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      Node: window.Node,
      document,
      window,
    });

    const container = document.getElementById("app");
    if (!(container instanceof globalThis.HTMLElement)) {
      throw new Error("Expected an app container to render into.");
    }

    const modes: string[] = [];
    const captured: { revalidate?: () => Promise<unknown> } = {};

    const CallToAction = () => {
      const { data, mutate } = useSubscription({
        enabled: true,
        fallbackData: loaderSubscription,
      });
      const mode = resolveUpgradeMode(data, true);

      useEffect(() => {
        captured.revalidate = mutate;
        modes.push(mode);
      });

      return null;
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          SWRConfig,
          { value: { provider: () => new Map(), dedupingInterval: 0 } },
          createElement(CallToAction),
        ),
      );
    });

    return {
      modes,
      read: async () => {
        const trigger = captured.revalidate;
        if (!trigger) throw new Error("Expected the hook to expose a revalidation.");
        await act(async () => {
          await trigger();
        });
      },
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        Object.assign(globalThis, previousGlobals);
      },
    };
  };

  const stubFlappingCustomerState = () => {
    let read = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = typeof input === "string" ? input : input.toString();
        if (path === CUSTOMER_STATE_PATH) {
          const failing = read % 2 === 1;
          read += 1;
          return failing
            ? jsonResponse(500, { error: "upstream" })
            : jsonResponse(200, {
                activeSubscriptions: [{ recurringInterval: "month" }],
              });
        }
        return jsonResponse(200, { plan: "pro" });
      }),
    );
  };

  it("does not alternate between managing and switching while the read flaps", async () => {
    stubFlappingCustomerState();

    const loaderSubscription = (
      (await runUpgradeLoader(() => ({ activeSubscriptions: [] }))) as {
        subscription: SubscriptionState;
      }
    ).subscription;

    const page = await mountUpgradeCallToAction(loaderSubscription);
    try {
      for (let run = 0; run < 5; run += 1) {
        await page.read();
      }

      const settled = page.modes.slice(page.modes.indexOf("switch-interval"));
      expect(settled.length).toBeGreaterThanOrEqual(6);
      expect(settled).toEqual(Array(settled.length).fill("switch-interval"));
    } finally {
      await page.unmount();
    }
  });

  it("would hold steady if the previously rendered state were carried instead of the loader one", async () => {
    const readPlan = async (failing: boolean): Promise<SubscriptionState> => {
      return fetchSubscriptionStateWithApi(
        createApi((path) => {
          if (path === CUSTOMER_STATE_PATH) {
            return failing
              ? new HttpError(500, path)
              : { activeSubscriptions: [{ recurringInterval: "month" }] };
          }
          return { plan: "pro" };
        }),
      );
    };

    const modes: string[] = [];
    let rendered: SubscriptionState | undefined;

    for (let run = 0; run < 6; run += 1) {
      rendered = retainKnownInterval(rendered, await readPlan(run % 2 === 1));
      modes.push(resolveUpgradeMode(rendered, true));
    }

    expect(modes).toEqual(Array(6).fill(modes[0]));
  });
});
