import { describe, expect, it, vi } from "vitest";
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

  const dependencies: ImportLoginRouteDependencies = {
    createCredential: () => Promise.resolve("credential-1"),
    fetchUserInfo: () => Promise.resolve({ email: "person@example.com", id: "provider-user" }),
    importCalendars: (options) => {
      imported.push({ accessToken: options.accessToken, provider: options.provider, providerAccountId: options.providerAccountId });
      return Promise.resolve(`account-${imported.length}`);
    },
    loadLoginAccounts: () => Promise.resolve(accounts),
    now: () => NOW,
    refreshToken: (provider) => {
      refreshed.push(provider);
      return Promise.resolve({ accessToken: "fresh", expiresAt: new Date(NOW + HOUR_MS) });
    },
    ...overrides,
  };

  return { dependencies, imported, refreshed };
};

const readJson = (response: Response): Promise<{ accountIds: string[] }> =>
  response.json() as Promise<{ accountIds: string[] }>;

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

describe("handleImportLoginRoute", () => {
  it("imports a Google login with a live token without refreshing", async () => {
    const harness = createHarness([makeAccount()]);

    const response = await handleImportLoginRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toEqual({ accountIds: ["account-1"] });
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

    await expect(readJson(response)).resolves.toEqual({ accountIds: [] });
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

    await expect(readJson(response)).resolves.toEqual({ accountIds: ["account-1"] });
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

    await expect(readJson(response)).resolves.toEqual({ accountIds: ["account-1"] });
  });
});
