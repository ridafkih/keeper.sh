import { afterEach, describe, expect, it } from "vitest";
import { createGoogleOAuthService } from "../../../src/core/oauth/google";
import { createMicrosoftOAuthService } from "../../../src/core/oauth/microsoft";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

const originalFetch = globalThis.fetch;

const createFetchMock = (
  handler: (input: unknown, init?: RequestInit) => Promise<Response>,
): typeof fetch => {
  const fetchMock: typeof fetch = (input, init) => handler(input, init);
  fetchMock.preconnect = originalFetch.preconnect;
  return fetchMock;
};

const stateStore = {
  consume: () => Promise.resolve(null),
  set: () => Promise.resolve(),
};

const credentials = { clientId: "client-id", clientSecret: "client-secret" };

const tokenPayload = {
  access_token: "access-token",
  expires_in: 3600,
  refresh_token: "refresh-token",
  scope: "scope",
  token_type: "Bearer",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("oauth token exchange", () => {
  it("bounds the google token exchange with an abort signal", async () => {
    const seen: RequestInit[] = [];

    globalThis.fetch = createFetchMock((input, init) => {
      expect(String(input)).toBe(GOOGLE_TOKEN_URL);
      seen.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify(tokenPayload), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    });

    const service = createGoogleOAuthService(credentials, stateStore);
    await service.exchangeCodeForTokens("code", "https://app.example.com/cb");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("bounds the microsoft token exchange with an abort signal", async () => {
    const seen: RequestInit[] = [];

    globalThis.fetch = createFetchMock((input, init) => {
      expect(String(input)).toBe(MICROSOFT_TOKEN_URL);
      seen.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify(tokenPayload), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    });

    const service = createMicrosoftOAuthService(credentials, stateStore);
    await service.exchangeCodeForTokens("code", "https://app.example.com/cb");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a timeout when the google token exchange exceeds its budget", async () => {
    globalThis.fetch = createFetchMock((_input, init) => {
      if (!(init?.signal instanceof AbortSignal)) {
        return Promise.reject(new Error("token exchange carried no abort signal"));
      }

      return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    });

    const service = createGoogleOAuthService(credentials, stateStore);

    await expect(
      service.exchangeCodeForTokens("code", "https://app.example.com/cb"),
    ).rejects.toThrow(/timed out after 15000ms/i);
  });

  it("reports a timeout when the microsoft token exchange exceeds its budget", async () => {
    globalThis.fetch = createFetchMock((_input, init) => {
      if (!(init?.signal instanceof AbortSignal)) {
        return Promise.reject(new Error("token exchange carried no abort signal"));
      }

      return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    });

    const service = createMicrosoftOAuthService(credentials, stateStore);

    await expect(
      service.exchangeCodeForTokens("code", "https://app.example.com/cb"),
    ).rejects.toThrow(/timed out after 15000ms/i);
  });
});
