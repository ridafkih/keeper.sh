import { describe, expect, it, vi } from "vitest";
import { syncPolarSubscription } from "../../src/utils/polar-subscription-sync";

const makeDependencies = (activeSubscriptionIds: string[]) => ({
  fetchActiveSubscriptionIds: vi.fn((_externalCustomerId: string) =>
    Promise.resolve(activeSubscriptionIds)),
  observe: vi.fn(),
  upsertSubscription: vi.fn(
    (_userId: string, _plan: "free" | "pro", _polarSubscriptionId: string) => Promise.resolve(),
  ),
});

describe("syncPolarSubscription", () => {
  it("keeps pro when a cancellation still has an active period", async () => {
    const dependencies = makeDependencies(["sub-1"]);

    const result = await syncPolarSubscription(
      { externalCustomerId: "user-1", subscriptionId: "sub-1", type: "subscription.canceled" },
      dependencies,
    );

    expect(result).toEqual({ plan: "pro", polarSubscriptionId: "sub-1" });
    expect(dependencies.upsertSubscription).toHaveBeenCalledWith("user-1", "pro", "sub-1");
  });

  it("downgrades once the customer has no active subscription", async () => {
    const dependencies = makeDependencies([]);

    const result = await syncPolarSubscription(
      { externalCustomerId: "user-1", subscriptionId: "sub-1", type: "subscription.revoked" },
      dependencies,
    );

    expect(result).toEqual({ plan: "free", polarSubscriptionId: "sub-1" });
    expect(dependencies.upsertSubscription).toHaveBeenCalledWith("user-1", "free", "sub-1");
  });

  it("ignores a stale event for another subscription while one is active", async () => {
    const dependencies = makeDependencies(["sub-current"]);

    const result = await syncPolarSubscription(
      { externalCustomerId: "user-1", subscriptionId: "sub-old", type: "subscription.updated" },
      dependencies,
    );

    expect(result).toEqual({ plan: "pro", polarSubscriptionId: "sub-current" });
    expect(dependencies.upsertSubscription).toHaveBeenCalledWith("user-1", "pro", "sub-current");
  });

  it("reads the customer state rather than the delivered status", async () => {
    const dependencies = makeDependencies(["sub-1"]);

    await syncPolarSubscription(
      { externalCustomerId: "user-1", subscriptionId: "sub-1", type: "subscription.updated" },
      dependencies,
    );

    expect(dependencies.fetchActiveSubscriptionIds).toHaveBeenCalledWith("user-1");
  });

  it("does nothing without an external customer id", async () => {
    const dependencies = makeDependencies(["sub-1"]);

    const result = await syncPolarSubscription(
      { externalCustomerId: null, subscriptionId: "sub-1", type: "subscription.created" },
      dependencies,
    );

    expect(result).toBeNull();
    expect(dependencies.fetchActiveSubscriptionIds).not.toHaveBeenCalled();
    expect(dependencies.upsertSubscription).not.toHaveBeenCalled();
  });

  it("does nothing for events outside the subscription lifecycle", async () => {
    const dependencies = makeDependencies(["sub-1"]);

    const result = await syncPolarSubscription(
      { externalCustomerId: "user-1", subscriptionId: "order-1", type: "order.paid" },
      dependencies,
    );

    expect(result).toBeNull();
    expect(dependencies.upsertSubscription).not.toHaveBeenCalled();
  });

  it("propagates a customer state failure so Polar retries the delivery", async () => {
    const dependencies = {
      ...makeDependencies([]),
      fetchActiveSubscriptionIds: vi.fn(() => Promise.reject(new Error("polar unavailable"))),
    };

    await expect(syncPolarSubscription(
      { externalCustomerId: "user-1", subscriptionId: "sub-1", type: "subscription.updated" },
      dependencies,
    )).rejects.toThrow("polar unavailable");
    expect(dependencies.upsertSubscription).not.toHaveBeenCalled();
  });
});
