import { describe, expect, it, vi } from "vitest";
import {
  ACQUIRE_BUDGET_MS,
  runWithCredentialRefreshLock,
} from "../../../src/core/oauth/refresh-coordinator";

/*
 * An interactive request path cannot inherit the worker's 45s wait: Bun.serve drops the
 * socket at 30s. The budget has to be the caller's to choose, with the worker default intact.
 */

const INTERACTIVE_ACQUIRE_BUDGET_MS = 50;

const alwaysHeldLockStore = {
  release: (): Promise<void> => Promise.resolve(),
  tryAcquire: (): Promise<boolean> => Promise.resolve(false),
};

describe("refresh lock acquire budget", () => {
  it("rejects inside the caller's budget when a peer holds the lock and nothing is adoptable", async () => {
    const runRefresh = vi.fn(() =>
      Promise.resolve({ access_token: "own-token", expires_in: 3600 }),
    );

    const startedAt = Date.now();
    await expect(
      runWithCredentialRefreshLock(
        `credential-${crypto.randomUUID()}`,
        runRefresh,
        alwaysHeldLockStore,
        () => Promise.resolve(null),
        INTERACTIVE_ACQUIRE_BUDGET_MS,
      ),
    ).rejects.toThrow("Token refresh already in progress on another instance");

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(runRefresh).not.toHaveBeenCalled();
  }, 2000);

  it("keeps the worker default when no budget is passed", () => {
    expect(ACQUIRE_BUDGET_MS).toBe(45_000);
  });
});
