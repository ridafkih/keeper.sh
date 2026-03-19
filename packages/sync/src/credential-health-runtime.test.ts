import { describe, expect, it } from "bun:test";
import { createCredentialHealthRuntime } from "./credential-health-runtime";

describe("credential health runtime", () => {
  it("refreshes and persists credentials on success", async () => {
    const persisted: { accessToken: string; refreshToken: string }[] = [];
    const runtime = createCredentialHealthRuntime({
      accessTokenExpiresAt: new Date("2026-03-19T20:00:00.000Z"),
      calendarAccountId: "acc-1",
      isReauthRequiredError: () => false,
      markNeedsReauthentication: () => Promise.resolve(),
      oauthCredentialId: "cred-1",
      persistRefreshedCredentials: ({ accessToken, refreshToken }) => {
        persisted.push({ accessToken, refreshToken });
        return Promise.resolve();
      },
      refreshAccessToken: () =>
        Promise.resolve({
          access_token: "next-access",
          expires_in: 3600,
          refresh_token: "next-refresh",
        }),
    });

    const refreshed = await runtime.refresh("old-refresh");
    const snapshot = await runtime.getSnapshot();

    expect(refreshed.access_token).toBe("next-access");
    expect(snapshot.state).toBe("token_valid");
    expect(persisted).toEqual([
      { accessToken: "next-access", refreshToken: "next-refresh" },
    ]);
  });

  it("marks reauth required on terminal refresh error", async () => {
    let marked = 0;
    const runtime = createCredentialHealthRuntime({
      accessTokenExpiresAt: new Date("2026-03-19T20:00:00.000Z"),
      calendarAccountId: "acc-2",
      isReauthRequiredError: () => true,
      markNeedsReauthentication: () => {
        marked += 1;
        return Promise.resolve();
      },
      oauthCredentialId: "cred-2",
      persistRefreshedCredentials: () => Promise.resolve(),
      refreshAccessToken: () => Promise.reject(new Error("invalid_grant")),
    });

    await expect(runtime.refresh("old-refresh")).rejects.toThrow("invalid_grant");
    const snapshot = await runtime.getSnapshot();

    expect(snapshot.state).toBe("reauth_required");
    expect(marked).toBe(1);
  });

  it("keeps retryable failure state for transient refresh error", async () => {
    const runtime = createCredentialHealthRuntime({
      accessTokenExpiresAt: new Date("2026-03-19T20:00:00.000Z"),
      calendarAccountId: "acc-3",
      isReauthRequiredError: () => false,
      markNeedsReauthentication: () => Promise.resolve(),
      oauthCredentialId: "cred-3",
      persistRefreshedCredentials: () => Promise.resolve(),
      refreshAccessToken: () => Promise.reject(new Error("timeout")),
    });

    await expect(runtime.refresh("old-refresh")).rejects.toThrow("timeout");
    const snapshot = await runtime.getSnapshot();

    expect(snapshot.state).toBe("refresh_failed_retryable");
  });
});
