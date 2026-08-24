import { describe, expect, it } from "vitest";
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
});
