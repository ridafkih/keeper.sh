import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/lib/fetcher";
import { fetchSubscriptionStateWithApi } from "../../src/hooks/use-subscription";

const CUSTOMER_STATE_PATH = "/api/auth/customer/state";
const ENTITLEMENTS_PATH = "/api/entitlements";

const PLANS = ["free", "pro"];

const createRecordingApi = (respond: (path: string, call: number) => unknown) => {
  const calls: string[] = [];
  const fetchApi = async <T,>(path: string): Promise<T> => {
    calls.push(path);
    return respond(path, calls.filter((entry) => entry === path).length) as T;
  };
  return { calls, fetchApi };
};

describe("subscription fallback payload validation", () => {
  it("never resolves to a plan outside the known set when the fallback omits it", async () => {
    const { fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new HttpError(500, path);
      return {};
    });

    const state = await fetchSubscriptionStateWithApi(fetchApi).catch((error: unknown) => error);

    if (state instanceof Error) return;
    expect(PLANS).toContain((state as { plan: unknown }).plan);
  });

  it("never resolves to a plan outside the known set when the fallback returns an unknown plan", async () => {
    const { fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new HttpError(503, path);
      return { plan: "enterprise" };
    });

    const state = await fetchSubscriptionStateWithApi(fetchApi).catch((error: unknown) => error);

    if (state instanceof Error) return;
    expect(PLANS).toContain((state as { plan: unknown }).plan);
  });

  it("fails with a domain error rather than a property read on a null fallback body", async () => {
    const { fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new HttpError(500, path);
      return null;
    });

    const error = await fetchSubscriptionStateWithApi(fetchApi).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
  });
});

describe("subscription fallback auth propagation", () => {
  it("propagates a 401 raised by the fallback so login redirects still fire", async () => {
    const { calls, fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new HttpError(500, path);
      throw new HttpError(401, path);
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toMatchObject({
      status: 401,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("does not reach the fallback when the customer state is unauthorized", async () => {
    const { calls, fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new HttpError(401, path);
      return { plan: "pro" };
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toMatchObject({
      status: 401,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("falls back for a network failure that is not an HttpError", async () => {
    const { calls, fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new TypeError("Failed to fetch");
      return { plan: "pro" };
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });
});

describe("subscription fallback convergence", () => {
  it("keeps a paying user on pro across repeated flapping reads", async () => {
    let attempt = 0;
    const fetchApi = async <T,>(path: string): Promise<T> => {
      if (path === CUSTOMER_STATE_PATH) {
        attempt += 1;
        if (attempt % 2 === 1) throw new HttpError(500, path);
        return { activeSubscriptions: [{ recurringInterval: "year" }] } as T;
      }
      return { plan: "pro" } as T;
    };

    const results = [];
    for (let index = 0; index < 6; index += 1) {
      results.push(await fetchSubscriptionStateWithApi(fetchApi));
    }

    expect(results.map((result) => result.plan)).toEqual([
      "pro",
      "pro",
      "pro",
      "pro",
      "pro",
      "pro",
    ]);
  });

  it("issues the same request sequence on every repeated failing run", async () => {
    const { calls, fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new HttpError(500, path);
      return { plan: "pro" };
    });

    await fetchSubscriptionStateWithApi(fetchApi);
    await fetchSubscriptionStateWithApi(fetchApi);
    await fetchSubscriptionStateWithApi(fetchApi);

    expect(calls).toEqual([
      CUSTOMER_STATE_PATH,
      ENTITLEMENTS_PATH,
      CUSTOMER_STATE_PATH,
      ENTITLEMENTS_PATH,
      CUSTOMER_STATE_PATH,
      ENTITLEMENTS_PATH,
    ]);
  });

  it("resolves concurrent callers independently without cross-talk", async () => {
    const { calls, fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) throw new HttpError(500, path);
      return { plan: "pro" };
    });

    const states = await Promise.all([
      fetchSubscriptionStateWithApi(fetchApi),
      fetchSubscriptionStateWithApi(fetchApi),
    ]);

    expect(states).toEqual([
      { plan: "pro", interval: null },
      { plan: "pro", interval: null },
    ]);
    expect(calls.filter((path) => path === ENTITLEMENTS_PATH)).toHaveLength(2);
  });
});

describe("subscription state resolution edges", () => {
  it("treats an empty active subscription list as free without falling back", async () => {
    const { calls, fetchApi } = createRecordingApi(() => ({ activeSubscriptions: [] }));

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "free",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("treats a null active subscription list as free without falling back", async () => {
    const { calls, fetchApi } = createRecordingApi(() => ({ activeSubscriptions: null }));

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "free",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("does not silently downgrade a paying user when the customer state body is unusable", async () => {
    const { fetchApi } = createRecordingApi((path) => {
      if (path === CUSTOMER_STATE_PATH) return null;
      return { plan: "pro" };
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
  });
});
