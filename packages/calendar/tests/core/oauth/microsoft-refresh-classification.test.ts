import { afterEach, describe, expect, it } from "vitest";
import { createMicrosoftTokenRefresher } from "../../../src/core/oauth/microsoft";
import { isOAuthReauthRequiredError } from "../../../src/core/oauth/error-classification";

const originalFetch = globalThis.fetch;

const createFetchMock = (response: () => Response): typeof fetch => {
  const fetchMock: typeof fetch = () => Promise.resolve(response());
  fetchMock.preconnect = originalFetch.preconnect;
  return fetchMock;
};

const refreshWith = (response: () => Response): Promise<unknown> => {
  globalThis.fetch = createFetchMock(response);
  const refresh = createMicrosoftTokenRefresher({
    clientId: "microsoft-client-id",
    clientSecret: "microsoft-client-secret",
  });
  return refresh("live-refresh-token").catch((error: unknown) => error);
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("classifying a Microsoft token refresh failure", () => {
  it("keeps an outage that merely mentions invalid_grant retriable", async () => {
    const thrown = await refreshWith(() =>
      new Response(
        "<html><body>Service unavailable while handling invalid_grant</body></html>",
        { status: 503 },
      ));

    expect(thrown).toMatchObject({ oauthReauthRequired: false, status: 503 });
    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });

  it("keeps a throttled refresh retriable", async () => {
    const thrown = await refreshWith(() =>
      Response.json({ error: "temporarily_unavailable" }, { status: 429 }));

    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });

  it("does not treat a 400 with an empty body as a dead credential", async () => {
    const thrown = await refreshWith(() => new Response("", { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: null, oauthReauthRequired: false });
    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });

  it("does not treat a JSON array body as a dead credential", async () => {
    const thrown = await refreshWith(() =>
      Response.json(["invalid_grant"], { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: null, oauthReauthRequired: false });
  });

  it("does not treat a JSON primitive body as a dead credential", async () => {
    const thrown = await refreshWith(() =>
      new Response("\"invalid_grant\"", { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: null, oauthReauthRequired: false });
    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });

  it("does not treat a JSON null body as a dead credential", async () => {
    const thrown = await refreshWith(() => new Response("null", { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: null, oauthReauthRequired: false });
  });

  it("does not treat a non-string error property as a dead credential", async () => {
    const thrown = await refreshWith(() =>
      Response.json({ error: { code: "invalid_grant" } }, { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: null, oauthReauthRequired: false });
    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });

  it("does not treat a body without an error property as a dead credential", async () => {
    const thrown = await refreshWith(() =>
      Response.json({ error_description: "invalid_grant" }, { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: null, oauthReauthRequired: false });
  });

  it("matches the error code regardless of casing", async () => {
    const thrown = await refreshWith(() =>
      Response.json({ error: "Invalid_Grant" }, { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: "invalid_grant", oauthReauthRequired: true });
    expect(isOAuthReauthRequiredError(thrown)).toBe(true);
  });

  it("classifies a consent revocation as a dead credential", async () => {
    const thrown = await refreshWith(() =>
      Response.json(
        {
          error: "invalid_grant",
          error_description: "AADSTS65001: The user or administrator has not consented.",
          suberror: "consent_required",
        },
        { status: 400 },
      ));

    expect(isOAuthReauthRequiredError(thrown)).toBe(true);
  });

  it("carries a message an operator can read back to the provider response", async () => {
    const thrown = await refreshWith(() =>
      Response.json({ error: "invalid_grant" }, { status: 400 }));

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("400");
    expect((thrown as Error).message).toContain("invalid_grant");
    expect((thrown as Error).name).toBe("MicrosoftOAuthRefreshError");
  });

  it("retries a body it cannot parse rather than guessing the credential is dead", async () => {
    const thrown = await refreshWith(() => new Response("invalid_grant", { status: 400 }));

    expect(thrown).toMatchObject({ oauthErrorCode: null, oauthReauthRequired: false });
    expect(isOAuthReauthRequiredError(thrown)).toBe(false);
  });
});
