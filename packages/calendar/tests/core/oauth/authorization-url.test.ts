import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOAuthConfigs } from "../../../src/core/oauth/config";
import { createGoogleOAuthService } from "../../../src/core/oauth/google";
import {
  createMicrosoftOAuthService,
  createMicrosoftTokenRefresher,
} from "../../../src/core/oauth/microsoft";

const MS_PER_SECOND = 1000;
const CALLBACK_URL = "https://calendar.test.invalid/api/oauth/callback";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

const buildTenantMicrosoftAuthorizationUrl = async (tenantId: string): Promise<URL> => {
  const service = createMicrosoftOAuthService({
    clientId: "microsoft-test-client-id",
    clientSecret: "microsoft-test-client-secret",
    tenantId,
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

  it("uses the configured tenant authority", async () => {
    const parsed = await buildTenantMicrosoftAuthorizationUrl("tenant-guid");

    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://login.microsoftonline.com/tenant-guid/oauth2/v2.0/authorize",
    );
  });

  it("passes the configured tenant ID through OAuth configuration", () => {
    const configs = buildOAuthConfigs({
      MICROSOFT_CLIENT_ID: "microsoft-test-client-id",
      MICROSOFT_CLIENT_SECRET: "microsoft-test-client-secret",
      MICROSOFT_TENANT_ID: "tenant-guid",
    });

    expect(configs.microsoft?.tenantId).toBe("tenant-guid");
  });

  it("uses the configured tenant for code exchange and token refresh", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input));
      return Promise.resolve(Response.json({
        access_token: "access-token",
        expires_in: 3600,
        scope: "Calendars.ReadWrite User.Read offline_access",
        token_type: "Bearer",
      }));
    });

    const credentials = {
      clientId: "microsoft-test-client-id",
      clientSecret: "microsoft-test-client-secret",
      tenantId: "tenant-guid",
    };
    const service = createMicrosoftOAuthService(credentials, createTestStateStore());
    await service.exchangeCodeForTokens("authorization-code", CALLBACK_URL);
    await createMicrosoftTokenRefresher(credentials)("refresh-token");

    expect(requestedUrls).toEqual([
      "https://login.microsoftonline.com/tenant-guid/oauth2/v2.0/token",
      "https://login.microsoftonline.com/tenant-guid/oauth2/v2.0/token",
    ]);
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
