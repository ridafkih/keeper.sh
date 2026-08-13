import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HttpError } from "../../src/lib/fetcher";
import {
  fetchSubscriptionStateWithApi,
  resolveSubscriptionState,
} from "../../src/hooks/use-subscription";
import { resolveUpgradeMode, retainKnownInterval } from "../../src/lib/upgrade-mode";
import type { SubscriptionState } from "../../src/hooks/use-subscription";

const CUSTOMER_STATE_PATH = "/api/auth/customer/state";
const ENTITLEMENTS_PATH = "/api/entitlements";

const createApi = (respond: (path: string, callIndex: number) => unknown) => {
  const calls: string[] = [];
  const fetchApi = async <T,>(path: string): Promise<T> => {
    const callIndex = calls.length;
    calls.push(path);
    const result = respond(path, callIndex);
    if (result instanceof Error) throw result;
    return result as T;
  };
  return { calls, fetchApi };
};

const annualCustomerState = {
  activeSubscriptions: [{ recurringInterval: "year" }],
};

describe("realistic upstream payloads", () => {
  it("accepts a full Polar-shaped customer state without falling back", async () => {
    const { calls, fetchApi } = createApi(() => ({
      id: "cus_01HZ",
      email: "paying@example.com",
      name: "Paying User",
      externalId: "user_123",
      taxId: null,
      billingAddress: { country: "CA", postalCode: "M5V 2T6" },
      grantedBenefits: [{ id: "ben_1", benefitType: "custom" }],
      activeMeters: [],
      activeSubscriptions: [
        {
          id: "sub_01HZ",
          status: "active",
          productId: "prod_pro_year",
          recurringInterval: "year",
          currentPeriodStart: "2026-01-01T00:00:00Z",
          currentPeriodEnd: "2027-01-01T00:00:00Z",
          cancelAtPeriodEnd: false,
          amount: 9900,
          currency: "usd",
        },
      ],
    }));

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: "year",
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("accepts a full Polar-shaped entitlements body in the fallback", async () => {
    const { fetchApi } = createApi((path) => {
      if (path === CUSTOMER_STATE_PATH) return new HttpError(500, path);
      return {
        plan: "pro",
        accounts: { current: 3, limit: null },
        mappings: { current: 7, limit: null },
        canCustomizeIcalFeed: true,
        canUseEventFilters: true,
      };
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
  });
});

describe("upgrade call to action convergence while the read flaps", () => {
  const runFlap = async (
    yearlySelected: boolean,
    runs: number,
    customerState: unknown = annualCustomerState,
    status = 500,
  ): Promise<string[]> => {
    const modes: string[] = [];
    let settled: SubscriptionState | undefined;

    for (let run = 0; run < runs; run += 1) {
      const failing = run % 2 === 1;
      const { fetchApi } = createApi((path) => {
        if (path === CUSTOMER_STATE_PATH) {
          return failing ? new HttpError(status, path) : customerState;
        }
        return { plan: "pro" };
      });
      settled = retainKnownInterval(
        settled,
        await fetchSubscriptionStateWithApi(fetchApi),
      );
      modes.push(resolveUpgradeMode(settled, yearlySelected));
    }

    return modes;
  };

  it("keeps a stable call to action for an annual subscriber with the annual toggle on", async () => {
    expect(await runFlap(true, 6)).toEqual(Array(6).fill("manage"));
  });

  it("keeps a stable call to action for an annual subscriber with the default monthly toggle", async () => {
    expect(await runFlap(false, 6)).toEqual(Array(6).fill("switch-interval"));
  });

  it("keeps a stable call to action for a monthly subscriber with the annual toggle on", async () => {
    const modes = await runFlap(
      true,
      6,
      { activeSubscriptions: [{ recurringInterval: "month" }] },
      503,
    );
    expect(modes).toEqual(Array(6).fill("switch-interval"));
  });

  it("never offers a plain upgrade to a paying user at any point in the flap", async () => {
    const modes = [...(await runFlap(false, 6)), ...(await runFlap(true, 6))];
    expect(modes).not.toContain("upgrade");
  });

  it("manages rather than guessing an interval when the very first read already fails", async () => {
    const { calls, fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? new HttpError(500, path) : { plan: "pro" },
    );
    const settled = retainKnownInterval(
      undefined,
      await fetchSubscriptionStateWithApi(fetchApi),
    );

    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
    expect(settled).toEqual({ plan: "pro", interval: null });
    expect(resolveUpgradeMode(settled, true)).toBe("manage");
    expect(resolveUpgradeMode(settled, false)).toBe("manage");
  });

  it("drops the retained interval once the plan itself changes", () => {
    expect(
      retainKnownInterval({ plan: "pro", interval: "year" }, { plan: "free", interval: null }),
    ).toEqual({ plan: "free", interval: null });
  });

  it("prefers a freshly reported interval over the retained one", () => {
    expect(
      retainKnownInterval({ plan: "pro", interval: "year" }, { plan: "pro", interval: "month" }),
    ).toEqual({ plan: "pro", interval: "month" });
  });
});

describe("interval reported for a subscription whose recurrence is absent", () => {
  it("does not claim a monthly interval the upstream never reported", () => {
    expect(
      resolveSubscriptionState({ activeSubscriptions: [{ recurringInterval: null }] }),
    ).toEqual({ plan: "pro", interval: null });
  });

  it("does not offer an interval switch on an unreported recurrence", () => {
    const state = resolveSubscriptionState({
      activeSubscriptions: [{ recurringInterval: null }],
    });
    expect(resolveUpgradeMode(state, true)).toBe("manage");
  });
});

describe("repeated recovery cycles", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("converges on the authoritative state after an outage and stays converged", async () => {
    const results = [];
    for (let run = 0; run < 4; run += 1) {
      const failing = run < 2;
      const { fetchApi } = createApi((path) => {
        if (path === CUSTOMER_STATE_PATH && failing) return new HttpError(429, path);
        if (path === CUSTOMER_STATE_PATH) return annualCustomerState;
        return { plan: "pro" };
      });
      results.push(await fetchSubscriptionStateWithApi(fetchApi));
    }
    expect(results.slice(2)).toEqual([
      { plan: "pro", interval: "year" },
      { plan: "pro", interval: "year" },
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("does not accumulate hidden state between independent runs", async () => {
    const first = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? new HttpError(500, path) : { plan: "pro" },
    );
    await fetchSubscriptionStateWithApi(first.fetchApi);

    const second = createApi(() => ({ activeSubscriptions: [] }));
    await expect(fetchSubscriptionStateWithApi(second.fetchApi)).resolves.toEqual({
      plan: "free",
      interval: null,
    });
    expect(second.calls).toEqual([CUSTOMER_STATE_PATH]);
  });
});

describe("both reads failing", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("rejects rather than resolving to free when both endpoints are down", async () => {
    const { fetchApi } = createApi((path) => new HttpError(500, path));
    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toBeInstanceOf(HttpError);
  });

  it("surfaces the fallback failure, not a silent free plan, on a timeout", async () => {
    const { fetchApi } = createApi(() => new Error("network timeout"));
    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toThrow("network timeout");
  });
});
