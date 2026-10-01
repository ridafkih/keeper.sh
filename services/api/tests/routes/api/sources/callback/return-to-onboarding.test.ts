import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthProviders } from "@keeper.sh/calendar";

const BASE_URL = "https://keeper.test.invalid";
const TOKEN_LIFETIME_SECONDS = 3600;

let validatedState: Record<string, unknown> | null = null;

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
  exchangeCodeForTokens: () => Promise.resolve({
    access_token: "access-token-1",
    expires_in: TOKEN_LIFETIME_SECONDS,
    refresh_token: "refresh-token-1",
  }),
  fetchUserInfo: () => Promise.resolve({ email: "person@keeper.test.invalid", id: "google-id-1" }),
  validateState: () => Promise.resolve(validatedState),
}));

vi.mock("@/utils/oauth-source-credentials", () => ({
  createOAuthSourceCredential: () => Promise.resolve("credential-1"),
}));

vi.mock("@/utils/oauth-sources", () => ({
  importOAuthAccountCalendars: () => Promise.resolve("account-1"),
}));

const { GET: handleCallback } = await import("@/routes/api/sources/callback/[provider]");

const callbackRoute = handleCallback as unknown as (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response>;

const runCallback = async (query: string): Promise<URL> => {
  const response = await callbackRoute({
    params: { provider: "google" },
    request: new Request(`${BASE_URL}/api/sources/callback/google?${query}`),
  });
  return new URL(response.headers.get("location") ?? "");
};

const createTestStateStore = () => {
  const store = new Map<string, string>();
  return {
    consume: (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return Promise.resolve(value);
    },
    set: (key: string, value: string, _ttlSeconds: number) => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
};

describe("a connect started from onboarding", () => {
  beforeEach(() => {
    validatedState = { destinationId: null, returnTo: "onboarding", sourceCredentialId: null, userId: "user-1" };
  });

  it("returns to the connect step with the new account", async () => {
    const location = await runCallback("code=auth-code-1&state=state-1");

    expect(location.pathname).toBe("/onboarding");
    expect(Object.fromEntries(location.searchParams)).toEqual({ accountId: "account-1", step: "connect" });
  });

  it("returns to the connect step when the person cancels at the provider", async () => {
    const location = await runCallback("error=access_denied&state=state-1");

    expect(location.pathname).toBe("/onboarding");
    expect(location.searchParams.get("error")).toBe("connect_failed");
  });

  it("keeps a reconnect on the account page", async () => {
    validatedState = { ...validatedState, sourceCredentialId: "credential-0" };
    const location = await runCallback("code=auth-code-1&state=state-1");

    expect(location.pathname).toBe("/dashboard/accounts/account-1");
  });
});

describe("a connect started anywhere else", () => {
  it("still opens the setup sentence", async () => {
    validatedState = { destinationId: null, returnTo: null, sourceCredentialId: null, userId: "user-1" };
    const location = await runCallback("code=auth-code-1&state=state-1");

    expect(location.pathname).toBe("/dashboard/setup");
  });
});

describe("google authorization", () => {
  const createGoogle = () => {
    const store = createTestStateStore();
    const providers = createOAuthProviders(
      { google: { clientId: "google-test-client-id", clientSecret: "google-test-client-secret" }, microsoft: null },
      store,
    );
    const provider = providers.getProvider("google");
    if (!provider) {
      throw new Error("google provider missing");
    }
    return { provider, providers, store };
  };

  it("shows the account chooser so a second account can be added", async () => {
    const { provider } = createGoogle();
    const url = new URL(await provider.getAuthorizationUrl("user-1", { callbackUrl: `${BASE_URL}/cb` }));

    expect(url.searchParams.get("prompt")).toBe("select_account consent");
  });

  it("skips the chooser for a reconnect pinned to one account", async () => {
    const { provider } = createGoogle();
    const url = new URL(await provider.getAuthorizationUrl("user-1", {
      callbackUrl: `${BASE_URL}/cb`,
      loginHint: "person@keeper.test.invalid",
    }));

    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("keeps the return path in the stored state", async () => {
    const { provider, providers, store } = createGoogle();
    const url = new URL(await provider.getAuthorizationUrl("user-1", {
      callbackUrl: `${BASE_URL}/cb`,
      returnTo: "onboarding",
    }));
    const state = url.searchParams.get("state") ?? "";

    expect(await providers.validateState(state)).toMatchObject({ returnTo: "onboarding", userId: "user-1" });
    expect(await store.consume(`oauth:state:${state}`)).toBeNull();
  });
});
