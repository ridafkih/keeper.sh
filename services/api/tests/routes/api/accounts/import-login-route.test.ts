import { describe, expect, it, vi } from "vitest";
import { createAuth } from "@keeper.sh/auth";
import { OAuthSourceLimitError } from "../../../../src/utils/oauth-sources";
import {
  handleImportLoginRoute,
  hasLoginCalendarScopes,
} from "../../../../src/routes/api/accounts/import-login-route";
import type {
  ImportLoginRouteDependencies,
  LoginAccount,
} from "../../../../src/routes/api/accounts/import-login-route";

vi.mock("@/utils/logging", () => ({
  widelog: {
    errorFields: () => null,
    set: () => null,
  },
}));

const NOW = Date.parse("2026-09-13T10:00:00.000Z");
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const GOOGLE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly openid";

const makeAccount = (overrides: Partial<LoginAccount> = {}): LoginAccount => ({
  accessToken: "access",
  accessTokenExpiresAt: new Date(NOW + HOUR_MS),
  accountId: "provider-user",
  providerId: "google",
  refreshToken: "refresh",
  scope: GOOGLE_SCOPE,
  ...overrides,
});

const createHarness = (accounts: LoginAccount[], overrides: Partial<ImportLoginRouteDependencies> = {}) => {
  const refreshed: string[] = [];
  const imported: { provider: string; accessToken: string; providerAccountId: string | null }[] = [];
  const credentials: { refreshToken: string }[] = [];

  const dependencies: ImportLoginRouteDependencies = {
    claimImport: () => Promise.resolve({ allowed: true }),
    createCredential: (_userId, data) => {
      credentials.push({ refreshToken: data.refreshToken });
      return Promise.resolve("credential-1");
    },
    fetchUserInfo: () => Promise.resolve({ email: "person@example.com", id: "provider-user" }),
    importCalendars: (options) => {
      imported.push({ accessToken: options.accessToken, provider: options.provider, providerAccountId: options.providerAccountId });
      return Promise.resolve(`account-${imported.length}`);
    },
    loadEligibility: () => Promise.resolve({ calendarAccountCount: 0, userCreatedAt: new Date(NOW - MINUTE_MS) }),
    loadLoginAccounts: () => Promise.resolve(accounts),
    now: () => NOW,
    refreshToken: (provider) => {
      refreshed.push(provider);
      return Promise.resolve({ accessToken: "fresh", expiresAt: new Date(NOW + HOUR_MS) });
    },
    ...overrides,
  };

  return { credentials, dependencies, imported, refreshed };
};

const readJson = (response: Response): Promise<{ accountIds?: string[]; imported: boolean }> =>
  response.json() as Promise<{ accountIds?: string[]; imported: boolean }>;

describe("hasLoginCalendarScopes", () => {
  it("requires both Google calendar scopes in any separator style", () => {
    expect(hasLoginCalendarScopes("google", GOOGLE_SCOPE)).toBe(true);
    expect(hasLoginCalendarScopes("google", GOOGLE_SCOPE.replaceAll(" ", ","))).toBe(true);
    expect(hasLoginCalendarScopes("google", "https://www.googleapis.com/auth/calendar.events")).toBe(false);
    expect(hasLoginCalendarScopes("google", null)).toBe(false);
  });

  it("accepts Microsoft's calendar scope in short or resource-qualified form", () => {
    expect(hasLoginCalendarScopes("outlook", "offline_access Calendars.ReadWrite")).toBe(true);
    expect(hasLoginCalendarScopes("outlook", "https://graph.microsoft.com/Calendars.ReadWrite")).toBe(true);
    expect(hasLoginCalendarScopes("outlook", "User.Read")).toBe(false);
  });
});

describe("hasLoginCalendarScopes against the sign-in config", () => {
  it("accepts exactly the scopes Google and Microsoft sign-in ask for", () => {
    const { auth } = createAuth({
      baseUrl: "http://localhost:3000",
      database: {} as never,
      googleClientId: "google-id",
      googleClientSecret: "google-secret",
      microsoftClientId: "microsoft-id",
      microsoftClientSecret: "microsoft-secret",
      secret: "a".repeat(32),
    });
    const providers = auth.options.socialProviders as Record<string, { scope?: string[] }> | undefined;

    expect(hasLoginCalendarScopes("google", providers?.google?.scope?.join(" ") ?? null)).toBe(true);
    expect(hasLoginCalendarScopes("outlook", providers?.microsoft?.scope?.join(" ") ?? null)).toBe(true);
  });
});

