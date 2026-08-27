import { describe, expect, it, vi } from "vitest";
import { runWithCredentialRefreshLock } from "../../../src/core/oauth/refresh-coordinator";

const FIRST_CALLER_ACQUIRE_BUDGET_MS = 3000;
const JOINING_CALLER_ACQUIRE_BUDGET_MS = 200;

const alwaysHeldLockStore = {
  release: (): Promise<void> => Promise.resolve(),
  tryAcquire: (): Promise<boolean> => Promise.resolve(false),
};

const noAdoptablePeerCredential = (): Promise<null> => Promise.resolve(null);

describe("coalesced refresh joiner", () => {
  it("rejects inside its own acquire budget instead of inheriting the first caller's", async () => {
    const credentialId = `credential-${crypto.randomUUID()}`;
    const runRefresh = vi.fn(
      () => new Promise<{ access_token: string; expires_in: number }>(() => {}),
    );

    const firstCaller = runWithCredentialRefreshLock(
      credentialId,
      runRefresh,
      alwaysHeldLockStore,
      noAdoptablePeerCredential,
      FIRST_CALLER_ACQUIRE_BUDGET_MS,
    );
    const firstCallerOutcome = firstCaller.then(
      () => "resolved",
      (error: unknown) => error,
    );

    const startedAt = Date.now();
    const joiningCaller = runWithCredentialRefreshLock(
      credentialId,
      runRefresh,
      alwaysHeldLockStore,
      noAdoptablePeerCredential,
      JOINING_CALLER_ACQUIRE_BUDGET_MS,
    );

    await expect(joiningCaller).rejects.toThrow(
      /already in progress/,
    );
    expect(Date.now() - startedAt).toBeLessThan(1000);

    await expect(firstCallerOutcome).resolves.toBeInstanceOf(Error);
    expect(runRefresh).not.toHaveBeenCalled();
  }, 15_000);
});
