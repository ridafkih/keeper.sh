import { afterEach, describe, expect, it } from "vitest";
import { createMicrosoftTokenRefresher } from "../../../src/core/oauth/microsoft";
import { isOAuthReauthRequiredError } from "../../../src/core/oauth/error-classification";

const originalFetch = globalThis.fetch;

const createFetchMock = (
  handler: (input: unknown, init?: RequestInit) => Promise<Response>,
): typeof fetch => {
  const fetchMock: typeof fetch = (input, init) => handler(input, init);
  fetchMock.preconnect = originalFetch.preconnect;
  return fetchMock;
};

const createRefresher = () =>
  createMicrosoftTokenRefresher({
    clientId: "microsoft-client-id",
    clientSecret: "microsoft-client-secret",
  });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createMicrosoftTokenRefresher", () => {
  it("flags an expired refresh token as requiring reauthentication", async () => {
    globalThis.fetch = createFetchMock(() =>
      Promise.resolve(
        Response.json(
          {
            error: "invalid_grant",
            error_description: "AADSTS700082: The refresh token has expired due to inactivity.",
          },
          { status: 400 },
        ),
      ));

    const refresh = createRefresher();
    const thrown = await refresh("expired-refresh-token").catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      oauthErrorCode: "invalid_grant",
      oauthReauthRequired: true,
      status: 400,
    });
    expect(isOAuthReauthRequiredError(thrown)).toBe(true);
  });

  it("does not flag a server-side failure as requiring reauthentication", async () => {
    globalThis.fetch = createFetchMock(() =>
      Promise.resolve(new Response("upstream unavailable", { status: 503 })));

    const refresh = createRefresher();
    const thrown = await refresh("live-refresh-token").catch((error: unknown) => error);

    expect(thrown).toMatchObject({ oauthReauthRequired: false, status: 503 });
    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });

  it("does not flag a non-credential client error as requiring reauthentication", async () => {
    globalThis.fetch = createFetchMock(() =>
      Promise.resolve(
        Response.json({ error: "invalid_request" }, { status: 400 }),
      ));

    const refresh = createRefresher();
    const thrown = await refresh("live-refresh-token").catch((error: unknown) => error);

    expect(thrown).toMatchObject({ oauthErrorCode: "invalid_request", oauthReauthRequired: false });
    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });
});
