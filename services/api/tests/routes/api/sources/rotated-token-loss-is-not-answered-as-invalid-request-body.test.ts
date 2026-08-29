import { RotatedTokenNotPersistedError } from "@keeper.sh/calendar/oauth-persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";

let fields: Record<string, unknown> = {};
let values: Record<string, unknown> = {};
let createOAuthSourceResult: () => Promise<unknown> = () =>
  Promise.resolve({ id: "source-1" });

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    error: () => null,
    errorFields: (_error: unknown, next: Record<string, unknown>) => {
      fields = { ...fields, ...next };
    },
    flush: () => null,
    set: (key: string, value: unknown) => {
      values = { ...values, [key]: value };
    },
  },
}));

vi.mock("@/utils/middleware", () => ({
  withAuth:
    (handler: (ctx: Record<string, unknown>) => unknown) =>
    (ctx: Record<string, unknown>) =>
      handler({ ...ctx, userId: "user-1" }),
  withWideEvent: (handler: unknown) => handler,
}));

class TestOAuthSourceLimitError extends Error {}
class TestDestinationNotFoundError extends Error {}
class TestDestinationProviderMismatchError extends Error {}
class TestDuplicateSourceError extends Error {}

vi.mock("@/utils/oauth-sources", async () => {
  const { RotatedTokenNotPersistedError: RealRotatedTokenNotPersistedError } = await import(
    "@keeper.sh/calendar/oauth-persistence"
  );
  return {
    DestinationNotFoundError: TestDestinationNotFoundError,
    DestinationProviderMismatchError: TestDestinationProviderMismatchError,
    DuplicateSourceError: TestDuplicateSourceError,
    OAuthSourceLimitError: TestOAuthSourceLimitError,
    RotatedTokenNotPersistedError: RealRotatedTokenNotPersistedError,
    createOAuthSource: () => createOAuthSourceResult(),
    getUserOAuthSources: () => Promise.resolve([]),
  };
});

vi.mock("@/context", () => ({
  premiumService: { canUseEventFilters: () => Promise.resolve(true) },
}));

interface RouteCase {
  modulePath: string;
  provider: string;
}

const routeCases: RouteCase[] = [
  { modulePath: "@/routes/api/sources/google/index", provider: "google" },
  { modulePath: "@/routes/api/sources/outlook/index", provider: "outlook" },
];

const createRequest = (provider: string): Request =>
  new Request(`https://api.keeper.sh/api/sources/${provider}`, {
    body: JSON.stringify({
      externalCalendarId: "primary",
      name: "Work",
      oauthSourceCredentialId: "cred-1",
      syncFocusTime: true,
      syncOutOfOffice: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

const post = async ({ modulePath, provider }: RouteCase): Promise<Response> => {
  const { POST: handlePost } = (await import(modulePath)) as {
    POST: (ctx: { params: Record<string, string>; request: Request }) => Promise<Response>;
  };
  return await handlePost({ params: {}, request: createRequest(provider) });
};

describe.each(routeCases)(
  "POST /api/sources/$provider when the rotated refresh token was not persisted",
  (routeCase) => {
    beforeEach(() => {
      fields = {};
      values = {};
      createOAuthSourceResult = () => Promise.resolve({ id: "source-1" });
    });

    it("creates the source when the credential persists", async () => {
      const response = await post(routeCase);

      expect(response.status).toBe(201);
    });

    it("does not answer a lost rotation with 400 Invalid request body", async () => {
      createOAuthSourceResult = () =>
        Promise.reject(new RotatedTokenNotPersistedError(new Error("connection terminated")));

      const response = await post(routeCase);
      const body = (await response.json()) as { error?: unknown };

      expect(response.status).not.toBe(400);
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(body.error).not.toBe("Invalid request body");
    });

    it("logs a lost rotation under its own slug", async () => {
      createOAuthSourceResult = () =>
        Promise.reject(new RotatedTokenNotPersistedError(new Error("connection terminated")));

      await post(routeCase);

      expect(fields.slug).toBe("rotated-token-not-persisted");
    });
  },
);
