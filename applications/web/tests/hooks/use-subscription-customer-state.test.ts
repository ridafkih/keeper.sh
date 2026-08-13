import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HttpError } from "../../src/lib/fetcher";
import { fetchSubscriptionStateWithApi } from "../../src/hooks/use-subscription";
import { resolveUpgradeMode } from "../../src/lib/upgrade-mode";

const CUSTOMER_STATE_PATH = "/api/auth/customer/state";
const ENTITLEMENTS_PATH = "/api/entitlements";

const PAYING_USER_ENTITLEMENTS = { plan: "pro" };

const createApi = (respond: (path: string) => unknown) => {
  const calls: string[] = [];
  const fetchApi = async <T,>(path: string): Promise<T> => {
    calls.push(path);
    const result = respond(path);
    if (result instanceof Error) throw result;
    return result as T;
  };
  return { calls, fetchApi };
};

const payingUserWithCustomerStateBody = (body: unknown) =>
  createApi((path) => (path === CUSTOMER_STATE_PATH ? body : PAYING_USER_ENTITLEMENTS));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("customer state bodies that carry no subscription information", () => {
  it("does not report a paying user as free when the customer state is a 200 error envelope", async () => {
    const { calls, fetchApi } = payingUserWithCustomerStateBody({
      error: "rate_limited",
      message: "Polar is rate limiting this organization",
    });

    const state = await fetchSubscriptionStateWithApi(fetchApi);

    expect(calls).toContain(ENTITLEMENTS_PATH);
    expect(state.plan).toBe("pro");
  });

  it("does not report a paying user as free when the customer state body is an empty object", async () => {
    const { calls, fetchApi } = payingUserWithCustomerStateBody({});

    const state = await fetchSubscriptionStateWithApi(fetchApi);

    expect(calls).toContain(ENTITLEMENTS_PATH);
    expect(state.plan).toBe("pro");
  });

  it("does not report a paying user as free when the customer state body is an array", async () => {
    const { calls, fetchApi } = payingUserWithCustomerStateBody([]);

    const state = await fetchSubscriptionStateWithApi(fetchApi);

    expect(calls).toContain(ENTITLEMENTS_PATH);
    expect(state.plan).toBe("pro");
  });

  it("does not report a paying user as free when the customer state body is a populated array", async () => {
    const { calls, fetchApi } = payingUserWithCustomerStateBody([
      { detail: "service unavailable" },
    ]);

    const state = await fetchSubscriptionStateWithApi(fetchApi);

    expect(calls).toContain(ENTITLEMENTS_PATH);
    expect(state.plan).toBe("pro");
  });

  it("still trusts an explicit empty active subscription list as a genuine free plan", async () => {
    const { calls, fetchApi } = payingUserWithCustomerStateBody({ activeSubscriptions: [] });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "free",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("still trusts an explicit null active subscription list as a genuine free plan", async () => {
    const { calls, fetchApi } = payingUserWithCustomerStateBody({ activeSubscriptions: null });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "free",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });
});

describe("customer state failure status boundaries", () => {
  const fallbackStatuses = [400, 402, 403, 404, 408, 409, 418, 429, 500, 502, 503, 504];

  for (const status of fallbackStatuses) {
    it(`falls back to entitlements on ${status}`, async () => {
      const { calls, fetchApi } = createApi((path) =>
        path === CUSTOMER_STATE_PATH ? new HttpError(status, path) : PAYING_USER_ENTITLEMENTS,
      );

      await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
        plan: "pro",
        interval: null,
      });
      expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
    });
  }

  it("short-circuits on exactly 401 and never touches the fallback", async () => {
    const { calls, fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH
        ? new HttpError(401, path)
        : PAYING_USER_ENTITLEMENTS,
    );

    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toBeInstanceOf(HttpError);
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("does not treat a plain error carrying a status field as unauthorized", async () => {
    const impostor = Object.assign(new Error("unauthorized"), { status: 401 });
    const { calls, fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? impostor : PAYING_USER_ENTITLEMENTS,
    );

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });
});

describe("errors arriving wrapped inside other errors", () => {
  it("still ends in a 401 rejection when the customer state 401 is wrapped as a cause", async () => {
    const wrapped = new Error("request failed", { cause: new HttpError(401, CUSTOMER_STATE_PATH) });
    const { calls, fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? wrapped : new HttpError(401, path),
    );

    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("propagates a non-Error rejection from the customer state into the fallback", async () => {
    const calls: string[] = [];
    const fetchApi = async <T,>(path: string): Promise<T> => {
      calls.push(path);
      if (path === CUSTOMER_STATE_PATH) throw "boom";
      return PAYING_USER_ENTITLEMENTS as T;
    };

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });
});

describe("outage visibility", () => {
  it("reports the swallowed customer state failure somewhere observable", async () => {
    const reported: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      reported.push(args);
    });
    const { fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH
        ? new HttpError(500, path)
        : PAYING_USER_ENTITLEMENTS,
    );

    await fetchSubscriptionStateWithApi(fetchApi);

    expect(reported).toHaveLength(1);
  });

  it("does not log when the customer state read succeeds", async () => {
    const reported: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      reported.push(args);
    });
    const { fetchApi } = createApi(() => ({
      activeSubscriptions: [{ recurringInterval: "month" }],
    }));

    await fetchSubscriptionStateWithApi(fetchApi);

    expect(reported).toHaveLength(0);
  });
});

