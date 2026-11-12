import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthorizeHandler = (context: { request: Request; userId: string }) => Promise<Response>;

let authorizationCalls: { provider: string; userId: string; options: Record<string, string> }[] = [];
let selectedRows: Record<string, unknown>[] = [];

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("../../../../src/utils/logging", () => ({
  widelog: { set: () => null },
}));

vi.mock("../../../../src/utils/destinations", () => ({
  getAuthorizationUrl: (provider: string, userId: string, options: Record<string, string>) => {
    authorizationCalls.push({ options, provider, userId });
    return Promise.resolve("https://accounts.example.com/consent");
  },
  isOAuthProvider: (provider: string) => provider === "google" || provider === "outlook",
}));

vi.mock("../../../../src/context", () => ({
  baseUrl: "https://www.keeper.sh",
  database: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectedRows),
        }),
      }),
    }),
  },
}));

const { GET: authorize } = (await import("../../../../src/routes/api/sources/authorize")) as unknown as {
  GET: AuthorizeHandler;
};

const requestConsent = (search: string) =>
  authorize({ request: new Request(`https://www.keeper.sh/api/sources/authorize?${search}`), userId: "user-1" });

beforeEach(() => {
  authorizationCalls = [];
  selectedRows = [];
});

describe("GET /api/sources/authorize", () => {
  it("opens consent for the account the user just signed up with", async () => {
    selectedRows = [{ email: "person@example.com" }];

    const response = await requestConsent("provider=google&account=sign-in");

    expect(response.status).toBe(302);
    expect(authorizationCalls).toEqual([{
      options: { callbackUrl: "https://www.keeper.sh/api/sources/callback/google", loginHint: "person@example.com" },
      provider: "google",
      userId: "user-1",
    }]);
  });

  it("leaves the account picker alone for an ordinary connect", async () => {
    selectedRows = [{ email: "person@example.com" }];

    await requestConsent("provider=outlook");

    expect(authorizationCalls.map(({ options }) => options)).toEqual([
      { callbackUrl: "https://www.keeper.sh/api/sources/callback/outlook" },
    ]);
  });

  it("refuses any other account value", async () => {
    const response = await requestConsent("provider=google&account=someone@example.com");

    expect(response.status).toBe(400);
    expect(authorizationCalls).toEqual([]);
  });
});
