import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  handleOAuthCallback as handleOAuthCallbackFn,
  OAuthError as OAuthErrorClass,
} from "./oauth";

type SelectResult = unknown[];

const createQueryable = (value: SelectResult) => ({
  limit: () => Promise.resolve(value),
  then: (resolve: (value: SelectResult) => unknown, reject?: (reason?: unknown) => unknown) =>
    Promise.resolve(value).then(resolve, reject),
});

let selectResults: SelectResult[] = [];
let canAddAccountCalls: [string, number][] = [];
let canAddAccountResult = true;
let exchangeCodeForTokensCalls: Array<{ callbackUrl: string; code: string; provider: string }> = [];
let fetchUserInfoCalls: Array<{ accessToken: string; provider: string }> = [];
let saveCalendarDestinationCalls: Array<{
  accessToken: string;
  accountId: string;
  email: string | null;
  expiresAt: Date;
  needsReauthentication: boolean;
  provider: string;
  refreshToken: string;
  userId: string;
}> = [];

const database = {
  select: () => ({
    from: () => ({
      where: () => createQueryable(selectResults.shift() ?? []),
    }),
  }),
};

const premiumService = {
  canAddAccount: (userId: string, currentCount: number) => {
    canAddAccountCalls.push([userId, currentCount]);
    return Promise.resolve(canAddAccountResult);
  },
};

let handleOAuthCallback: typeof handleOAuthCallbackFn = () =>
  Promise.reject(new Error("Module not loaded"));
let OAuthError: typeof OAuthErrorClass;

beforeAll(async () => {
  mock.module("../context", () => ({
    baseUrl: "https://keeper.test",
    database,
    premiumService,
  }));
  mock.module("./destinations", () => ({
    exchangeCodeForTokens: (provider: string, code: string, callbackUrl: string) => {
      exchangeCodeForTokensCalls.push({ callbackUrl, code, provider });
      return Promise.resolve({
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        scope: "calendar.read calendar.write",
      });
    },
    fetchUserInfo: (provider: string, accessToken: string) => {
      fetchUserInfoCalls.push({ accessToken, provider });
      return Promise.resolve({
        email: "person@example.com",
        id: "external-account-1",
      });
    },
    getDestinationAccountId: () => Promise.resolve(null),
    hasRequiredScopes: () => true,
    saveCalendarDestination: (
      userId: string,
      provider: string,
      accountId: string,
      email: string | null,
      accessToken: string,
      refreshToken: string,
      expiresAt: Date,
      needsReauthentication = false,
    ) => {
      saveCalendarDestinationCalls.push({
        accessToken,
        accountId,
        email,
        expiresAt,
        needsReauthentication,
        provider,
        refreshToken,
        userId,
      });
      return Promise.resolve();
    },
    validateState: () => ({ destinationId: undefined, userId: "user-1" }),
  }));
  mock.module("./sync", () => ({
    triggerDestinationSync: () => null,
  }));

  ({ handleOAuthCallback, OAuthError } = await import("./oauth"));
});

beforeEach(() => {
  selectResults = [];
  canAddAccountCalls = [];
  canAddAccountResult = true;
  exchangeCodeForTokensCalls = [];
  fetchUserInfoCalls = [];
  saveCalendarDestinationCalls = [];
});

describe("handleOAuthCallback", () => {
  it("rejects new destination connections when the user is at the account limit", async () => {
    selectResults = [
      [],
      [{ id: "account-1" }, { id: "account-2" }],
    ];
    canAddAccountResult = false;

    let capturedError: unknown;
    try {
      await handleOAuthCallback({
        code: "oauth-code",
        error: null,
        provider: "google",
        state: "oauth-state",
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(OAuthError);
    expect((capturedError as InstanceType<typeof OAuthError>).redirectUrl.searchParams.get("error")).toBe(
      "Account limit reached. Upgrade to Pro for unlimited accounts.",
    );
    expect(canAddAccountCalls).toEqual([["user-1", 2]]);
    expect(saveCalendarDestinationCalls).toHaveLength(0);
  });

  it("allows reconnecting an existing destination account without rechecking the limit", async () => {
    selectResults = [
      [{
        caldavCredentialId: null,
        id: "destination-1",
        oauthCredentialId: "oauth-credential-1",
        userId: "user-1",
      }],
    ];
    canAddAccountResult = false;

    const result = await handleOAuthCallback({
      code: "oauth-code",
      error: null,
      provider: "google",
      state: "oauth-state",
    });

    expect(result.redirectUrl.pathname).toBe("/dashboard/integrations");
    expect(result.redirectUrl.searchParams.get("destination")).toBe("connected");
    expect(canAddAccountCalls).toHaveLength(0);
    expect(saveCalendarDestinationCalls).toHaveLength(1);
  });
});