describe("repeated runs converge", () => {
  it("produces an identical state on every run while the outage persists", async () => {
    const { fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH
        ? new HttpError(500, path)
        : PAYING_USER_ENTITLEMENTS,
    );

    const runs = [];
    for (let index = 0; index < 5; index += 1) {
      runs.push(await fetchSubscriptionStateWithApi(fetchApi));
    }

    expect(new Set(runs.map((run) => JSON.stringify(run))).size).toBe(1);
  });

  it("returns to the full customer state once the outage clears and stays there", async () => {
    let healthy = false;
    const fetchApi = async <T,>(path: string): Promise<T> => {
      if (path === CUSTOMER_STATE_PATH) {
        if (!healthy) throw new HttpError(500, path);
        return { activeSubscriptions: [{ recurringInterval: "year" }] } as T;
      }
      return PAYING_USER_ENTITLEMENTS as T;
    };

    expect(await fetchSubscriptionStateWithApi(fetchApi)).toEqual({
      plan: "pro",
      interval: null,
    });

    healthy = true;
    const settled = [
      await fetchSubscriptionStateWithApi(fetchApi),
      await fetchSubscriptionStateWithApi(fetchApi),
    ];

    expect(settled).toEqual([
      { plan: "pro", interval: "year" },
      { plan: "pro", interval: "year" },
    ]);
  });

  it("reports the billing interval of a paying annual user as unknown, never as wrong, while the read flaps", async () => {
    let attempt = 0;
    const fetchApi = async <T,>(path: string): Promise<T> => {
      if (path === CUSTOMER_STATE_PATH) {
        attempt += 1;
        if (attempt % 2 === 1) throw new HttpError(429, path);
        return { activeSubscriptions: [{ recurringInterval: "year" }] } as T;
      }
      return PAYING_USER_ENTITLEMENTS as T;
    };

    const intervals: (string | null)[] = [];
    for (let index = 0; index < 6; index += 1) {
      const state = await fetchSubscriptionStateWithApi(fetchApi);
      expect(state.plan).toBe("pro");
      intervals.push(state.interval);
    }

    expect(intervals).toEqual([null, "year", null, "year", null, "year"]);
    expect(intervals.every((interval) => interval === null || interval === "year")).toBe(true);
    expect(resolveUpgradeMode({ plan: "pro", interval: null }, true)).toBe("manage");
    expect(resolveUpgradeMode({ plan: "pro", interval: "year" }, true)).toBe("manage");
  });
});

describe("interval resolution edges", () => {
  it("reports a subscription with no recurring interval as pro on an unknown interval", async () => {
    const { fetchApi } = createApi(() => ({ activeSubscriptions: [{}] }));

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
  });

  it("uses the first active subscription when several are present", async () => {
    const { fetchApi } = createApi(() => ({
      activeSubscriptions: [{ recurringInterval: "year" }, { recurringInterval: "month" }],
    }));

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: "year",
    });
  });

  it("falls back rather than accepting an unknown recurring interval", async () => {
    const { calls, fetchApi } = payingUserWithCustomerStateBody({
      activeSubscriptions: [{ recurringInterval: "quarter" }],
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });
});
