import { describe, expect, it } from "vitest";
import { createGoogleOAuthService } from "../../../src/core/oauth/google";
import { createMicrosoftOAuthService } from "../../../src/core/oauth/microsoft";

const MS_PER_SECOND = 1000;
const CALLBACK_URL = "https://calendar.test.invalid/api/oauth/callback";
const LOGIN_HINT = "person@example.invalid";

const createTestStateStore = () => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    set: (key: string, value: string, ttlSeconds: number) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * MS_PER_SECOND });
      return Promise.resolve();
    },
    consume: (key: string) => {
      const entry = store.get(key);
      if (!entry) {
        return Promise.resolve(null);
      }
      store.delete(key);
      return Promise.resolve(entry.value);
    },
  };
};

const buildGoogleUrl = async (loginHint?: string): Promise<URL> => {
  const service = createGoogleOAuthService({
    clientId: "google-test-client-id",
    clientSecret: "google-test-client-secret",
  }, createTestStateStore());

  return new URL(await service.getAuthorizationUrl("user-test-1", {
    callbackUrl: CALLBACK_URL,
    loginHint,
  }));
};

const buildMicrosoftUrl = async (loginHint?: string): Promise<URL> => {
  const service = createMicrosoftOAuthService({
    clientId: "microsoft-test-client-id",
    clientSecret: "microsoft-test-client-secret",
  }, createTestStateStore());

  return new URL(await service.getAuthorizationUrl("user-test-1", {
    callbackUrl: CALLBACK_URL,
    loginHint,
  }));
};

describe("google getAuthorizationUrl", () => {
  it("leaves a first connection untouched", async () => {
    const { searchParams } = await buildGoogleUrl();

    expect(searchParams.get("login_hint")).toBeNull();
    expect(searchParams.get("access_type")).toBe("offline");
    expect(searchParams.get("prompt")).toBe("consent");
  });

  it("pins a reconnect to the account that broke", async () => {
    const { searchParams } = await buildGoogleUrl(LOGIN_HINT);

    expect(searchParams.get("login_hint")).toBe(LOGIN_HINT);
    // A reconnect still has to come back with a refresh token.
    expect(searchParams.get("access_type")).toBe("offline");
    expect(searchParams.get("prompt")).toBe("consent");
  });
});

describe("an unusable hint", () => {
  it("leaves Microsoft's account picker in place rather than pinning nothing", async () => {
    // An empty hint would otherwise suppress the picker while naming no account.
    const { searchParams } = await buildMicrosoftUrl("");

    expect(searchParams.get("prompt")).toBe("select_account");
    expect(searchParams.get("login_hint")).toBeNull();
  });
});

describe("microsoft getAuthorizationUrl", () => {
  it("still offers account selection on a first connection", async () => {
    const { searchParams } = await buildMicrosoftUrl();

    expect(searchParams.get("prompt")).toBe("select_account");
    expect(searchParams.get("login_hint")).toBeNull();
  });

  it("drops the account picker once the target account is known", async () => {
    const { searchParams } = await buildMicrosoftUrl(LOGIN_HINT);

    expect(searchParams.get("login_hint")).toBe(LOGIN_HINT);
    expect(searchParams.get("prompt")).toBe("consent");
  });
});
