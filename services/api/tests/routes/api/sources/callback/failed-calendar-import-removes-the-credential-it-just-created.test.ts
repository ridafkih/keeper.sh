import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

const BASE_URL = "https://keeper.test.invalid";
const USER_ID = "user-1";
const ACCOUNT_EMAIL = "person@gmail.test.invalid";
const GOOGLE_SUB = "google-sub-1";
const TOKEN_LIFETIME_SECONDS = 3600;

vi.mock("@/context", () => ({
  baseUrl: BASE_URL,
  database,
}));

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

vi.mock("@/utils/middleware", () => ({
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("@/utils/destinations", () => ({
  exchangeCodeForTokens: () =>
    Promise.resolve({
      access_token: "access-token-1",
      expires_in: TOKEN_LIFETIME_SECONDS,
      refresh_token: "refresh-token-1",
      scope: "https://www.googleapis.com/auth/calendar",
    }),
  fetchUserInfo: () => Promise.resolve({ email: ACCOUNT_EMAIL, id: GOOGLE_SUB }),
  validateState: () => Promise.resolve({ userId: USER_ID }),
}));

vi.mock("@/utils/oauth-sources", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const LimitError = actual.OAuthSourceLimitError as new () => Error;
  return {
    ...actual,
    importOAuthAccountCalendars: () => {
      throw new LimitError();
    },
  };
});

const DDL = `
create table "user" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "email" text not null,
  "name" text not null default '',
  "updatedAt" timestamptz not null default now()
);
create table oauth_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "accessToken" text not null,
  "createdAt" timestamptz not null default now(),
  "email" text,
  "expiresAt" timestamptz not null,
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "refreshToken" text not null,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
`;

const { GET: handleCallback } = await import("@/routes/api/sources/callback/[provider]");

const callbackRoute = handleCallback as unknown as (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response>;

const runCallback = async (): Promise<Response> =>
  await callbackRoute({
    params: { provider: "google" },
    request: new Request(
      `${BASE_URL}/api/sources/callback/google?code=auth-code-1&state=state-1`,
    ),
  });

const countCredentials = async (): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from oauth_credentials where "userId" = $1`,
    [USER_ID],
  );
  return Number(result.rows[0]?.count ?? "0");
};

describe("a failed calendar import removes the credential it just created", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists oauth_credentials; drop table if exists "user";`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("id", "email", "name") values ($1, $2, $3)`,
      [USER_ID, ACCOUNT_EMAIL, "Person"],
    );
  });

  it("leaves no oauth_credentials row behind when the import throws the plan limit", async () => {
    const response = await runCallback();
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("source")).toBe("error");
    expect(await countCredentials()).toBe(0);
  });
});
