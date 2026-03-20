import { describe, expect, it } from "bun:test";
import { InMemoryCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import type { CredentialHealthCommand } from "@keeper.sh/state-machines";
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
      outboxStore: new InMemoryCommandOutboxStore<CredentialHealthCommand>(),
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
      onRuntimeEvent: () => Promise.resolve(),
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
      outboxStore: new InMemoryCommandOutboxStore<CredentialHealthCommand>(),
      persistRefreshedCredentials: () => Promise.resolve(),
      refreshAccessToken: () => Promise.reject(new Error("invalid_grant")),
      onRuntimeEvent: () => Promise.resolve(),
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
      outboxStore: new InMemoryCommandOutboxStore<CredentialHealthCommand>(),
      persistRefreshedCredentials: () => Promise.resolve(),
      refreshAccessToken: () => Promise.reject(new Error("timeout")),
      onRuntimeEvent: () => Promise.resolve(),
    });

    await expect(runtime.refresh("old-refresh")).rejects.toThrow("timeout");
    const snapshot = await runtime.getSnapshot();

    expect(snapshot.state).toBe("refresh_failed_retryable");
  });

  it("emits runtime processed events during refresh flow", async () => {
    const processed: string[] = [];
    const runtime = createCredentialHealthRuntime({
      accessTokenExpiresAt: new Date("2026-03-19T20:00:00.000Z"),
      calendarAccountId: "acc-4",
      isReauthRequiredError: () => false,
      markNeedsReauthentication: () => Promise.resolve(),
      oauthCredentialId: "cred-4",
      outboxStore: new InMemoryCommandOutboxStore<CredentialHealthCommand>(),
      persistRefreshedCredentials: () => Promise.resolve(),
      refreshAccessToken: () =>
        Promise.resolve({
          access_token: "next-access",
          expires_in: 3600,
          refresh_token: "next-refresh",
        }),
      onRuntimeEvent: (event) => {
        processed.push(event.envelope.event.type);
        return Promise.resolve();
      },
    });

    await runtime.refresh("old-refresh");

    expect(processed).toEqual([
      "TOKEN_EXPIRY_DETECTED",
      "REFRESH_STARTED",
      "REFRESH_SUCCEEDED",
    ]);
  });
});
