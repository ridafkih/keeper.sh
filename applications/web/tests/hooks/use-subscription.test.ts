import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/lib/fetcher";
import { fetchSubscriptionStateWithApi } from "../../src/hooks/use-subscription";

const CUSTOMER_STATE_PATH = "/api/auth/customer/state";
const ENTITLEMENTS_PATH = "/api/entitlements";

const createFetchApi = (respond: (path: string) => unknown) => {
  const calls: string[] = [];
  const fetchApi = async <T,>(path: string): Promise<T> => {
    calls.push(path);
    return respond(path) as T;
  };
  return { calls, fetchApi };
};

describe("fetchSubscriptionStateWithApi", () => {
  it("reads the plan and interval from the customer state", async () => {
    const { fetchApi } = createFetchApi(() => ({
      activeSubscriptions: [{ recurringInterval: "year" }],
    }));

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: "year",
    });
  });

  it("keeps a paying user on pro when the customer state fails", async () => {
    const { calls, fetchApi } = createFetchApi((path) => {
      if (path === CUSTOMER_STATE_PATH) {
        throw new HttpError(500, CUSTOMER_STATE_PATH);
      }
      return { plan: "pro" };
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "pro",
      interval: null,
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("reports free when the fallback says the user is not subscribed", async () => {
    const { fetchApi } = createFetchApi((path) => {
      if (path === CUSTOMER_STATE_PATH) {
        throw new HttpError(502, CUSTOMER_STATE_PATH);
      }
      return { plan: "free" };
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).resolves.toEqual({
      plan: "free",
      interval: null,
    });
  });

  it("propagates unauthorized responses instead of falling back", async () => {
    const { calls, fetchApi } = createFetchApi((path) => {
      if (path === CUSTOMER_STATE_PATH) {
        throw new HttpError(401, CUSTOMER_STATE_PATH);
      }
      return { plan: "pro" };
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toBeInstanceOf(HttpError);
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("surfaces the failure when the fallback is unusable", async () => {
    const { fetchApi } = createFetchApi((path) => {
      throw new HttpError(500, path);
    });

    await expect(fetchSubscriptionStateWithApi(fetchApi)).rejects.toBeInstanceOf(HttpError);
  });
});
