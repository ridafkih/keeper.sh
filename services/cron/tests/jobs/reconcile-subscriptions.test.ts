import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { runReconcileSubscriptionsJob } from "../../src/jobs/reconcile-subscriptions";

describe("runReconcileSubscriptionsJob", () => {
  it("skips processing when Polar client is unavailable", async () => {
    const reconciledUserIds: string[] = [];

    await runReconcileSubscriptionsJob({
      hasBillingClient: false,
      reconcileUserSubscription: (userId) => {
        reconciledUserIds.push(userId);
        return Promise.resolve();
      },
      selectUserIds: () => Promise.resolve(["user-1", "user-2"]),
    });

    expect(reconciledUserIds).toEqual([]);
  });

  it("tracks failed reconciliations without stopping the full cycle", async () => {
    const reconciledUserIds: string[] = [];

    await runReconcileSubscriptionsJob({
      hasBillingClient: true,
      reconcileUserSubscription: (userId) => {
        reconciledUserIds.push(userId);
        if (userId === "user-2") {
          return Promise.reject(new Error("reconciliation failed"));
        }
        return Promise.resolve();
      },
      selectUserIds: () => Promise.resolve(["user-1", "user-2", "user-3"]),
    });

    expect(reconciledUserIds).toEqual(["user-1", "user-2", "user-3"]);
  });

  it("completes without error when multiple users fail reconciliation", async () => {
    await runReconcileSubscriptionsJob({
      hasBillingClient: true,
      reconcileUserSubscription: () => Promise.reject(new Error("reconcile failed")),
      selectUserIds: () => Promise.resolve(["user-1", "user-2"]),
    });
  });

  it("completes without error when there are no users to reconcile", async () => {
    const reconciledUserIds: string[] = [];

    await runReconcileSubscriptionsJob({
      hasBillingClient: true,
      reconcileUserSubscription: (userId) => {
        reconciledUserIds.push(userId);
        return Promise.resolve();
      },
      selectUserIds: () => Promise.resolve([]),
    });

    expect(reconciledUserIds).toEqual([]);
  });

  describe("timeout handling", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("handles timed out reconciliation operations gracefully", async () => {
      const reconciledUserIds: string[] = [];

      const promise = runReconcileSubscriptionsJob({
        hasBillingClient: true,
        reconcileUserSubscription: (userId) => {
          reconciledUserIds.push(userId);
          if (userId === "user-2") {
            return Bun.sleep(10_000);
          }
          return Promise.resolve();
        },
        reconcileUserTimeoutMs: 1,
        selectUserIds: () => Promise.resolve(["user-1", "user-2"]),
      });

      for (let tick = 0; tick < 10; tick++) {
        await Promise.resolve();
      }

      jest.advanceTimersByTime(10_000);

      await promise;

      expect(reconciledUserIds).toEqual(["user-1", "user-2"]);
    });
  });
});
