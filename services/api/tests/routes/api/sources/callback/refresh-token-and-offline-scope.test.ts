import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthProviders } from "@keeper.sh/calendar";

const BASE_URL = "https://keeper.test.invalid";
const TOKEN_LIFETIME_SECONDS = 3600;
const MS_PER_SECOND = 1000;

const storedCredentials: { userId: string; refreshToken: string }[] = [];
const importedAccounts: string[] = [];
let tokenResponse: Record<string, unknown> = {};

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
  },
}));

vi.mock("@/utils/middleware", () => ({
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("@/context", () => ({
  baseUrl: BASE_URL,
}));

vi.mock("@/utils/destinations", () => ({
  exchangeCodeForTokens: () => Promise.resolve(tokenResponse),
  fetchUserInfo: () =>
    Promise.resolve({ email: "person@tenant.test.invalid", id: "graph-object-id-1" }),
  validateState: () => Promise.resolve({ userId: "user-1" }),
}));

vi.mock("@/utils/oauth-source-credentials", () => ({
  createOAuthSourceCredential: (userId: string, data: { refreshToken: string }) => {
    storedCredentials.push({ refreshToken: data.refreshToken, userId });
    return Promise.resolve("credential-1");
  },
}));

vi.mock("@/utils/oauth-sources", () => ({
  importOAuthAccountCalendars: (options: { oauthCredentialId: string }) => {
    importedAccounts.push(options.oauthCredentialId);
    return Promise.resolve("account-1");
  },
}));

const { GET: handleCallback } = await import("@/routes/api/sources/callback/[provider]");

const callbackRequest = (): Request =>
  new Request(`${BASE_URL}/api/sources/callback/outlook?code=auth-code-1&state=state-1`);

const callbackRoute = handleCallback as unknown as (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response>;

const runCallback = async (): Promise<Response> =>
  await callbackRoute({ params: { provider: "outlook" }, request: callbackRequest() });

const createTestStateStore = () => {
  const store = new Map<string, { expiresAt: number; value: string }>();
  return {
    consume: (key: string) => {
      const entry = store.get(key);
      if (!entry) {
        return Promise.resolve(null);
      }
      store.delete(key);
      return Promise.resolve(entry.value);
    },
    set: (key: string, value: string, ttlSeconds: number) => {
      store.set(key, { expiresAt: Date.now() + ttlSeconds * MS_PER_SECOND, value });
      return Promise.resolve();
    },
  };
};

describe("microsoft connect keeps requesting offline access", () => {
  it("puts offline_access in the authorize request scopes", async () => {
    const providers = createOAuthProviders(
      {
        google: null,
        microsoft: {
          clientId: "microsoft-test-client-id",
          clientSecret: "microsoft-test-client-secret",
        },
      },
      createTestStateStore(),
    );
    const provider = providers.getProvider("outlook");
    if (!provider) {
      throw new Error("outlook provider missing");
    }

    const authorizationUrl = await provider.getAuthorizationUrl("user-1", {
      callbackUrl: `${BASE_URL}/api/sources/callback/outlook`,
    });
    const scopes = new URL(authorizationUrl).searchParams.get("scope")?.split(" ") ?? [];

    expect(scopes).toContain("offline_access");
  });
});

describe("microsoft connect rejects a token response without a refresh token", () => {
  beforeEach(() => {
    storedCredentials.length = 0;
    importedAccounts.length = 0;
    tokenResponse = {
      access_token: "access-token-1",
      expires_in: TOKEN_LIFETIME_SECONDS,
      scope: "Calendars.ReadWrite User.Read",
    };
  });

  it("fails the connect loudly instead of storing a dead connection", async () => {
    const response = await runCallback();
    const location = response.headers.get("location") ?? "";

    expect(storedCredentials).toEqual([]);
    expect(importedAccounts).toEqual([]);
    expect(new URL(location).searchParams.get("source")).toBe("error");
  });

  it("still completes the connect when a refresh token is present", async () => {
    tokenResponse = {
      access_token: "access-token-1",
      expires_in: TOKEN_LIFETIME_SECONDS,
      refresh_token: "refresh-token-1",
      scope: "Calendars.ReadWrite User.Read offline_access",
    };

    const response = await runCallback();
    const location = response.headers.get("location") ?? "";

    expect(storedCredentials).toEqual([
      { refreshToken: "refresh-token-1", userId: "user-1" },
    ]);
    expect(importedAccounts).toEqual(["credential-1"]);
    expect(new URL(location).pathname).toBe("/dashboard/accounts/account-1/setup");
  });
});
