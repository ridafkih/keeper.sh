import { describe, expect, it } from "vitest";
import {
  isOAuthReauthRequiredError,
  isOAuthRefreshInProgressError,
} from "../../../src/core/oauth/error-classification";
import { runWithCredentialRefreshLock } from "../../../src/core/oauth/refresh-coordinator";

describe("runWithCredentialRefreshLock", () => {
  it("coalesces concurrent refreshes for the same credential", () => {
    let refreshCalls = 0;
    const deferredRefresh = Promise.withResolvers<{
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    }>();

    const refreshOperation = () => {
      refreshCalls += 1;
      return deferredRefresh.promise;
    };

    const first = runWithCredentialRefreshLock("credential-1", refreshOperation);
    const second = runWithCredentialRefreshLock("credential-1", refreshOperation);

    expect(refreshCalls).toBe(1);

    deferredRefresh.resolve({
      access_token: "access-token",
      expires_in: 3600,
      refresh_token: "refresh-token",
    });

    expect(first).resolves.toMatchObject({ access_token: "access-token" });
    expect(second).resolves.toMatchObject({ access_token: "access-token" });
  });

  it("releases the lock after failures", async () => {
    let calls = 0;

    const failingOperation = () => {
      calls += 1;
      return Promise.reject(new Error("refresh failed"));
    };

    await expect(
      runWithCredentialRefreshLock("credential-2", failingOperation),
    ).rejects.toThrow("refresh failed");
    await expect(
      runWithCredentialRefreshLock("credential-2", failingOperation),
    ).rejects.toThrow("refresh failed");

    expect(calls).toBe(2);
  });

  it("marks a lost distributed lock as a coordination event, not a credential failure", async () => {
    const acquiredKeys: string[] = [];
    const lockStore = {
      release: () => Promise.resolve(),
      tryAcquire: (key: string) => {
        acquiredKeys.push(key);
        return Promise.resolve(false);
      },
    };

    const contention = await runWithCredentialRefreshLock(
      "credential-3",
      () => {
        throw new Error("refresh must not run");
      },
      lockStore,
    ).catch((error: unknown) => error);

    expect(acquiredKeys).toEqual(["oauth:refresh-lock:credential-3"]);
    expect(isOAuthRefreshInProgressError(contention)).toBe(true);
    expect(isOAuthReauthRequiredError(contention)).toBe(false);
  });
});
