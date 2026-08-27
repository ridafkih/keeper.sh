import { afterEach, describe, expect, it } from "vitest";
import { fetchUserInfo } from "../../../src/core/oauth/google";

const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const originalFetch = globalThis.fetch;

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

describe("google userinfo fetch", () => {
  it("bounds the userinfo request with an abort signal", async () => {
    const seen: RequestInit[] = [];

    globalThis.fetch = createFetchMock((input, init) => {
      expect(String(input)).toBe(GOOGLE_USERINFO_URL);
      seen.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify({ email: "user@example.com", id: "google-account-id" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    });

    const info = await fetchUserInfo("access-token");

    expect(info).toEqual({ email: "user@example.com", id: "google-account-id" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a timeout when the userinfo request exceeds its budget", async () => {
    globalThis.fetch = createFetchMock((_input, init) => {
      const signal = init?.signal;

      if (!(signal instanceof AbortSignal)) {
        return Promise.reject(new Error("userinfo request carried no abort signal"));
      }

      return Promise.reject(
        new DOMException("The operation timed out.", "TimeoutError"),
      );
    });

    await expect(fetchUserInfo("access-token")).rejects.toThrow(/timed out after 15000ms/i);
  });
});
