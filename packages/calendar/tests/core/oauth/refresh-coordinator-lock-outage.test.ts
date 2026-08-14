import { describe, expect, it } from "vitest";
import {
  isOAuthReauthRequiredError,
  isOAuthRefreshInProgressError,
  isOAuthRefreshLockUnavailableError,
} from "../../../src/core/oauth/error-classification";
import { runWithCredentialRefreshLock } from "../../../src/core/oauth/refresh-coordinator";

const createFailingLockStore = (failure: Error) => ({
  release: () => Promise.resolve(),
  tryAcquire: () => Promise.reject(failure),
});

const runAgainstFailingStore = (credentialId: string, failure: Error): Promise<unknown> => {
  let refreshCalls = 0;

  return runWithCredentialRefreshLock(
    credentialId,
    () => {
      refreshCalls += 1;
      throw new Error("The credential was refreshed without holding the lock");
    },
    createFailingLockStore(failure),
  )
    .then(() => ({ outcome: "resolved", refreshCalls }))
    .catch((error: unknown) => ({ error, refreshCalls }));
};

describe("a refresh lock store that is unreachable rather than contended", () => {
  it("does not report the outage as another replica holding the lock", async () => {
    const outcome = await runAgainstFailingStore(
      "credential-outage-1",
      new Error("Command timed out"),
    ) as { error: unknown };

    expect(isOAuthRefreshInProgressError(outcome.error)).toBe(false);
  });

  it("surfaces the outage as its own lock-unavailable failure", async () => {
    const outcome = await runAgainstFailingStore(
      "credential-outage-2",
      new Error("Command timed out"),
    ) as { error: unknown };

    expect(isOAuthRefreshLockUnavailableError(outcome.error)).toBe(true);
    expect(isOAuthReauthRequiredError(outcome.error)).toBe(false);
  });

  it("keeps the underlying store failure as the cause", async () => {
    const failure = new Error("Stream isn't writeable and enableOfflineQueue options is false");

    const outcome = await runAgainstFailingStore("credential-outage-3", failure) as {
      error: unknown;
    };

    expect((outcome.error as Error).cause).toBe(failure);
  });

  it("never refreshes the credential without holding the lock", async () => {
    const outcome = await runAgainstFailingStore(
      "credential-outage-4",
      new Error("Command timed out"),
    ) as { refreshCalls: number };

    expect(outcome.refreshCalls).toBe(0);
  });

  it("leaves a lost lock race classified as contention", async () => {
    const contention = await runWithCredentialRefreshLock(
      "credential-outage-5",
      () => {
        throw new Error("The credential was refreshed without holding the lock");
      },
      { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(false) },
    ).catch((error: unknown) => error);

    expect(isOAuthRefreshInProgressError(contention)).toBe(true);
    expect(isOAuthRefreshLockUnavailableError(contention)).toBe(false);
  });
});
