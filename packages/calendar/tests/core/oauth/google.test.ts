import { afterEach, describe, expect, it } from "bun:test";
import { createGoogleOAuthService } from "../../../src/core/oauth/google";

const originalFetch = globalThis.fetch;

const createTestStateStore = () => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    set: (key: string, value: string, ttlSeconds: number) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
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

const createService = () =>
  createGoogleOAuthService({
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
  }, createTestStateStore());

const createFetchMock = (
  handler: (input: unknown, init?: RequestInit) => Promise<Response>,
): typeof fetch => {
  const fetchMock: typeof fetch = (input, init) => handler(input, init);
  fetchMock.preconnect = originalFetch.preconnect;
  return fetchMock;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createGoogleOAuthService.refreshAccessToken", () => {
  it("flags invalid_grant failures as requiring reauthentication", () => {
    globalThis.fetch = createFetchMock(() =>
      Promise.resolve(
        Response.json(
          {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
          { status: 400 },
        ),
      ));

    const service = createService();

    expect(service.refreshAccessToken("refresh-token")).rejects.toMatchObject({
      oauthErrorCode: "invalid_grant",
      oauthReauthRequired: true,
    });
  });

  it("retries once for transient 5xx failures", async () => {
    let attempts = 0;

    globalThis.fetch = createFetchMock(() => {
      attempts += 1;

      if (attempts === 1) {
        return Promise.resolve(
          Response.json(
            {
              error: "temporarily_unavailable",
            },
            { status: 503 },
          ),
        );
      }

      return Promise.resolve(
        Response.json({
          access_token: "new-access-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.events",
          token_type: "Bearer",
        }),
      );
    });

    const service = createService();
    const token = await service.refreshAccessToken("refresh-token");

    expect(attempts).toBe(2);
    expect(token.access_token).toBe("new-access-token");
  });

  it("marks timeout failures as transient", () => {
    globalThis.fetch = createFetchMock(() =>
      Promise.reject(new DOMException("The operation was aborted.", "AbortError")));

    const service = createService();

    expect(service.refreshAccessToken("refresh-token")).rejects.toMatchObject({
      oauthReauthRequired: false,
      oauthRetriable: true,
    });
  });
});
