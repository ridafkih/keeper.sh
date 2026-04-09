import { beforeEach, describe, expect, it } from "vitest";
import {
  handleOAuthCallbackWithDependencies,
  OAuthError,
} from "../../src/utils/oauth";

let persistCalendarDestinationCalls: {
  accessToken: string;
  accountId: string;
  destinationId?: string;
  email: string | null;
  expiresAt: Date;
  needsReauthentication: boolean;
  provider: string;
  refreshToken: string;
  userId: string;
}[] = [];
let enqueuePushSyncCalls: string[] = [];

beforeEach(() => {
  persistCalendarDestinationCalls = [];
  enqueuePushSyncCalls = [];
});

describe("handleOAuthCallbackWithDependencies", () => {
  it("accepts validated state objects with a null destinationId", async () => {
    const result = await handleOAuthCallbackWithDependencies(
      {
        code: "oauth-code",
        error: null,
        provider: "google",
        state: "oauth-state",
      },
      {
        baseUrl: "https://keeper.test",
        exchangeCodeForTokens: () =>
          Promise.resolve({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
            scope: "calendar.read calendar.write",
          }),
        fetchUserInfo: () =>
          Promise.resolve({
            email: "person@example.com",
            id: "external-account-1",
          }),
        getDestinationAccountId: () => Promise.resolve(null),
        hasRequiredScopes: () => true,
        persistCalendarDestination: (payload) => {
          persistCalendarDestinationCalls.push(payload);
          return Promise.resolve();
        },
        enqueuePushSync: (userId: string) => {
          enqueuePushSyncCalls.push(userId)
          return Promise.resolve();
        },
        validateState: () => Promise.resolve({ destinationId: null, sourceCredentialId: null, userId: "user-1" }),
      },
    );

    expect(result.redirectUrl.pathname).toBe("/dashboard/integrations");
    expect(persistCalendarDestinationCalls).toHaveLength(1);
    expect(persistCalendarDestinationCalls[0]?.destinationId).toBeUndefined();
  });

  it("persists a new destination exactly once with the evaluated scope state", async () => {
    const result = await handleOAuthCallbackWithDependencies(
      {
        code: "oauth-code",
        error: null,
        provider: "google",
        state: "oauth-state",
      },
      {
        baseUrl: "https://keeper.test",
        exchangeCodeForTokens: () =>
          Promise.resolve({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
            scope: "calendar.read",
          }),
        fetchUserInfo: () =>
          Promise.resolve({
            email: "person@example.com",
            id: "external-account-1",
          }),
        getDestinationAccountId: () => Promise.resolve(null),
        hasRequiredScopes: () => false,
        persistCalendarDestination: (payload) => {
          persistCalendarDestinationCalls.push(payload);
          return Promise.resolve();
        },
        enqueuePushSync: (userId: string) => {
          enqueuePushSyncCalls.push(userId);
          return Promise.resolve();
        },
        validateState: () => Promise.resolve({ destinationId: null, sourceCredentialId: null, userId: "user-1" }),
      },
    );

    expect(result.redirectUrl.pathname).toBe("/dashboard/integrations");
    expect(result.redirectUrl.searchParams.get("destination")).toBe("connected");
    expect(persistCalendarDestinationCalls).toHaveLength(1);
    expect(persistCalendarDestinationCalls[0]).toMatchObject({
      accountId: "external-account-1",
      email: "person@example.com",
      needsReauthentication: true,
      provider: "google",
      userId: "user-1",
    });
    expect(enqueuePushSyncCalls).toEqual(["user-1"]);
  });

  it("allows reconnecting an existing destination account without duplicating persistence", async () => {
    const result = await handleOAuthCallbackWithDependencies(
      {
        code: "oauth-code",
        error: null,
        provider: "google",
        state: "oauth-state",
      },
      {
        baseUrl: "https://keeper.test",
        exchangeCodeForTokens: () =>
          Promise.resolve({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
            scope: "calendar.read calendar.write",
          }),
        fetchUserInfo: () =>
          Promise.resolve({
            email: "person@example.com",
            id: "external-account-1",
          }),
        getDestinationAccountId: () => Promise.resolve("external-account-1"),
        hasRequiredScopes: () => true,
        persistCalendarDestination: (payload) => {
          persistCalendarDestinationCalls.push(payload);
          return Promise.resolve();
        },
        enqueuePushSync: (userId: string) => {
          enqueuePushSyncCalls.push(userId);
          return Promise.resolve();
        },
        validateState: () => Promise.resolve({ destinationId: "destination-1", sourceCredentialId: null, userId: "user-1" }),
      },
    );

    expect(result.redirectUrl.pathname).toBe("/dashboard/integrations");
    expect(persistCalendarDestinationCalls).toHaveLength(1);
    expect(persistCalendarDestinationCalls[0]).toMatchObject({
      accountId: "external-account-1",
      destinationId: "destination-1",
      needsReauthentication: false,
      provider: "google",
      userId: "user-1",
    });
    expect(enqueuePushSyncCalls).toEqual(["user-1"]);
  });

  it("rejects reauthentication with a different external account", async () => {
    await expect(
      handleOAuthCallbackWithDependencies(
        {
          code: "oauth-code",
          error: null,
          provider: "google",
          state: "oauth-state",
        },
        {
          baseUrl: "https://keeper.test",
          exchangeCodeForTokens: () =>
            Promise.resolve({
              access_token: "access-token",
              expires_in: 3600,
              refresh_token: "refresh-token",
              scope: "calendar.read calendar.write",
            }),
          fetchUserInfo: () =>
            Promise.resolve({
              email: "person@example.com",
              id: "external-account-2",
            }),
          getDestinationAccountId: () => Promise.resolve("external-account-1"),
          hasRequiredScopes: () => true,
          persistCalendarDestination: () => Promise.resolve(),
          enqueuePushSync: () => Promise.resolve(),
          validateState: () => Promise.resolve({ destinationId: "destination-1", sourceCredentialId: null, userId: "user-1" }),
        },
      ),
    ).rejects.toBeInstanceOf(OAuthError);

    expect(persistCalendarDestinationCalls).toHaveLength(0);
    expect(enqueuePushSyncCalls).toHaveLength(0);
  });
});
