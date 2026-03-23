import { describe, expect, it } from "bun:test";
import { ensureValidToken } from "../../../src/core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../src/core/oauth/ensure-valid-token";

const makeRefresher = (
  overrides: Partial<{ access_token: string; expires_in: number; refresh_token: string }> = {},
): TokenRefresher =>
  () => Promise.resolve({
    access_token: overrides.access_token ?? "new-token",
    expires_in: overrides.expires_in ?? 3600,
    ...overrides.refresh_token && { refresh_token: overrides.refresh_token },
  });

const makeExpiredTokenState = (overrides: Partial<TokenState> = {}): TokenState => ({
  accessToken: overrides.accessToken ?? "old-token",
  accessTokenExpiresAt: overrides.accessTokenExpiresAt ?? new Date(Date.now() - 60_000),
  refreshToken: overrides.refreshToken ?? "refresh-1",
});

describe("ensureValidToken", () => {
  it("refreshes token when accessTokenExpiresAt is in the past", async () => {
    const tokenState = makeExpiredTokenState();

    await ensureValidToken(tokenState, makeRefresher());

    expect(tokenState.accessToken).toBe("new-token");
    expect(tokenState.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reuses existing token when it has not expired", async () => {
    const tokenState = makeExpiredTokenState({
      accessToken: "valid-token",
      accessTokenExpiresAt: new Date(Date.now() + 600_000),
    });

    let refreshCalled = false;
    const trackingRefresher: TokenRefresher = () => {
      refreshCalled = true;
      return Promise.resolve({ access_token: "new-token", expires_in: 3600 });
    };

    await ensureValidToken(tokenState, trackingRefresher);

    expect(refreshCalled).toBe(false);
    expect(tokenState.accessToken).toBe("valid-token");
  });

  it("updates refresh token when returned by provider", async () => {
    const tokenState = makeExpiredTokenState({ refreshToken: "old-refresh" });

    await ensureValidToken(tokenState, makeRefresher({ refresh_token: "new-refresh" }));

    expect(tokenState.refreshToken).toBe("new-refresh");
  });

  it("keeps existing refresh token when provider does not return one", async () => {
    const tokenState = makeExpiredTokenState({ refreshToken: "original-refresh" });

    await ensureValidToken(tokenState, makeRefresher());

    expect(tokenState.refreshToken).toBe("original-refresh");
  });

  it("refreshes token when within the buffer window", async () => {
    const fourMinutesFromNow = new Date(Date.now() + 4 * 60 * 1000);
    const tokenState = makeExpiredTokenState({
      accessToken: "expiring-token",
      accessTokenExpiresAt: fourMinutesFromNow,
    });

    await ensureValidToken(tokenState, makeRefresher({ access_token: "fresh-token" }));

    expect(tokenState.accessToken).toBe("fresh-token");
  });
});