describe("handleImportLoginRoute", () => {
  it("imports a Google login with a live token without refreshing", async () => {
    const harness = createHarness([makeAccount()]);

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toEqual({ accountIds: ["account-1"], imported: true });
    expect(harness.refreshed).toEqual([]);
    expect(harness.imported).toEqual([{ accessToken: "access", provider: "google", providerAccountId: "provider-user" }]);
  });

  it("refreshes an expired token and maps microsoft to the outlook provider", async () => {
    const harness = createHarness([
      makeAccount({ accessTokenExpiresAt: new Date(NOW - HOUR_MS), providerId: "microsoft", scope: "offline_access Calendars.ReadWrite" }),
    ]);

    await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    expect(harness.refreshed).toEqual(["outlook"]);
    expect(harness.imported).toEqual([{ accessToken: "fresh", provider: "outlook", providerAccountId: "provider-user" }]);
  });

  it("skips logins that cannot list calendars", async () => {
    const harness = createHarness([
      makeAccount({ refreshToken: null }),
      makeAccount({ scope: "https://www.googleapis.com/auth/calendar.events" }),
      makeAccount({ providerId: "github" }),
    ]);

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toEqual({ accountIds: [], imported: false });
    expect(harness.imported).toEqual([]);
  });

  it("stops at the account limit and keeps what was imported", async () => {
    let calls = 0;
    const harness = createHarness([makeAccount(), makeAccount({ providerId: "microsoft", scope: "Calendars.ReadWrite" })], {
      importCalendars: () => {
        calls += 1;
        if (calls > 1) {
          return Promise.reject(new OAuthSourceLimitError());
        }
        return Promise.resolve("account-1");
      },
    });

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toEqual({ accountIds: ["account-1"], imported: true });
  });

  it("keeps going when one login fails for another reason", async () => {
    let calls = 0;
    const harness = createHarness([makeAccount(), makeAccount({ providerId: "microsoft", scope: "Calendars.ReadWrite" })], {
      fetchUserInfo: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error("provider down"));
        }
        return Promise.resolve({ email: "person@example.com", id: "provider-user" });
      },
    });

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toEqual({ accountIds: ["account-1"], imported: true });
  });

  it("keeps a refresh token the provider rotated", async () => {
    const harness = createHarness([makeAccount({ accessTokenExpiresAt: new Date(NOW - HOUR_MS) })], {
      refreshToken: () => Promise.resolve({ accessToken: "fresh", expiresAt: new Date(NOW + HOUR_MS), refreshToken: "rotated" }),
    });

    await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    expect(harness.credentials).toEqual([{ refreshToken: "rotated" }]);
  });

  it("does nothing for a user who already has calendar accounts", async () => {
    const harness = createHarness([makeAccount()], {
      claimImport: () => Promise.reject(new Error("should not be called")),
      loadEligibility: () => Promise.resolve({ calendarAccountCount: 1, userCreatedAt: new Date(NOW - MINUTE_MS) }),
    });

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ imported: false });
    expect(harness.imported).toEqual([]);
  });

  it("does nothing once the signup is more than an hour old, so a removed account stays removed", async () => {
    const harness = createHarness([makeAccount()], {
      loadEligibility: () => Promise.resolve({ calendarAccountCount: 0, userCreatedAt: new Date(NOW - HOUR_MS - MINUTE_MS) }),
    });

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toEqual({ imported: false });
    expect(harness.imported).toEqual([]);
  });

  it("does nothing for a user it can't find", async () => {
    const harness = createHarness([makeAccount()], {
      loadEligibility: () => Promise.resolve({ calendarAccountCount: 0, userCreatedAt: null }),
    });

    await expect(readJson(await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies))).resolves.toEqual({ imported: false });
  });

  it("refuses a second import while one is already under way", async () => {
    const harness = createHarness([makeAccount()], {
      claimImport: () => Promise.resolve({ allowed: false, retryAfterSeconds: 42 }),
    });

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(harness.imported).toEqual([]);
  });
});
