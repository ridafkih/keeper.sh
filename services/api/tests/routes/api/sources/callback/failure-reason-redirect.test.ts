import { describe, expect, it, vi } from "vitest";

const BASE_URL = "https://keeper.test.invalid";

let stateIsValid = true;

vi.mock("@/utils/logging", () => ({
  widelog: {
    errorFields: () => null,
    set: () => null,
  },
}));

vi.mock("@/utils/middleware", () => ({
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("@/context", () => ({
  baseUrl: BASE_URL,
}));

vi.mock("@/utils/destinations", () => ({
  exchangeCodeForTokens: () => Promise.reject(new Error("token exchange should not run")),
  fetchUserInfo: () => Promise.reject(new Error("user info should not run")),
  validateState: () => {
    if (!stateIsValid) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ userId: "user-1" });
  },
}));

vi.mock("@/utils/oauth-source-credentials", () => ({
  createOAuthSourceCredential: () => Promise.reject(new Error("credential should not be stored")),
}));

vi.mock("@/utils/user-milestones", () => ({
  noteUserMilestone: () => Promise.resolve(),
}));

vi.mock("@/utils/oauth-sources", () => ({
  importOAuthAccountCalendars: () => Promise.reject(new Error("import should not run")),
}));

const { GET: handleCallback } = await import("@/routes/api/sources/callback/[provider]");

const callbackRoute = handleCallback as unknown as (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response>;

const readFailureReason = async (query: string): Promise<string | null> => {
  const response = await callbackRoute({
    params: { provider: "outlook" },
    request: new Request(`${BASE_URL}/api/sources/callback/outlook?${query}`),
  });
  const location = new URL(response.headers.get("location") ?? "");
  expect(location.pathname).toBe("/dashboard/integrations");
  return location.searchParams.get("reason");
};

describe("source callback failure redirects", () => {
  it("names a work account that needs admin approval", async () => {
    const description = encodeURIComponent("AADSTS90094: The grant requires admin permission.");
    expect(await readFailureReason(`error=access_denied&error_description=${description}`))
      .toBe("admin-approval-required");
  });

  it("names a cancelled consent screen", async () => {
    expect(await readFailureReason("error=access_denied")).toBe("access-declined");
  });

  it("names an expired or reused sign-in", async () => {
    stateIsValid = false;
    expect(await readFailureReason("code=code-1&state=state-1")).toBe("expired");
    stateIsValid = true;
  });
});
