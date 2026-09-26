import { describe, it, expect, vi } from "vitest";
import {
  beginEwsDeviceAuthorization,
  pollEwsDeviceAuthorization,
  getEwsUserAccessToken,
} from "../../../src/providers/ews/oauth";
import { parseEwsConfig } from "../../../src/providers/ews/config";
import { EwsClient } from "../../../src/providers/ews/client";

const config = () =>
  parseEwsConfig({
    serverUrl: "https://ews.example.test/endpoint",
    mailbox: "user@example.test",
    minimumIntervalMs: 0,
    auth: {
      type: "oauth2-user",
      deviceAuthorizationUrl: "https://id.example.test/device",
      tokenUrl: "https://id.example.test/token",
      clientId: "public-app",
      scope: "ews offline_access",
    },
  });
const tokens = {
  access_token: "access-secret",
  refresh_token: "refresh-secret",
  token_type: "Bearer",
  expires_in: 3600,
};
const response = (data: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(Response.json(data, { status })));

describe("EWS user OAuth", () => {
  it("starts a device login with configurable endpoints and no client secret for public clients", async () => {
    const fetch = response({
      device_code: "private-device",
      user_code: "USER-CODE",
      verification_uri: "https://id.example.test/verify",
      expires_in: 900,
      interval: 7,
    });
    const result = await beginEwsDeviceAuthorization(config(), { fetch });
    expect(result.interval).toBe(7);
    expect(result.userCode).toBe("USER-CODE");
    expect(fetch).toHaveBeenCalledWith(
      "https://id.example.test/device",
      expect.objectContaining({
        redirect: "manual",
        body: new URLSearchParams({
          client_id: "public-app",
          scope: "ews offline_access",
        }),
      }),
    );
  });
  it("rejects unsafe verification URLs", async () => {
    await expect(
      beginEwsDeviceAuthorization(config(), {
        fetch: response({
          device_code: "private",
          user_code: "code",
          // eslint-disable-next-line no-script-url -- Deliberately hostile OAuth response under test.
          verification_uri: "javascript:alert(1)",
          expires_in: 900,
        }),
      }),
    ).rejects.toThrow();
  });
  it.each(["authorization_pending", "slow_down"])(
    "handles %s without a token",
    async (error) => {
      expect(
        await pollEwsDeviceAuthorization(config(), "device", {
          fetch: response({ error }, 400),
        }),
      ).toBe(error);
    },
  );
  it.each(["access_denied", "expired_token"])(
    "rejects %s without exposing diagnostics",
    async (error) => {
      await expect(
        pollEwsDeviceAuthorization(config(), "device", {
          fetch: response(
            { error, error_description: "private-diagnostics" },
            400,
          ),
        }),
      ).rejects.toThrow("OAuthDeviceAuthorizationRejected");
    },
  );
  it("stores authorization tokens only in the server configuration", async () => {
    const connection = config();
    expect(
      await pollEwsDeviceAuthorization(connection, "device", {
        fetch: response(tokens),
      }),
    ).toBe("authorized");
    expect(connection.auth).toMatchObject({
      refreshToken: "refresh-secret",
      accessToken: "access-secret",
    });
  });
  it("requires offline access for background synchronization", async () => {
    await expect(
      pollEwsDeviceAuthorization(config(), "device", {
        fetch: response({
          access_token: "access",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      }),
    ).rejects.toThrow("OfflineAccessRequired");
  });
  it("reuses an unexpired token without a network request", async () => {
    const connection = config();
    Object.assign(connection.auth, {
      accessToken: "cached",
      refreshToken: "refresh",
      expiresAt: Date.now() + 120_000,
    });
    const fetch = response(tokens);
    expect(await getEwsUserAccessToken(connection, { fetch })).toBe("cached");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refreshes and rotates the refresh token", async () => {
    const connection = config();
    Object.assign(connection.auth, {
      refreshToken: "old-refresh",
      accessToken: "expired",
      expiresAt: 1,
    });
    const fetch = response(tokens);
    expect(await getEwsUserAccessToken(connection, { fetch })).toBe(
      "access-secret",
    );
    expect(connection.auth).toMatchObject({ refreshToken: "refresh-secret" });
    expect(fetch).toHaveBeenCalledWith(
      "https://id.example.test/token",
      expect.objectContaining({
        body: new URLSearchParams({
          client_id: "public-app",
          grant_type: "refresh_token",
          refresh_token: "old-refresh",
          scope: "ews offline_access",
        }),
      }),
    );
  });
  it("retains the refresh token when the provider does not rotate it", async () => {
    const connection = config();
    Object.assign(connection.auth, { refreshToken: "old" });
    await getEwsUserAccessToken(connection, {
      fetch: response({
        access_token: "new",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    });
    expect(connection.auth).toMatchObject({ refreshToken: "old" });
  });
  it("marks revoked refresh credentials as requiring authentication", async () => {
    const connection = config();
    Object.assign(connection.auth, { refreshToken: "revoked" });
    await expect(
      getEwsUserAccessToken(connection, {
        fetch: response({ error: "invalid_grant" }, 400),
      }),
    ).rejects.toMatchObject({ authRequired: true });
  });
  it("refuses token responses with an unsupported token type", async () => {
    await expect(
      pollEwsDeviceAuthorization(config(), "device", {
        fetch: response({ ...tokens, token_type: "Basic" }),
      }),
    ).rejects.toThrow("InvalidOAuthResponse");
  });
  it("refuses redirects before token processing", async () => {
    await expect(
      pollEwsDeviceAuthorization(config(), "device", {
        fetch: response({}, 302),
      }),
    ).rejects.toThrow("OAuthRedirectRejected");
  });
  it("requires a persistent token provider for user EWS calls", async () => {
    await expect(
      new EwsClient(config(), { fetch: response({}) }).discoverCalendars(),
    ).rejects.toThrow("UserTokenStoreRequired");
  });
});
