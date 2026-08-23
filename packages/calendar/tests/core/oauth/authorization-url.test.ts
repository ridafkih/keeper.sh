import { describe, expect, it } from "vitest";
import { createGoogleOAuthService } from "../../../src/core/oauth/google";
import { createMicrosoftOAuthService } from "../../../src/core/oauth/microsoft";

const MS_PER_SECOND = 1000;
const CALLBACK_URL = "https://calendar.test.invalid/api/oauth/callback";

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

const buildMicrosoftAuthorizationUrl = async (): Promise<URL> => {
  const service = createMicrosoftOAuthService({
    clientId: "microsoft-test-client-id",
    clientSecret: "microsoft-test-client-secret",
  }, createTestStateStore());

  const authorizationUrl = await service.getAuthorizationUrl("user-test-1", {
    callbackUrl: CALLBACK_URL,
  });

  return new URL(authorizationUrl);
};

const buildGoogleAuthorizationUrl = async (): Promise<URL> => {
  const service = createGoogleOAuthService({
    clientId: "google-test-client-id",
    clientSecret: "google-test-client-secret",
  }, createTestStateStore());

  const authorizationUrl = await service.getAuthorizationUrl("user-test-1", {
    callbackUrl: CALLBACK_URL,
  });

  return new URL(authorizationUrl);
};

describe("microsoft getAuthorizationUrl", () => {
  it("pins the authority, response shape and scope set", async () => {
    const parsed = await buildMicrosoftAuthorizationUrl();
    const { searchParams } = parsed;

    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(searchParams.get("client_id")).toBe("microsoft-test-client-id");
    expect(searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(searchParams.get("response_type")).toBe("code");
    expect(searchParams.get("response_mode")).toBe("query");
    expect(searchParams.get("scope")).toBe("Calendars.ReadWrite User.Read offline_access");
  });

  it("carries an opaque state value", async () => {
    const parsed = await buildMicrosoftAuthorizationUrl();
    const state = parsed.searchParams.get("state");

    expect(typeof state).toBe("string");
    expect(state).not.toBe("");
  });

  it("asks the identity platform for account selection", async () => {
    const parsed = await buildMicrosoftAuthorizationUrl();

    expect(parsed.searchParams.get("prompt")).toBe("select_account");
  });
});

describe("google getAuthorizationUrl", () => {
  it("pins the authority, response shape and scope set", async () => {
    const parsed = await buildGoogleAuthorizationUrl();
    const { searchParams } = parsed;

    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(searchParams.get("client_id")).toBe("google-test-client-id");
    expect(searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(searchParams.get("response_type")).toBe("code");
    expect(searchParams.get("access_type")).toBe("offline");
    expect(searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/userinfo.email",
    );
  });

  it("carries an opaque state value", async () => {
    const parsed = await buildGoogleAuthorizationUrl();
    const state = parsed.searchParams.get("state");

    expect(typeof state).toBe("string");
    expect(state).not.toBe("");
  });

  it("keeps forcing consent so a refresh token is always issued", async () => {
    const parsed = await buildGoogleAuthorizationUrl();

    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });
});
